-- Regression tests for the M4 red-team findings (doc/reviews/2026-11-22-m4-redteam.md).
begin;
select plan(40);

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
create function pg_temp.pid(p text) returns uuid language sql as $$ select ('20000000-0000-0000-0000-' || p)::uuid $$;
create function pg_temp.ver(p_claim uuid) returns int language sql security definer as $$
  select version from public.claims where id = p_claim $$;
create function pg_temp.attach(p_claim uuid, p_uid uuid, p_name text, p_sha text) returns uuid language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('receipts', p_claim::text || '/' || p_name, null, '{"mimetype":"image/jpeg","size":10}');
  return public.add_attachment_srv(p_uid, p_claim, p_claim::text || '/' || p_name, p_sha, null, null, null);
end $$;
-- A submitted claim of 김작성 (유년부) with one receipt.
create function pg_temp.submitted(p_sha text, p_cents int) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.login(pg_temp.uid('000000000002'));
  v := public.create_claim('10000000-0000-0000-0000-000000000002');
  perform public.save_claim_draft(v, 1, '10000000-0000-0000-0000-000000000002', '테스트', null, (select d from td), 'pickup',
                                  jsonb_build_array(jsonb_build_object('description', 'x', 'amount_cents', p_cents)));
  perform pg_temp.logout();
  perform pg_temp.attach(v, pg_temp.uid('000000000002'), 'r-' || left(p_sha, 6) || '.jpg', p_sha);
  perform pg_temp.login(pg_temp.uid('000000000002'));
  perform public.submit_claim(v, pg_temp.ver(v));
  perform pg_temp.logout();
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
create temp table td as select private.today() as d;
grant select on td to authenticated;

-- ------------------------------------------------------------------ anon has no table privileges
select is((select count(*)::int from information_schema.role_table_grants
            where grantee = 'anon' and table_schema = 'public'), 0, 'anon holds no privilege on any public table');

-- ------------------------------------------------------------------ service-only functions
select ok(not has_function_privilege('authenticated', 'public.bootstrap_first_admin(uuid, text, text, text, text)', 'execute'),
          'bootstrap_first_admin is not callable by users');
select ok(not has_function_privilege('authenticated', 'public.invite_open_srv(text)', 'execute'),
          'invite_open_srv is not callable by users');
select throws_ok($$ select public.bootstrap_first_admin(gen_random_uuid(), 'x', null, null, '초기 설정') $$,
                 'P0001', 'admin_exists', 'bootstrap refuses when an active admin exists');

-- ------------------------------------------------------------------ duplicate hints (same amount and date)
insert into t values ('d1', pg_temp.submitted(repeat('a', 64), 4321));
insert into t values ('d2', pg_temp.submitted(repeat('b', 64), 4321));
select ok(exists (select 1 from public.claim_duplicates where claim_id = (select v from t where k = 'd2')
                   and other_claim_id = (select v from t where k = 'd1') and reason = 'same_amount_date'),
          'same author, total and date is flagged');
select ok((select dup_warning from public.claims where id = (select v from t where k = 'd2')), 'flag sets dup_warning');
select ok(not (select dup_warning from public.claims where id = (select v from t where k = 'd1')), 'the earlier claim is not flagged');

-- Another author in the same department: flagged, but hidden from that author.
update public.positions set ends_on = (select d from td) - 1
 where person_id = pg_temp.pid('000000000003') and role = 'dept_head';
insert into public.positions (person_id, department_id, role, starts_on)
values (pg_temp.pid('000000000004'), '10000000-0000-0000-0000-000000000002', 'dept_head', (select d from td));
select pg_temp.login(pg_temp.uid('000000000003'));
insert into t values ('d3', public.create_claim('10000000-0000-0000-0000-000000000002'));
select public.save_claim_draft((select v from t where k = 'd3'), 1, '10000000-0000-0000-0000-000000000002', '간식', null,
                               (select d from td), 'pickup', '[{"description":"x","amount_cents":4321}]');
select pg_temp.logout();
select pg_temp.attach((select v from t where k = 'd3'), pg_temp.uid('000000000003'), 'r-ccc.jpg', repeat('c', 64));
select pg_temp.login(pg_temp.uid('000000000003'));
select public.submit_claim((select v from t where k = 'd3'), pg_temp.ver((select v from t where k = 'd3')));
select is((select count(*)::int from public.claim_duplicates where claim_id = (select v from t where k = 'd3')), 0,
          'the author cannot see a hint that points at another person''s claim');
select pg_temp.logout();
select ok(exists (select 1 from public.claim_duplicates where claim_id = (select v from t where k = 'd3') and reason = 'dept_amount_date'),
          'same department, total and date across authors is flagged');
select pg_temp.login(pg_temp.uid('000000000004'));
select is((select count(*)::int from public.claim_duplicates where claim_id = (select v from t where k = 'd3')), 2,
          'the approver sees the department-wide hint');
select pg_temp.logout();
-- Restore the original head.
delete from public.positions where person_id = pg_temp.pid('000000000004') and role = 'dept_head';
update public.positions set ends_on = null where person_id = pg_temp.pid('000000000003') and role = 'dept_head';

-- ------------------------------------------------------------------ author notices that cannot be sent are stuck
select pg_temp.login(pg_temp.uid('000000000003'));
select public.act_on_claim((select v from t where k = 'd1'), 'reject', '영수증 누락', pg_temp.ver((select v from t where k = 'd1')), '{}');
select pg_temp.logout();
update public.notifications set status = 'no_address'
 where claim_id = (select v from t where k = 'd1') and kind = 'changes_requested';
select pg_temp.login(pg_temp.uid('000000000001'));
select is((select problem from public.stuck_claims() where claim_id = (select v from t where k = 'd1')), 'notify_failed',
          'a sent-back claim whose author could not be emailed is on the stuck list');
select is((select waiting_on from public.stuck_claims() where claim_id = (select v from t where k = 'd1')), '김작성',
          'the stuck row says it waits on the author');
-- Thresholds: an approver step is late after 8 days, not 2.
select ok(not exists (select 1 from public.stuck_claims() where claim_id = (select v from t where k = 'd2')),
          'a claim submitted today is not stuck');
select pg_temp.logout();
update public.claims set updated_at = now() - interval '3 days' where id = (select v from t where k = 'd2');
select pg_temp.login(pg_temp.uid('000000000001'));
select ok(not exists (select 1 from public.stuck_claims() where claim_id = (select v from t where k = 'd2')),
          'three days in review is not stuck yet');
select pg_temp.logout();
update public.claims set updated_at = now() - interval '9 days' where id = (select v from t where k = 'd2');
select pg_temp.login(pg_temp.uid('000000000001'));
select is((select problem from public.stuck_claims() where claim_id = (select v from t where k = 'd2')), 'waiting',
          'nine days in review is stuck');
select is((select author from public.stuck_claims() where claim_id = (select v from t where k = 'd2')), '김작성',
          'the stuck row names the author');
select pg_temp.logout();

-- ------------------------------------------------------------------ admin cancel only for authors who cannot act
select pg_temp.login(pg_temp.uid('000000000001'));
select throws_ok($$ select public.admin_cancel_claim((select v from t where k = 'd1'), pg_temp.ver((select v from t where k = 'd1')), '교회를 떠나심') $$,
                 'P0001', 'author_active', 'an active author cancels their own claim');
select public.admin_set_person_status(pg_temp.pid('000000000002'), 'suspended');
select throws_ok($$ select public.admin_cancel_claim((select v from t where k = 'd2'), pg_temp.ver((select v from t where k = 'd2')), '교회를 떠나심') $$,
                 'P0001', 'not_cancellable', 'a claim in review is sent back first');
select lives_ok($$ select public.admin_cancel_claim((select v from t where k = 'd1'), pg_temp.ver((select v from t where k = 'd1')), '교회를 떠나심') $$,
                'a suspended author''s sent-back claim can be cancelled by the office');
select pg_temp.logout();
select is((select status::text from public.claims where id = (select v from t where k = 'd1')), 'cancelled', 'claim is cancelled');
select ok(exists (select 1 from public.audit_logs where action = 'admin_cancel' and entity_id = (select v from t where k = 'd1')::text),
          'the cancel is in the audit log');
select pg_temp.login(pg_temp.uid('000000000001'));
select public.admin_reactivate_person(pg_temp.pid('000000000002'));

-- ------------------------------------------------------------------ relink a login
select throws_ok($$ select public.admin_relink_person(pg_temp.pid('000000000001'), '휴대폰 바꿈') $$,
                 'P0001', 'cannot_change_self', 'an admin cannot relink themself');
select throws_ok($$ select public.admin_relink_person(pg_temp.pid('000000000003'), '짧음') $$,
                 'P0001', 'reason_required', 'relink needs a reason');
select public.admin_relink_person(pg_temp.pid('000000000003'), '카카오로 로그인하심');
select pg_temp.logout();
select is((select count(*)::int from public.person_logins where person_id = pg_temp.pid('000000000003')), 0, 'old logins are removed');
select is((select status::text from public.people where id = pg_temp.pid('000000000003')), 'invited', 'person is invited again');
select ok((select in_person_checked_at is null from public.people where id = pg_temp.pid('000000000003')),
          'an approver needs a new in-person check');
select ok(exists (select 1 from public.notifications where recipient_id = pg_temp.pid('000000000003') and kind = 'login_reset'
                   and to_address = 'head@church.test'), 'the old address is told');
select pg_temp.login(pg_temp.uid('000000000001'));
select ok(public.admin_create_invite(pg_temp.pid('000000000003')) is not null, 'a new invite can be made after relink');

-- ------------------------------------------------------------------ admin edit of a person
select throws_ok($$ select public.admin_update_person(pg_temp.pid('000000000005'), '최재정', 'Finance Choi', '+12135550105',
                                                       'new@church.test', '집사', '') $$,
                 'P0001', 'reason_required', 'editing a linked person needs a reason');
select public.admin_update_person(pg_temp.pid('000000000005'), '최재정', 'Finance Choi', '+12135550105',
                                  'new@church.test', '집사', '본인 요청으로 메일 변경');
select pg_temp.logout();
select ok(exists (select 1 from public.notifications where recipient_id = pg_temp.pid('000000000005') and kind = 'email_changed'
                   and to_address = 'finance@church.test'), 'the old address is told about the change');

-- ------------------------------------------------------------------ grants
select pg_temp.login(pg_temp.uid('000000000001'));
select throws_ok($$ select public.admin_grant(pg_temp.pid('000000000005'), 'auditor', '2026-12 당회 결의') $$,
                 'P0001', 'auditor_not_independent', 'a finance member cannot be an auditor');
select throws_ok($$ select public.admin_grant(pg_temp.pid('000000000003'), 'admin', '2026-12 당회 결의') $$,
                 'P0001', 'grantee_not_cleared', 'admin goes only to an active, confirmed person');
insert into t values ('g', public.admin_grant(pg_temp.pid('000000000004'), 'admin', '2026-12 당회 결의'));
select ok((select v from t where k = 'g') is not null, 'a second admin can be granted');
select throws_ok($$ select public.admin_revoke((select id from public.admin_grants where person_id = pg_temp.pid('000000000001')
                                                  and grant_kind = 'admin'), '임기가 끝났음') $$,
                 'P0001', 'cannot_change_self', 'an admin cannot revoke their own grant');
select lives_ok($$ select public.admin_revoke((select v from t where k = 'g'), '시험 정리') $$, 'another admin''s grant can be revoked');
select pg_temp.logout();

-- ------------------------------------------------------------------ linking fills a missing email
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', pg_temp.uid('000000000008'), 'authenticated', 'authenticated', 'oh@church.test', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into public.person_logins (auth_user_id, person_id, provider, linked_via)
values (pg_temp.uid('000000000008'), pg_temp.pid('000000000008'), 'email', 'invite');
select is((select email from public.people where id = pg_temp.pid('000000000008')), 'oh@church.test',
          'linking by email code fills in a missing notification address');

-- ------------------------------------------------------------------ digest run is finished only after sending
delete from public.digest_runs where run_date = private.today();
select ok(public.claim_digest_run_srv(), 'first claim of the day succeeds');
select ok(not public.claim_digest_run_srv(), 'a second claim right away is refused');
select public.release_digest_run_srv();
select ok(public.claim_digest_run_srv(), 'after a release the day can be claimed again');
select public.finish_digest_run_srv();
update public.digest_runs set claimed_at = now() - interval '1 hour' where run_date = private.today();
select ok(not public.claim_digest_run_srv(), 'a finished day is never claimed again');

select * from finish();
rollback;
