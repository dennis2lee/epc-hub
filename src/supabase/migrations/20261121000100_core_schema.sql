-- Core schema for the church expense-approval app (MVP).
-- Rules that must never be bypassed (who may approve, state transitions) live in
-- SQL functions defined in later migrations. Clients only get SELECT through RLS.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies call private helpers with the caller's privileges, so the
-- authenticated role needs USAGE. The schema is not exposed through the API.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.claim_status as enum
  ('draft', 'in_review', 'rejected', 'approved', 'received', 'paid', 'cancelled', 'deleted');
create type public.decision_kind as enum ('approve', 'reject');
create type public.person_status as enum ('invited', 'pending', 'active', 'suspended');
create type public.check_delivery as enum ('pickup', 'mail');
create type public.payment_status as enum ('issued', 'cleared', 'void');

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value jsonb not null
);

insert into public.app_settings (key, value) values
  ('time_zone',      '"America/Los_Angeles"'),
  ('late_days',      '60'),
  ('stuck_days',     '2'),
  ('return_reasons', '["영수증 누락", "금액이 다름", "항목이 맞지 않음", "기타"]');

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_en     text,
  parent_id   uuid references public.departments (id),
  is_finance  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.people (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  legal_name_en  text,
  phone_e164     text unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email          text,
  mail_address   text,
  church_title   text,
  lang           text not null default 'ko' check (lang in ('ko', 'en')),
  status         public.person_status not null default 'invited',
  -- Approvers, finance and admins must be confirmed in person before activation.
  needs_in_person_check boolean not null default false,
  created_at     timestamptz not null default now()
);

-- One person may sign in with several identities (Kakao, email code), which
-- become separate auth.users rows. Only private.current_member_id() reads this.
create table public.person_logins (
  auth_user_id  uuid primary key references auth.users (id) on delete cascade,
  person_id     uuid not null references public.people (id),
  provider      text not null,
  linked_via    text not null check (linked_via in ('invite', 'in_person', 'admin')),
  linked_at     timestamptz not null default now()
);

create index person_logins_person_idx on public.person_logins (person_id);

-- Roles held in a department for a period. Department heads and elders must not
-- overlap within one department; finance members may be several.
create table public.positions (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.people (id),
  department_id  uuid not null references public.departments (id),
  role           text not null check (role in ('dept_head', 'elder', 'finance', 'finance_elder')),
  starts_on      date not null,
  ends_on        date,
  created_at     timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  exclude using gist (
    department_id with =,
    role with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (role in ('dept_head', 'elder'))
);

create table public.admin_grants (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id),
  grant_kind  text not null check (grant_kind in ('admin', 'auditor', 'emergency')),
  basis       text,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references public.people (id),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------
create table public.claim_counters (
  year     int primary key,
  last_no  int not null
);

create table public.claims (
  id               uuid primary key default gen_random_uuid(),
  claim_no         text unique,
  author_id        uuid not null references public.people (id),
  department_id    uuid not null references public.departments (id),
  purpose          text not null default '',
  attendees        text,
  expense_date     date,
  total_cents      bigint not null default 0 check (total_cents >= 0),
  check_delivery   public.check_delivery not null default 'pickup',
  status           public.claim_status not null default 'draft',
  round            int not null default 0,
  current_seq      int not null default 0,
  single_approver  boolean not null default false,
  late             boolean not null default false,
  dup_warning      boolean not null default false,
  return_reason    text,
  version          int not null default 1,
  submitted_at     timestamptz,
  received_by      uuid references public.people (id),
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index claims_author_idx on public.claims (author_id);
create index claims_status_idx on public.claims (status);

create table public.claim_lines (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.claims (id) on delete cascade,
  description   text not null,
  amount_cents  bigint not null check (amount_cents > 0),
  budget_code   text,
  sort_order    int not null default 0
);

create index claim_lines_claim_idx on public.claim_lines (claim_id);

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.claims (id) on delete cascade,
  storage_path  text not null unique,
  mime          text not null,
  bytes         bigint not null check (bytes > 0),
  sha256        text not null,
  merchant      text,
  receipt_date  date,
  amount_cents  bigint check (amount_cents is null or amount_cents > 0),
  created_at    timestamptz not null default now()
);

create index attachments_claim_idx on public.attachments (claim_id);
create index attachments_sha_idx on public.attachments (sha256);

-- One check may pay several claims of the same payee.
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  check_no      text not null unique,
  issued_on     date not null,
  cleared_on    date,
  status        public.payment_status not null default 'issued',
  amount_cents  bigint not null check (amount_cents > 0),
  payee_name    text not null,
  paid_by       uuid not null references public.people (id),
  memo          text,
  created_at    timestamptz not null default now()
);

create table public.payment_claims (
  payment_id    uuid not null references public.payments (id),
  claim_id      uuid not null references public.claims (id),
  amount_cents  bigint not null check (amount_cents > 0),
  primary key (payment_id, claim_id)
);

-- ---------------------------------------------------------------------------
-- Approval line and records
-- ---------------------------------------------------------------------------
create table public.approval_steps (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references public.claims (id) on delete cascade,
  round          int not null,
  seq            int not null,
  roles          text[] not null,
  approver_id    uuid not null references public.people (id),
  acted_by       uuid references public.people (id),
  decision       public.decision_kind,
  reason         text,
  snapshot_hash  text,
  client_info    jsonb,
  decided_at     timestamptz,
  unique (claim_id, round, seq)
);

create index approval_steps_approver_idx on public.approval_steps (approver_id) where decision is null;

-- Append-only. No client has write access; triggers insert rows.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_auth  uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

-- Written by SQL functions, delivered by the server (service role).
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid references public.claims (id) on delete cascade,
  recipient_id  uuid not null references public.people (id),
  kind          text not null,
  channel       text not null default 'email' check (channel in ('email')),
  status        text not null default 'pending'
                check (status in ('pending', 'sending', 'sent', 'failed', 'no_address', 'skipped')),
  attempts      int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create index notifications_pending_idx on public.notifications (created_at) where status = 'pending';
