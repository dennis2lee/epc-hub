-- Pending accounts (waiting for the office's in-person check) may keep drafts,
-- as the design promises (§8). Drafting functions already accept them through
-- private.current_drafter_id(); this migration lets them read what they draft.
-- Submitting stays active-only (submit_claim uses current_member_id()).
-- No function signature changes: replaced in place, safe while the old app runs.

-- Authors read their own claims while active or pending. Everything else is
-- still decided for active members only.
create or replace function private.can_read_claim(p_claim uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_drafter uuid;
  c public.claims%rowtype;
  v_today date;
begin
  select * into c from public.claims where id = p_claim;
  if not found then return false; end if;
  if v_me is null then
    -- A pending account sees only its own claims (they can only be drafts).
    v_drafter := private.current_drafter_id();
    return v_drafter is not null and c.author_id = v_drafter;
  end if;
  if c.author_id = v_me then return true; end if;
  if c.status in ('draft', 'deleted') then return false; end if;
  if exists (
    select 1 from public.approval_steps s
     where s.claim_id = p_claim and s.approver_id = v_me
       and (s.decision is not null
            or (s.round = c.round and c.status = 'in_review' and s.seq <= c.current_seq))
  ) then
    return true;
  end if;
  if private.is_auditor() then return true; end if;
  v_today := private.today();
  if c.status in ('approved', 'received', 'paid', 'cancelled')
     and (private.holds_role(v_me, 'finance', v_today) or private.holds_role(v_me, 'finance_elder', v_today)) then
    return true;
  end if;
  return false;
end
$$;

-- The draft form needs the list of active departments and the author's own
-- name. Pending accounts get exactly that, not the member directory.
-- current_drafter_id() stays closed to clients; policies use these booleans.
create or replace function private.is_drafter()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select private.current_drafter_id() is not null $$;

create or replace function private.is_my_person(p_person uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select p_person = private.current_drafter_id() $$;

revoke all on function private.is_drafter(), private.is_my_person(uuid) from public, anon;
grant execute on function private.is_drafter(), private.is_my_person(uuid) to authenticated;

create policy "pending drafters read active departments" on public.departments
  for select to authenticated
  using (active and (select private.is_drafter()));

create policy "drafters read own person row" on public.people
  for select to authenticated
  using ((select private.is_my_person(id)));
