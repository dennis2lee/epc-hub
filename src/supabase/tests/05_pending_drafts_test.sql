-- Pending accounts keep drafts but cannot submit or see anyone else's data.
begin;
select plan(12);

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
create function pg_temp.ver(p_claim uuid) returns int language sql security definer as $$
  select version from public.claims where id = p_claim $$;
grant execute on all functions in schema pg_temp to authenticated;

create temp table t (k text primary key, v uuid);
grant all on t to authenticated;

-- 김작성 has an active colleague's claim in review, then becomes pending.
select pg_temp.login('30000000-0000-0000-0000-000000000002');
insert into t values ('other', public.create_claim('10000000-0000-0000-0000-000000000002'));
select pg_temp.logout();
update public.people set status = 'pending' where id = '20000000-0000-0000-0000-000000000002';
insert into public.departments (id, name, active) values ('10000000-0000-0000-0000-0000000000ff', '폐지된 부서', false);

select pg_temp.login('30000000-0000-0000-0000-000000000002');
insert into t values ('mine', public.create_claim('10000000-0000-0000-0000-000000000002'));
select lives_ok(
  $$ select public.save_claim_draft((select v from t where k = 'mine'), pg_temp.ver((select v from t where k = 'mine')),
       '10000000-0000-0000-0000-000000000002', '간식', null, current_date, 'pickup',
       jsonb_build_array(jsonb_build_object('description', '간식', 'amount_cents', 1200))) $$,
  'a pending account saves its draft');
select is((select count(*)::int from public.claims where id = (select v from t where k = 'mine')), 1,
  'a pending account reads its own draft');
select is((select count(*)::int from public.claim_lines where claim_id = (select v from t where k = 'mine')), 1,
  'a pending account reads its own draft lines');
select is((select count(*)::int from public.claims where id = (select v from t where k = 'other')), 1,
  'its earlier claim stays readable to its author');
select throws_ok(
  $$ select public.submit_claim((select v from t where k = 'mine'), pg_temp.ver((select v from t where k = 'mine'))) $$,
  null, null, 'a pending account cannot submit');
select ok((select count(*) from public.departments) > 0, 'a pending account lists active departments');
select is((select count(*)::int from public.departments where not active), 0, 'but not inactive ones');
select is((select array_agg(id) from public.people), array['20000000-0000-0000-0000-000000000002'::uuid],
  'a pending account reads only its own person row');
select is((select count(*)::int from public.positions), 0, 'a pending account reads no positions');
select is((select count(*)::int from public.app_settings), 0, 'a pending account reads no settings');
select throws_ok(
  $$ select * from public.preview_approval_line('10000000-0000-0000-0000-000000000002') $$,
  'not_member', 'a pending account cannot see the approval line');
select pg_temp.logout();

-- A different signed-in member never sees the pending author's draft.
select pg_temp.login('30000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.claims where id = (select v from t where k = 'mine')), 0,
  'drafts stay private to their author');
select pg_temp.logout();

select * from finish();
rollback;
