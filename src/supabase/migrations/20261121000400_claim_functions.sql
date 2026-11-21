-- Claim lifecycle. Every state change goes through one of these functions.
-- Pattern: check member -> lock the claim row -> check status and version ->
-- check permission -> write -> bump version -> queue notifications.
-- Error messages are short codes mapped to screen text in src/lib/i18n.ts.

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------
create or replace function public.create_claim(p_department uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_id uuid;
begin
  if v_me is null then raise exception 'not_member'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department and d.active) then
    raise exception 'bad_department';
  end if;
  insert into public.claims (author_id, department_id) values (v_me, p_department)
  returning id into v_id;
  return v_id;
end
$$;

-- Replace the editable fields and all lines of a draft in one call.
-- p_lines: [{"description": text, "amount_cents": int, "budget_code": text|null}, ...]
create or replace function public.save_claim_draft(
  p_claim uuid,
  p_version int,
  p_department uuid,
  p_purpose text,
  p_attendees text,
  p_expense_date date,
  p_check_delivery public.check_delivery,
  p_lines jsonb
)
returns int
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  c public.claims%rowtype;
  v_line jsonb;
  v_i int := 0;
  v_total bigint := 0;
  v_amount bigint;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id <> v_me then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'bad_lines'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department and d.active) then
    raise exception 'bad_department';
  end if;

  delete from public.claim_lines where claim_id = p_claim;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_amount := (v_line ->> 'amount_cents')::bigint;
    if v_amount is null or v_amount <= 0 then raise exception 'bad_amount'; end if;
    if coalesce(trim(v_line ->> 'description'), '') = '' then raise exception 'bad_lines'; end if;
    insert into public.claim_lines (claim_id, description, amount_cents, budget_code, sort_order)
    values (p_claim, trim(v_line ->> 'description'), v_amount, nullif(trim(v_line ->> 'budget_code'), ''), v_i);
    v_i := v_i + 1;
    v_total := v_total + v_amount;
  end loop;

  update public.claims
     set department_id = p_department,
         purpose = coalesce(trim(p_purpose), ''),
         attendees = nullif(trim(p_attendees), ''),
         expense_date = p_expense_date,
         check_delivery = p_check_delivery,
         total_cents = v_total,
         version = version + 1,
         updated_at = now()
   where id = p_claim;
  return c.version + 1;
end
$$;

-- Record an uploaded receipt (the server computed sha256 from the bytes).
create or replace function public.add_attachment(
  p_claim uuid,
  p_storage_path text,
  p_mime text,
  p_bytes bigint,
  p_sha256 text,
  p_merchant text,
  p_receipt_date date,
  p_amount_cents bigint
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.can_edit_claim(p_claim) then raise exception 'stale_or_closed'; end if;
  if split_part(p_storage_path, '/', 1) <> p_claim::text then raise exception 'bad_path'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash'; end if;
  -- The object must already exist in the receipts bucket under this claim.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = p_storage_path) then
    raise exception 'missing_object';
  end if;
  insert into public.attachments (claim_id, storage_path, mime, bytes, sha256, merchant, receipt_date, amount_cents)
  values (p_claim, p_storage_path, p_mime, p_bytes, p_sha256, nullif(trim(p_merchant), ''), p_receipt_date, p_amount_cents)
  returning id into v_id;
  update public.claims set version = version + 1, updated_at = now() where id = p_claim;
  return v_id;
end
$$;

create or replace function public.remove_attachment(p_attachment uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a public.attachments%rowtype;
begin
  select * into a from public.attachments where id = p_attachment;
  if not found then raise exception 'not_found'; end if;
  if not private.can_edit_claim(a.claim_id) then raise exception 'stale_or_closed'; end if;
  delete from public.attachments where id = p_attachment;
  update public.claims set version = version + 1, updated_at = now() where id = a.claim_id;
  return a.storage_path;  -- the server deletes the object with the user's session
end
$$;

create or replace function public.delete_draft(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_member_id() then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version <> p_version or c.round > 0 then raise exception 'stale_or_closed'; end if;
  update public.claims set status = 'deleted', version = version + 1, updated_at = now() where id = p_claim;
end
$$;

-- ---------------------------------------------------------------------------
-- Approval line
-- ---------------------------------------------------------------------------
-- Build the approval line for a department and author on a date. Returns one row
-- per step (seq, roles, approver). Raises if a required approver is missing or
-- not active. Same person in two roles is merged into one step.
create or replace function private.build_line(p_dept uuid, p_author uuid, p_on date)
returns table (seq int, roles text[], approver_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_head uuid := private.dept_head_of(p_dept, p_on);
  v_elder uuid := private.elder_of(p_dept, p_on);
begin
  if v_head is null then raise exception 'no_dept_head'; end if;
  if v_elder is null then raise exception 'no_elder'; end if;
  if exists (select 1 from public.people p where p.id in (v_head, v_elder) and p.status <> 'active') then
    raise exception 'approver_not_active';
  end if;

  if v_head = v_elder then
    if v_head <> p_author then
      return query select 1, array['dept_head', 'elder'], v_head;
    end if;
    -- The author holds both roles: nobody independent is left.
    raise exception 'no_independent_approver';
  end if;

  if v_head = p_author then
    return query select 1, array['elder'], v_elder;            -- A6
  elsif v_elder = p_author then
    return query select 1, array['dept_head'], v_head;         -- A7
  else
    return query select 1, array['dept_head'], v_head
                 union all
                 select 2, array['elder'], v_elder;
  end if;
end
$$;

-- Read-only preview for the submit screen (names only).
create or replace function public.preview_approval_line(p_department uuid)
returns table (seq int, roles text[], approver_name text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  return query
    select l.seq, l.roles, p.name
      from private.build_line(p_department, v_me, private.today()) l
      join public.people p on p.id = l.approver_id
     order by l.seq;
end
$$;

-- ---------------------------------------------------------------------------
-- Submit / withdraw / revise
-- ---------------------------------------------------------------------------
create or replace function public.submit_claim(p_claim uuid, p_version int)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  c public.claims%rowtype;
  v_today date := private.today();
  v_total bigint;
  v_round int;
  v_year int;
  v_no int;
  v_steps int;
  v_first uuid;
  v_dup boolean;
  v_late boolean;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id <> v_me then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version <> p_version then raise exception 'stale_or_closed'; end if;

  if coalesce(trim(c.purpose), '') = '' then raise exception 'purpose_required'; end if;
  if c.expense_date is null then raise exception 'expense_date_required'; end if;
  if c.expense_date > v_today then raise exception 'expense_date_in_future'; end if;
  select coalesce(sum(amount_cents), 0) into v_total from public.claim_lines where claim_id = p_claim;
  if v_total <= 0 then raise exception 'lines_required'; end if;
  if v_total <> c.total_cents then raise exception 'total_mismatch'; end if;
  if not exists (select 1 from public.attachments a where a.claim_id = p_claim) then
    raise exception 'receipt_required';
  end if;
  if c.check_delivery = 'mail'
     and not exists (select 1 from public.people p where p.id = v_me and coalesce(trim(p.mail_address), '') <> '') then
    raise exception 'mail_address_required';
  end if;

  v_round := c.round + 1;
  insert into public.approval_steps (claim_id, round, seq, roles, approver_id)
  select p_claim, v_round, l.seq, l.roles, l.approver_id
    from private.build_line(c.department_id, v_me, v_today) l;
  get diagnostics v_steps = row_count;

  select approver_id into v_first
    from public.approval_steps where claim_id = p_claim and round = v_round and seq = 1;

  -- Possible duplicates: same file hash, or same merchant/date/amount in another live claim.
  select exists (
    select 1
      from public.attachments a
      join public.attachments b on b.claim_id <> a.claim_id
       and (b.sha256 = a.sha256
            or (a.merchant is not null and lower(b.merchant) = lower(a.merchant)
                and b.receipt_date = a.receipt_date and b.amount_cents = a.amount_cents))
      join public.claims oc on oc.id = b.claim_id and oc.status not in ('deleted', 'cancelled')
     where a.claim_id = p_claim
  ) into v_dup;

  v_late := (v_today - c.expense_date) > private.setting_int('late_days', 60);

  if c.claim_no is null then
    v_year := extract(year from v_today)::int;
    insert into public.claim_counters (year, last_no) values (v_year, 1)
      on conflict (year) do update set last_no = public.claim_counters.last_no + 1
      returning last_no into v_no;
  end if;

  update public.claims
     set status = 'in_review',
         round = v_round,
         current_seq = 1,
         single_approver = (v_steps = 1),
         dup_warning = v_dup,
         late = v_late,
         return_reason = null,
         claim_no = coalesce(c.claim_no, v_year::text || '-' || lpad(v_no::text, 4, '0')),
         submitted_at = now(),
         version = version + 1,
         updated_at = now()
   where id = p_claim;

  perform private.notify(p_claim, v_first, 'review_requested');

  return jsonb_build_object('status', 'in_review', 'steps', v_steps,
                            'duplicate_warning', v_dup, 'late', v_late);
end
$$;

create or replace function public.withdraw_claim(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_member_id() then raise exception 'not_author'; end if;
  if c.status <> 'in_review' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  if exists (select 1 from public.approval_steps s
              where s.claim_id = p_claim and s.round = c.round and s.decision is not null) then
    raise exception 'already_approved';
  end if;
  delete from public.approval_steps where claim_id = p_claim and round = c.round;
  update public.claims
     set status = 'draft', round = c.round - 1, current_seq = 0, version = version + 1, updated_at = now()
   where id = p_claim;
end
$$;

create or replace function public.start_revision(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_member_id() then raise exception 'not_author'; end if;
  if c.status <> 'rejected' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  update public.claims set status = 'draft', current_seq = 0, version = version + 1, updated_at = now()
   where id = p_claim;
end
$$;

-- ---------------------------------------------------------------------------
-- Approve / request changes
-- ---------------------------------------------------------------------------
create or replace function public.act_on_claim(
  p_claim uuid,
  p_decision public.decision_kind,
  p_reason text,
  p_version int,
  p_client jsonb
)
returns public.claim_status
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c  public.claims%rowtype;
  s  public.approval_steps%rowtype;
  v_me uuid := private.current_member_id();
  v_next uuid;
  v_status public.claim_status;
begin
  if v_me is null then raise exception 'not_member'; end if;
  if p_decision is null then raise exception 'bad_decision'; end if;

  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'in_review' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  if v_me = c.author_id then raise exception 'author_cannot_act'; end if;

  select * into s from public.approval_steps
   where claim_id = p_claim and round = c.round and seq = c.current_seq;
  if not found or s.decision is not null then raise exception 'no_open_step'; end if;
  if s.approver_id is distinct from v_me then raise exception 'not_your_turn'; end if;
  if exists (select 1 from public.approval_steps
              where claim_id = p_claim and round = c.round and acted_by = v_me) then
    raise exception 'already_acted_on_claim';
  end if;
  if p_decision = 'reject' and coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;

  update public.approval_steps
     set decision = p_decision,
         reason = nullif(trim(p_reason), ''),
         acted_by = v_me,
         decided_at = now(),
         snapshot_hash = private.claim_snapshot_hash(p_claim),
         client_info = p_client
   where id = s.id;

  if p_decision = 'reject' then
    v_status := 'rejected';
    update public.claims set status = v_status, version = version + 1, updated_at = now() where id = p_claim;
    perform private.notify(p_claim, c.author_id, 'changes_requested');
  else
    select approver_id into v_next from public.approval_steps
     where claim_id = p_claim and round = c.round and seq = c.current_seq + 1;
    if found then
      v_status := 'in_review';
      update public.claims set current_seq = current_seq + 1, version = version + 1, updated_at = now()
       where id = p_claim;
      perform private.notify(p_claim, v_next, 'review_requested');
    else
      v_status := 'approved';
      update public.claims set status = v_status, version = version + 1, updated_at = now() where id = p_claim;
      -- Tell every finance member who may handle it (not the author).
      perform private.notify(p_claim, ps.person_id, 'finance_requested')
         from (select distinct pos.person_id
                 from public.positions pos
                 join public.people p on p.id = pos.person_id and p.status = 'active'
                where pos.role in ('finance', 'finance_elder')
                  and pos.starts_on <= private.today()
                  and (pos.ends_on is null or pos.ends_on >= private.today())) ps
        where private.can_handle_finance(p_claim, ps.person_id);
    end if;
    perform private.notify(p_claim, v_me, 'you_approved');
  end if;

  return v_status;
end
$$;

-- ---------------------------------------------------------------------------
-- Finance: verify, return for documents, record check
-- ---------------------------------------------------------------------------
create or replace function public.receive_claim(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'approved' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  if not private.can_handle_finance(p_claim, v_me) then raise exception 'not_finance'; end if;
  update public.claims
     set status = 'received', received_by = v_me, received_at = now(), version = version + 1, updated_at = now()
   where id = p_claim;
  perform private.notify(p_claim, c.author_id, 'check_ready');
end
$$;

create or replace function public.return_claim(p_claim uuid, p_version int, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'approved' or c.version <> p_version then raise exception 'stale_or_closed'; end if;
  if not private.can_handle_finance(p_claim, v_me) then raise exception 'not_finance'; end if;
  update public.claims
     set status = 'rejected', return_reason = trim(p_reason), version = version + 1, updated_at = now()
   where id = p_claim;
  perform private.notify(p_claim, c.author_id, 'documents_requested');
end
$$;

-- One check may pay several received claims of the same author.
create or replace function public.record_payment(
  p_claims uuid[],
  p_check_no text,
  p_issued_on date,
  p_memo text
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_payment uuid;
  v_total bigint := 0;
  v_authors int;
  v_author uuid;
  v_payee text;
  r record;
begin
  if v_me is null then raise exception 'not_member'; end if;
  if p_claims is null or cardinality(p_claims) = 0 then raise exception 'claims_required'; end if;
  if coalesce(trim(p_check_no), '') = '' then raise exception 'check_no_required'; end if;
  if p_issued_on is null then raise exception 'issued_on_required'; end if;

  -- Lock all claims in a stable order to avoid deadlocks.
  for r in select * from public.claims where id = any (p_claims) order by id for update loop
    if r.status <> 'received' then raise exception 'stale_or_closed'; end if;
    if not private.can_handle_finance(r.id, v_me) then raise exception 'not_finance'; end if;
    v_total := v_total + r.total_cents;
  end loop;
  if (select count(*) from public.claims where id = any (p_claims)) <> cardinality(p_claims) then
    raise exception 'not_found';
  end if;

  select count(distinct author_id), min(author_id::text)::uuid into v_authors, v_author
    from public.claims where id = any (p_claims);
  if v_authors <> 1 then raise exception 'one_payee_per_check'; end if;
  select coalesce(nullif(trim(p.legal_name_en), ''), p.name) into v_payee from public.people p where p.id = v_author;

  insert into public.payments (check_no, issued_on, amount_cents, payee_name, paid_by, memo)
  values (trim(p_check_no), p_issued_on, v_total, v_payee, v_me, nullif(trim(p_memo), ''))
  returning id into v_payment;

  insert into public.payment_claims (payment_id, claim_id, amount_cents)
  select v_payment, c.id, c.total_cents from public.claims c where c.id = any (p_claims);

  update public.claims set status = 'paid', version = version + 1, updated_at = now() where id = any (p_claims);

  perform private.notify(c.id, c.author_id, 'check_issued') from public.claims c where c.id = any (p_claims);
  return v_payment;
end
$$;

-- ---------------------------------------------------------------------------
-- Lists for the home screen
-- ---------------------------------------------------------------------------
create or replace function public.my_review_queue()
returns table (claim_id uuid, claim_no text, department text, author text, total_cents bigint,
               submitted_at timestamptz, roles text[], single_approver boolean)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.claim_no, d.name, a.name, c.total_cents, c.submitted_at, s.roles, c.single_approver
    from public.claims c
    join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
    join public.departments d on d.id = c.department_id
    join public.people a on a.id = c.author_id
   where c.status = 'in_review'
     and s.decision is null
     and s.approver_id = private.current_member_id()
   order by c.submitted_at
$$;

create or replace function public.finance_queue()
returns table (claim_id uuid, claim_no text, department text, author text, author_id uuid,
               total_cents bigint, status public.claim_status, check_delivery public.check_delivery,
               single_approver boolean, dup_warning boolean, late boolean, submitted_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.claim_no, d.name, a.name, c.author_id, c.total_cents, c.status, c.check_delivery,
         c.single_approver, c.dup_warning, c.late, c.submitted_at
    from public.claims c
    join public.departments d on d.id = c.department_id
    join public.people a on a.id = c.author_id
   where c.status in ('approved', 'received')
     and private.can_handle_finance(c.id, private.current_member_id())
   order by c.status, c.submitted_at
$$;

-- Admin view of stuck claims: metadata only, no amounts or contents.
create or replace function public.stuck_claims()
returns table (claim_id uuid, claim_no text, department text, status public.claim_status,
               waiting_on text, days_waiting int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not_admin'; end if;
  return query
    select c.id, c.claim_no, d.name, c.status,
           case when c.status = 'in_review' then p.name else '재정부' end,
           (private.today() - private.local_date(c.updated_at, private.church_tz()))::int
      from public.claims c
      join public.departments d on d.id = c.department_id
      left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
      left join public.people p on p.id = s.approver_id
     where c.status in ('in_review', 'approved', 'received')
       and (private.today() - private.local_date(c.updated_at, private.church_tz())) >= private.setting_int('stuck_days', 2)
     order by c.updated_at;
end
$$;
