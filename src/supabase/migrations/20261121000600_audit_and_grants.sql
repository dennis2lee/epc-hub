-- Append-only audit trail for every table that affects money or permissions,
-- plus the final function privileges.

create or replace function private.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, before, after)
  values (
    private.current_person_any(),
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'claim_id', v_old ->> 'claim_id',
             v_new ->> 'auth_user_id', v_old ->> 'auth_user_id', v_new ->> 'key', v_old ->> 'key'),
    v_old,
    v_new
  );
  return coalesce(new, old);
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'departments', 'people', 'person_logins', 'positions', 'admin_grants', 'invites',
    'claims', 'claim_lines', 'attachments', 'payments', 'payment_claims', 'approval_steps'
  ] loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I
         for each row execute function private.audit_row()', t);
  end loop;
end
$$;

-- Nobody may rewrite history through the API.
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;  -- still limited to auditors by RLS

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new public functions to anon
-- by default; revoke it everywhere and grant to authenticated explicitly.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function
  public.me(),
  public.update_my_profile(text, text, text, text),
  public.invite_preview(text),
  public.accept_invite(text, text),
  public.create_claim(uuid),
  public.save_claim_draft(uuid, int, uuid, text, text, date, public.check_delivery, jsonb),
  public.add_attachment(uuid, text, text, bigint, text, text, date, bigint),
  public.remove_attachment(uuid),
  public.delete_draft(uuid, int),
  public.preview_approval_line(uuid),
  public.submit_claim(uuid, int),
  public.withdraw_claim(uuid, int),
  public.start_revision(uuid, int),
  public.act_on_claim(uuid, public.decision_kind, text, int, jsonb),
  public.receive_claim(uuid, int),
  public.return_claim(uuid, int, text),
  public.record_payment(uuid[], text, date, text),
  public.my_review_queue(),
  public.finance_queue(),
  public.stuck_claims(),
  public.admin_create_department(text, text, uuid, boolean),
  public.admin_create_person(text, text, text, text, text, boolean),
  public.admin_create_invite(uuid),
  public.admin_set_person_status(uuid, public.person_status),
  public.admin_assign_position(uuid, uuid, text, date, date),
  public.admin_end_position(uuid, date),
  public.admin_people()
to authenticated;
