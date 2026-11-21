-- Regression tests for the M1 red-team findings (doc/reviews/2026-11-21-m1-redteam.md).
begin;
select plan(28);

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.uid(p text) returns uuid language sql as $$ select ('30000000-0000-0000-0000-' || p)::uuid $$;
create function pg_temp.ver(p_claim uuid) returns int language sql security definer as $$
  select version from public.claims where id = p_claim $$;
create function pg_temp.attach(p_claim uuid, p_uid uuid, p_name text, p_sha text) returns uuid language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('receipts', p_claim::text || '/' || p_name, p_uid::text, '{"mimetype":"image/jpeg","size":10}');
  return public.add_attachment_srv(p_uid, p_claim, p_claim::text || '/' || p_name, p_sha, null, null, null);
end $$;
-- Draft + one receipt for an author, ready to submit (runs as postgres).
create function pg_temp.ready_claim(p_uid uuid, p_dept uuid, p_sha text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.login(p_uid);
  v := public.create_claim(p_dept);
  perform public.save_claim_draft(v, 1, p_dept, '테스트', null, (select d from td), 'pickup',
                                  '[{"description":"x","amount_cents":1000}]');
  perform pg_temp.logout();
  perform pg_temp.attach(v, p_uid, 'r-' || left(p_sha, 6) || '.jpg', p_sha);
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
create temp table td as select private.today() as d;
grant select on td to authenticated;

-- ------------------------------------------------------------------ privileges
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
          0, 'anon can execute no public/private function');
select ok(not has_table_privilege('authenticated', 'public.invites', 'select'), 'clients cannot select invites');
select ok(not has_table_privilege('authenticated', 'public.person_logins', 'select'), 'clients cannot select logins');
select ok(not has_column_privilege('authenticated', 'public.people', 'email', 'select'), 'people.email is not readable');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and policyname like 'receipts%' and cmd in ('DELETE', 'UPDATE')),
          'no client delete/update policy on receipt files');
select throws_ok($$ delete from public.audit_logs $$, 'P0001', 'audit_logs is append-only',
                 'audit log cannot be deleted even by postgres');

-- ------------------------------------------------------------------ merged head = elder (business #1)
insert into public.positions (person_id, department_id, role, starts_on)
values ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'dept_head', '2026-01-01');
insert into t values ('merged', pg_temp.ready_claim(pg_temp.uid('000000000002'), '10000000-0000-0000-0000-000000000003', repeat('1', 64)));
select pg_temp.login(pg_temp.uid('000000000002'));
select is((public.submit_claim((select v from t where k = 'merged'), pg_temp.ver((select v from t where k = 'merged'))) ->> 'steps')::int,
          1, 'head = elder gives one merged step');
select pg_temp.logout();
select is((select roles from public.approval_steps where claim_id = (select v from t where k = 'merged')),
          array['dept_head', 'elder'], 'merged step carries both roles');

-- ------------------------------------------------------------------ NULL version is rejected (security #6)
insert into t values ('nullv', pg_temp.ready_claim(pg_temp.uid('000000000002'), '10000000-0000-0000-0000-000000000002', repeat('2', 64)));
select pg_temp.login(pg_temp.uid('000000000002'));
select throws_ok($$ select public.submit_claim((select v from t where k = 'nullv'), null) $$,
                 'P0001', 'stale_or_closed', 'submit with NULL version is rejected');
select public.submit_claim((select v from t where k = 'nullv'), pg_temp.ver((select v from t where k = 'nullv')));
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000003'));
select throws_ok($$ select public.act_on_claim((select v from t where k = 'nullv'), 'approve', null, null, '{}') $$,
                 'P0001', 'stale_or_closed', 'approve with NULL version is rejected');
select throws_ok($$ select public.act_on_claim((select v from t where k = 'nullv'), 'reject', '기타',
                    pg_temp.ver((select v from t where k = 'nullv')), '{}') $$,
                 'P0001', 'reason_required', '"기타" alone is not a reason');
select pg_temp.logout();

-- ------------------------------------------------------------------ withdraw cleans up (business #9)
select pg_temp.login(pg_temp.uid('000000000002'));
select lives_ok($$ select public.withdraw_claim((select v from t where k = 'nullv'), pg_temp.ver((select v from t where k = 'nullv'))) $$,
                'author withdraws before any approval');
select throws_ok($$ select public.delete_draft((select v from t where k = 'nullv'), pg_temp.ver((select v from t where k = 'nullv'))) $$,
                 'P0001', 'has_claim_no', 'a numbered claim cannot be deleted');
select pg_temp.logout();
select is((select count(*)::int from public.notifications
            where claim_id = (select v from t where k = 'nullv') and kind = 'review_requested' and status = 'pending'),
          0, 'withdrawn review request is not sent');

-- ------------------------------------------------------------------ approver cannot also verify/pay (business #2)
-- 최재정 (finance) becomes head of 유년부 for a claim by 김작성.
update public.positions set ends_on = (select d from td) - 1
 where person_id = '20000000-0000-0000-0000-000000000003' and role = 'dept_head';
insert into public.positions (person_id, department_id, role, starts_on)
values ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'dept_head', (select d from td));
insert into t values ('fin', pg_temp.ready_claim(pg_temp.uid('000000000002'), '10000000-0000-0000-0000-000000000002', repeat('3', 64)));
select pg_temp.login(pg_temp.uid('000000000002'));
select public.submit_claim((select v from t where k = 'fin'), pg_temp.ver((select v from t where k = 'fin')));
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000005'));
select public.act_on_claim((select v from t where k = 'fin'), 'approve', null, pg_temp.ver((select v from t where k = 'fin')), '{}');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000004'));
select public.act_on_claim((select v from t where k = 'fin'), 'approve', null, pg_temp.ver((select v from t where k = 'fin')), '{}');
select pg_temp.logout();
select ok(not private.can_handle_finance((select v from t where k = 'fin'), '20000000-0000-0000-0000-000000000005'),
          'finance member who approved cannot verify');
select ok(private.can_handle_finance((select v from t where k = 'fin'), '20000000-0000-0000-0000-000000000006'),
          'finance elder handles it when no independent finance member exists');

-- ------------------------------------------------------------------ payee is fixed at submission (business #3 / security #2)
select pg_temp.login(pg_temp.uid('000000000002'));
select public.update_my_profile('writer@church.test', null, 'CASH', 'ko');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000006'));
select public.receive_claim((select v from t where k = 'fin'), pg_temp.ver((select v from t where k = 'fin')), null);
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'fin')], '5001', (select d from td) + 3, null) $$,
                 'P0001', 'issued_on_in_future', 'check date cannot be in the future');
select ok(public.record_payment(array[(select v from t where k = 'fin')], '005001', (select d from td), null) is not null, 'check recorded');
select pg_temp.logout();
select is((select payee_name from public.payments where check_no = '5001'), 'Writer Kim',
          'payee is the name fixed at submission, not the later profile edit');
select is((select check_no from public.payments where payee_name = 'Writer Kim'), '5001', 'check number normalized');

-- ------------------------------------------------------------------ duplicates (business #4)
insert into t values ('dupA', pg_temp.ready_claim(pg_temp.uid('000000000004'), '10000000-0000-0000-0000-000000000004', repeat('9', 64)));
select throws_ok($$ select pg_temp.attach((select v from t where k = 'dupA'), pg_temp.uid('000000000004'), 'again.jpg', repeat('9', 64)) $$,
                 'P0001', 'duplicate_receipt', 'same file twice in one claim is rejected');

-- ------------------------------------------------------------------ invites (security #5)
insert into t values ('inv', null);
select pg_temp.login(pg_temp.uid('000000000001'));  -- admin
update t set v = null where k = 'inv';
create temp table tok as select public.admin_create_invite('20000000-0000-0000-0000-000000000008') as token;
select pg_temp.logout();
grant select on tok to authenticated;
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '39999999-0000-0000-0000-000000000002', 'authenticated',
        'authenticated', 'guess@example.test', '{"provider":"kakao"}', '{}', now(), now());
select pg_temp.login('39999999-0000-0000-0000-000000000002');
select public.accept_invite((select token from tok), '0000');
select public.accept_invite((select token from tok), '0001');
select public.accept_invite((select token from tok), '0002');
select public.accept_invite((select token from tok), '0003');
select is(public.accept_invite((select token from tok), '0004') ->> 'reason', 'invite_locked', 'fifth wrong guess locks the invite');
select is(public.accept_invite((select token from tok), '0108') ->> 'reason', 'invite_locked', 'correct digits no longer work once locked');
select pg_temp.logout();

-- ------------------------------------------------------------------ admin limits (security #1)
select pg_temp.login(pg_temp.uid('000000000001'));
select throws_ok($$ select public.admin_confirm_in_person('20000000-0000-0000-0000-000000000001') $$,
                 'P0001', 'cannot_confirm_self', 'admin cannot confirm themselves');
select throws_ok($$ select public.admin_assign_position('20000000-0000-0000-0000-000000000002',
                    '10000000-0000-0000-0000-000000000002', 'finance', (select d from td), null) $$,
                 'P0001', 'finance_role_needs_finance_department', 'finance role only in the finance department');
select lives_ok($$ select public.admin_assign_position('20000000-0000-0000-0000-000000000002',
                   '10000000-0000-0000-0000-000000000003', 'elder', (select d from td) + 400, null) $$,
                'admin assigns a future elder role');
select pg_temp.logout();
select ok(not private.is_cleared('20000000-0000-0000-0000-000000000002'),
          'a new role holder is not cleared until confirmed in person');

-- ------------------------------------------------------------------ read scope (security #11)
select pg_temp.login(pg_temp.uid('000000000005'));
select is((select count(*)::int from public.claims where status in ('draft', 'in_review', 'rejected')
             and author_id <> '20000000-0000-0000-0000-000000000005'),
          0, 'finance member cannot read others'' drafts or claims in review');
select pg_temp.logout();

select * from finish();
rollback;
