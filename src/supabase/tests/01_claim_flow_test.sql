-- End-to-end claim lifecycle and the internal-control rules (design §5, §6, §12).
-- Uses the local seed (src/supabase/seed.sql). Runs inside a transaction.
begin;
select plan(41);

-- Helpers: act as a seeded login, or as an arbitrary auth uid.
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
create function pg_temp.uid(p_person_suffix text) returns uuid language sql as $$
  select ('30000000-0000-0000-0000-' || p_person_suffix)::uuid
$$;
-- Reads the true version regardless of the caller's RLS visibility.
create function pg_temp.ver(p_claim uuid) returns int language sql security definer as $$
  select version from public.claims where id = p_claim
$$;
-- Simulates the server: upload an object owned by the author, then record it.
create function pg_temp.attach(p_claim uuid, p_author_uid uuid, p_name text, p_sha text) returns uuid
language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('receipts', p_claim::text || '/' || p_name, p_author_uid::text,
          '{"mimetype":"image/jpeg","size":1000}');
  return public.add_attachment_srv(p_author_uid, p_claim, p_claim::text || '/' || p_name, p_sha, 'Costco', null, null);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- Fixed test claim id and a storage object for its receipt.
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
-- Church-local "today", computed as postgres (clients cannot call private.today()).
create temp table td as select private.today() as d;
grant select on td to authenticated;

-- ------------------------------------------------------------------ privileges
select ok(not has_function_privilege('anon', 'public.submit_claim(uuid,int)', 'execute'),
          'anon cannot call submit_claim');
select ok(not has_function_privilege('anon', 'public.act_on_claim(uuid,public.decision_kind,text,int,jsonb)', 'execute'),
          'anon cannot call act_on_claim');
select ok(not has_table_privilege('authenticated', 'public.claims', 'update'),
          'authenticated cannot update claims directly');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'delete'),
          'authenticated cannot delete audit rows');
select ok(not has_function_privilege('authenticated', 'private.notify(uuid,uuid,text)', 'execute'),
          'private.notify is not callable by clients');

-- ------------------------------------------------------------------ unlinked login sees nothing
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '39999999-0000-0000-0000-000000000001', 'authenticated',
        'authenticated', 'stranger@example.test', '{"provider":"kakao"}', '{}', now(), now());

select pg_temp.login('39999999-0000-0000-0000-000000000001');
select is((select count(*)::int from public.people), 0, 'unlinked login reads no people');
select is((select count(*)::int from public.departments), 0, 'unlinked login reads no departments');
select throws_ok($$ select public.create_claim('10000000-0000-0000-0000-000000000002') $$,
                 'P0001', 'not_member', 'unlinked login cannot create a claim');
select pg_temp.logout();

-- ------------------------------------------------------------------ author drafts and submits
select pg_temp.login(pg_temp.uid('000000000002'));  -- 김작성
insert into t values ('claim', public.create_claim('10000000-0000-0000-0000-000000000002'));
select is(public.save_claim_draft(
            (select v from t where k = 'claim'), 1, '10000000-0000-0000-0000-000000000002',
            '성탄 행사 간식', null, (select d from td) - 3, 'pickup',
            '[{"description":"간식","amount_cents":10040},{"description":"음료","amount_cents":2800}]'),
          2, 'draft saved, version bumped');
select is((select total_cents from public.claims where id = (select v from t where k = 'claim')), 12840::bigint,
          'total is the sum of lines in cents');
select throws_ok($$ select public.submit_claim((select v from t where k = 'claim'), 2) $$,
                 'P0001', 'receipt_required', 'cannot submit without a receipt');
select throws_ok($$ select public.add_attachment((select v from t where k = 'claim'), 'x', 'image/jpeg', 1, repeat('a', 64), null, null, null) $$,
                 '42501', null, 'clients cannot record attachments directly');
select pg_temp.logout();

select ok(pg_temp.attach((select v from t where k = 'claim'), pg_temp.uid('000000000002'), 'r1.jpg', repeat('a', 64)) is not null,
          'server records the attachment');

select pg_temp.login(pg_temp.uid('000000000002'));
select throws_ok($$ select public.submit_claim((select v from t where k = 'claim'), 2) $$,
                 'P0001', 'stale_or_closed', 'old version is rejected');
select is((public.submit_claim((select v from t where k = 'claim'), pg_temp.ver((select v from t where k = 'claim'))) ->> 'steps')::int,
          2, 'normal claim has two approval steps');
select is((select status::text from public.claims where id = (select v from t where k = 'claim')), 'in_review', 'claim in review');
select ok((select claim_no from public.claims where id = (select v from t where k = 'claim')) ~ '^\d{4}-\d{4}$',
          'claim number assigned');
select throws_ok($$ select public.act_on_claim((select v from t where k = 'claim'), 'approve', null,
                    pg_temp.ver((select v from t where k = 'claim')), '{}') $$,
                 'P0001', 'author_cannot_act', 'author cannot approve own claim');
select pg_temp.logout();

-- ------------------------------------------------------------------ order of approval
select pg_temp.login(pg_temp.uid('000000000004'));  -- 이장로
select throws_ok($$ select public.act_on_claim((select v from t where k = 'claim'), 'approve', null,
                    pg_temp.ver((select v from t where k = 'claim')), '{}') $$,
                 'P0001', 'not_your_turn', 'elder cannot approve before the department head');
select is((select count(*)::int from public.my_review_queue()), 0, 'elder queue is empty before head approves');
select pg_temp.logout();

select pg_temp.login(pg_temp.uid('000000000003'));  -- 박부장
select is((select count(*)::int from public.my_review_queue()), 1, 'head sees the claim in the queue');
select throws_ok($$ select public.act_on_claim((select v from t where k = 'claim'), 'reject', '  ',
                    pg_temp.ver((select v from t where k = 'claim')), '{}') $$,
                 'P0001', 'reason_required', 'request for changes needs a reason');
select is(public.act_on_claim((select v from t where k = 'claim'), 'approve', null,
                              pg_temp.ver((select v from t where k = 'claim')), '{"ip":"test"}')::text,
          'in_review', 'head approves, claim moves to the elder');
select ok((select snapshot_hash from public.approval_steps
            where claim_id = (select v from t where k = 'claim') and seq = 1) ~ '^[0-9a-f]{64}$',
          'approval stores a content snapshot hash');
select pg_temp.logout();

select pg_temp.login(pg_temp.uid('000000000004'));
select is(public.act_on_claim((select v from t where k = 'claim'), 'approve', null,
                              pg_temp.ver((select v from t where k = 'claim')), '{}')::text,
          'approved', 'elder approves, claim goes to finance');
select pg_temp.logout();

select ok(exists (select 1 from public.notifications n
                   where n.claim_id = (select v from t where k = 'claim') and n.kind = 'finance_requested'
                     and n.recipient_id = '20000000-0000-0000-0000-000000000005'),
          'finance member was notified');

-- ------------------------------------------------------------------ finance
select pg_temp.login(pg_temp.uid('000000000002'));
select throws_ok($$ select public.receive_claim((select v from t where k = 'claim'),
                    pg_temp.ver((select v from t where k = 'claim')), null) $$,
                 'P0001', 'not_finance', 'author cannot verify own claim');
select pg_temp.logout();

select pg_temp.login(pg_temp.uid('000000000005'));  -- 최재정
select is((select count(*)::int from public.finance_queue()), 1, 'finance sees the approved claim');
select lives_ok($$ select public.receive_claim((select v from t where k = 'claim'),
                   pg_temp.ver((select v from t where k = 'claim')), null) $$, 'finance verifies documents');
select ok(public.record_payment(array[(select v from t where k = 'claim')], '1001', (select d from td), null) is not null,
          'check recorded');
select is((select status::text from public.claims where id = (select v from t where k = 'claim')), 'paid', 'claim paid');
select throws_ok($$ select public.record_payment(array[(select v from t where k = 'claim')], '1002', (select d from td), null) $$,
                 'P0001', 'stale_or_closed', 'a paid claim cannot be paid twice');
select pg_temp.logout();

select ok(exists (select 1 from public.audit_logs a
                   where a.entity = 'claims' and a.entity_id = (select v from t where k = 'claim')::text
                     and a.after ->> 'status' = 'paid'),
          'audit log recorded the payment transition');

-- ------------------------------------------------------------------ department head's own claim (A6)
select pg_temp.login(pg_temp.uid('000000000003'));  -- 박부장 writes
insert into t values ('own', public.create_claim('10000000-0000-0000-0000-000000000002'));
select public.save_claim_draft((select v from t where k = 'own'), 1, '10000000-0000-0000-0000-000000000002',
       '교재', null, (select d from td), 'pickup', '[{"description":"교재","amount_cents":5000}]');
select pg_temp.logout();
select pg_temp.attach((select v from t where k = 'own'), pg_temp.uid('000000000003'), 'r.jpg', repeat('b', 64));
select pg_temp.login(pg_temp.uid('000000000003'));
select is((public.submit_claim((select v from t where k = 'own'), pg_temp.ver((select v from t where k = 'own'))) ->> 'steps')::int,
          1, 'head''s own claim has one step');
select ok((select single_approver from public.claims where id = (select v from t where k = 'own')),
          'marked as single approver');
select is((select approver_id from public.approval_steps where claim_id = (select v from t where k = 'own')),
          '20000000-0000-0000-0000-000000000004'::uuid, 'the elder is the only approver');
select pg_temp.logout();

-- ------------------------------------------------------------------ request changes and resubmit (A3)
select pg_temp.login(pg_temp.uid('000000000004'));
select is(public.act_on_claim((select v from t where k = 'own'), 'reject', '영수증 누락',
                              pg_temp.ver((select v from t where k = 'own')), '{}')::text,
          'rejected', 'elder requests changes');
select pg_temp.logout();
select pg_temp.login(pg_temp.uid('000000000003'));
select lives_ok($$ select public.start_revision((select v from t where k = 'own'), pg_temp.ver((select v from t where k = 'own'))) $$,
                'author starts a revision');
select is(((public.submit_claim((select v from t where k = 'own'), pg_temp.ver((select v from t where k = 'own')))) ->> 'status'),
          'in_review', 'resubmitted');
select is((select round from public.claims where id = (select v from t where k = 'own')), 2, 'new round');
select pg_temp.logout();

-- ------------------------------------------------------------------ church-local dates (D7)
select is(private.local_date('2027-01-01 06:00:00+00', 'America/Los_Angeles'), '2026-12-31'::date,
          'New Year''s Eve evening in Los Angeles is still Dec 31');

select * from finish();
rollback;
