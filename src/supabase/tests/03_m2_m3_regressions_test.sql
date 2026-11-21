-- Regression tests for the M2 and M3 red-team findings
-- (doc/reviews/2026-11-21-m2-redteam.md, doc/reviews/2026-11-21-m3-redteam.md).
begin;
select plan(34);

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
create function pg_temp.total(p_claim uuid) returns bigint language sql security definer as $$
  select total_cents from public.claims where id = p_claim $$;
create function pg_temp.attach(p_claim uuid, p_uid uuid, p_name text, p_sha text) returns uuid language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('receipts', p_claim::text || '/' || p_name, null, '{"mimetype":"image/jpeg","size":10}');
  return public.add_attachment_srv(p_uid, p_claim, p_claim::text || '/' || p_name, p_sha, null, null, null);
end $$;
-- A claim of 김작성 (유년부) approved by 박부장 and 이장로 and verified by 최재정.
create function pg_temp.received_claim(p_sha text, p_cents int) returns uuid language plpgsql as $$
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
  perform pg_temp.login(pg_temp.uid('000000000003'));
  perform public.act_on_claim(v, 'approve', '', pg_temp.ver(v), '{}');
  perform pg_temp.logout();
  perform pg_temp.login(pg_temp.uid('000000000004'));
  perform public.act_on_claim(v, 'approve', '', pg_temp.ver(v), '{}');
  perform pg_temp.logout();
  perform pg_temp.login(pg_temp.uid('000000000005'));
  perform public.receive_claim(v, pg_temp.ver(v), null);
  perform pg_temp.logout();
  return v;
end $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
create temp table td as select private.today() as d;
grant select on td to authenticated;

-- ================================================================== M2
-- Receipt files are written only by the server.
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                       and policyname like 'receipts%' and cmd in ('INSERT', 'ALL')),
          'no client insert policy on receipt files');
select ok(not has_function_privilege('authenticated', 'public.can_upload_receipt_srv(uuid, uuid)', 'execute'),
          'upload pre-check is server-only');

-- A file is readable only through its attachment row.
insert into t values ('r1', pg_temp.received_claim(repeat('a', 64), 2500));
insert into storage.objects (bucket_id, name, metadata)
values ('receipts', (select v from t where k = 'r1')::text || '/stray.jpg', '{"mimetype":"image/jpeg","size":5}');
select pg_temp.login(pg_temp.uid('000000000003'));
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'
            and name like (select v from t where k = 'r1')::text || '/%'),
          1, 'an approver sees the recorded receipt but not a stray file');
select pg_temp.logout();

-- Email change notifies the old address.
select pg_temp.login(pg_temp.uid('000000000002'));
select public.update_my_profile('new-writer@church.test', null, 'Writer Kim', 'ko');
select pg_temp.logout();
select is((select to_address from public.notifications where kind = 'email_changed' order by created_at desc limit 1),
          'writer@church.test', 'email change queues a notice to the old address');
update public.people set email = 'writer@church.test' where id = pg_temp.pid('000000000002');

-- A claim whose next approver has no email shows on the stuck list at once.
insert into t values ('na', null);
select pg_temp.login(pg_temp.uid('000000000002'));
update t set v = public.create_claim('10000000-0000-0000-0000-000000000002') where k = 'na';
select public.save_claim_draft((select v from t where k = 'na'), 1, '10000000-0000-0000-0000-000000000002', '알림 시험', null,
                               (select d from td), 'pickup', '[{"description":"x","amount_cents":700}]');
select pg_temp.logout();
select pg_temp.attach((select v from t where k = 'na'), pg_temp.uid('000000000002'), 'na.jpg', repeat('b', 64));
select pg_temp.login(pg_temp.uid('000000000002'));
select public.submit_claim((select v from t where k = 'na'), pg_temp.ver((select v from t where k = 'na')));
select pg_temp.logout();
update public.notifications set status = 'no_address'
 where claim_id = (select v from t where k = 'na') and kind = 'review_requested';
select pg_temp.login(pg_temp.uid('000000000001'));
select is((select problem from public.stuck_claims() where claim_id = (select v from t where k = 'na')),
          'notify_failed', 'unsent review request is on the stuck list');
select pg_temp.logout();

-- Admin can lift a suspension; a confirmed role holder goes back to active.
select pg_temp.login(pg_temp.uid('000000000001'));
select public.admin_set_person_status(pg_temp.pid('000000000007'), 'suspended');
select public.admin_reactivate_person(pg_temp.pid('000000000007'));
select pg_temp.logout();
select is((select status::text from public.people where id = pg_temp.pid('000000000007')), 'active',
          'suspension lifted');
select ok(not exists (select 1 from information_schema.routines r
                       join information_schema.parameters p on p.specific_name = r.specific_name
                      where r.routine_name = 'admin_people' and p.parameter_mode = 'OUT' and p.parameter_name in ('email', 'phone_e164')),
          'admin_people does not send full contact details');

-- ================================================================== M3: check numbers and amounts
select pg_temp.login(pg_temp.uid('000000000005'));
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], '#7001', (select d from td), null, 2500) $$,
                 'P0001', 'check_no_invalid', '"#7001" is not a check number');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], '70 01', (select d from td), null, 2500) $$,
                 'P0001', 'check_no_invalid', 'a space inside the number is rejected');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], 'NO CHECK', (select d from td), null, 2500) $$,
                 'P0001', 'check_no_invalid', 'a payment without a number is rejected');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], '0000', (select d from td), null, 2500) $$,
                 'P0001', 'check_no_invalid', 'all zeros is rejected');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], '7001', (select d from td), null, 2400) $$,
                 'P0001', 'amount_mismatch', 'typed check amount must match the claims');
insert into t values ('p1', public.record_payment(array[(select v from t where k = 'r1')], '７００１', (select d from td), null, 2500));
select pg_temp.logout();
select is((select check_no from public.payments where id = (select v from t where k = 'p1')), '7001',
          'full-width digits are normalized');

-- ================================================================== M3: clearing (D21)
select pg_temp.login(pg_temp.uid('000000000005'));
select throws_ok($$ select public.mark_check_cleared((select v from t where k = 'p1'), (select d from td)) $$,
                 'P0001', 'issuer_cannot_clear', 'the issuer cannot record clearing when someone else can');
select is((select can_clear from public.finance_payments(null) where payment_id = (select v from t where k = 'p1')), false,
          'the screen hides the clear button for the issuer');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000006'));  -- 정재정장로
select lives_ok($$ select public.mark_check_cleared((select v from t where k = 'p1'), (select d from td)) $$,
                'another finance member records clearing');
select pg_temp.logout();
select is((select cleared_by from public.payments where id = (select v from t where k = 'p1')), pg_temp.pid('000000000006'),
          'who recorded clearing is kept');
select pg_temp.login(pg_temp.uid('000000000007'));  -- 한감사
select ok((select count(*) from public.finance_payments(null)) >= 1, 'an auditor can read the check list');
select throws_ok($$ select public.unmark_check_cleared((select v from t where k = 'p1'), '날짜 잘못 기록') $$,
                 'P0001', 'not_finance', 'an auditor cannot change clearing');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000006'));
select throws_ok($$ select public.unmark_check_cleared((select v from t where k = 'p1'), '') $$,
                 'P0001', 'reason_required', 'correcting a clearing needs a reason');
select lives_ok($$ select public.unmark_check_cleared((select v from t where k = 'p1'), '날짜 잘못 기록') $$,
                'clearing can be corrected');
select pg_temp.logout();
select is((select array_agg(kind order by kind) from public.payment_events where payment_id = (select v from t where k = 'p1')),
          array['cleared', 'issued', 'uncleared'], 'every check event is kept');
select throws_ok($$ delete from public.payment_events $$, 'P0001', 'append_only', 'check events cannot be deleted');

-- ================================================================== M3: void and reissue (D20)
select pg_temp.login(pg_temp.uid('000000000005'));
select throws_ok($$ select public.void_payment((select v from t where k = 'p1'), '기타') $$,
                 'P0001', 'reason_required', 'void needs a real reason');
select lives_ok($$ select public.void_payment((select v from t where k = 'p1'), '수표 금액 오기재') $$, 'issuer voids the check');
select is((select status::text from public.claims where id = (select v from t where k = 'r1')), 'received',
          'the claim goes back to verified');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'r1')], '7001', (select d from td), null, 2500) $$,
                 'P0001', 'check_no_taken', 'a voided number is never reused');
insert into t values ('p2', public.record_payment(array[(select v from t where k = 'r1')], '7002', (select d from td), null, 2500));
select pg_temp.logout();
select is((select replaces_payment_id from public.payments where id = (select v from t where k = 'p2')), (select v from t where k = 'p1'),
          'the reissued check points to the voided one');

-- ================================================================== M3: export (D19)
select pg_temp.login(pg_temp.uid('000000000007'));
select is((select array_agg(check_no || ':' || amount_cents order by check_no)
             from public.finance_export(to_char((select d from td), 'YYYY-MM'))
            where claim_no = (select claim_no from public.claims where id = (select v from t where k = 'r1'))),
          array['7001:0', '7002:2500'], 'export lists the void check at 0 and the reissue');
select pg_temp.logout();
select ok(exists (select 1 from public.audit_logs where entity = 'finance_export' and action = 'export'),
          'the download is logged');

-- ================================================================== M3: return after verification (D22)
insert into t values ('r2', pg_temp.received_claim(repeat('c', 64), 1200));
select pg_temp.login(pg_temp.uid('000000000005'));
select lives_ok($$ select public.return_claim((select v from t where k = 'r2'), pg_temp.ver((select v from t where k = 'r2')), '영수증 금액 불일치') $$,
                'a verified claim can be returned for documents');
select throws_ok($$ select public.return_claim((select v from t where k = 'r1'), pg_temp.ver((select v from t where k = 'r1')), '영수증 금액 불일치') $$,
                 'P0001', 'stale_or_closed', 'a paid claim cannot be returned');
select pg_temp.logout();

-- ================================================================== M3: print shows no stale approvals
select pg_temp.login(pg_temp.uid('000000000002'));
select public.start_revision((select v from t where k = 'r2'), pg_temp.ver((select v from t where k = 'r2')));
select public.save_claim_draft((select v from t where k = 'r2'), pg_temp.ver((select v from t where k = 'r2')),
                               '10000000-0000-0000-0000-000000000002', '테스트', null, (select d from td), 'pickup',
                               '[{"description":"x","amount_cents":990000}]');
select is((select count(*)::int from public.claim_print_steps((select v from t where k = 'r2')) where valid), 0,
          'after a revision the print view marks no approval as valid');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000007'));
select is((select count(*)::int from public.claim_print_steps((select v from t where k = 'r1')) where valid), 2,
          'a paid claim prints both approvals as valid');
select pg_temp.logout();

select * from finish();
rollback;
