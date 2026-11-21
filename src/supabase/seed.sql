-- Local development seed (fictional people). Never run against production.
-- Every seeded login uses email-code sign-in; codes arrive in the local Mailpit
-- inbox (http://127.0.0.1:54324).

-- Fixed ids make the seed easy to reference in docs and tests.
insert into public.departments (id, name, name_en, parent_id, is_finance) values
  ('10000000-0000-0000-0000-000000000001', '교육위원회', 'Education Committee', null, false),
  ('10000000-0000-0000-0000-000000000002', '유년부', 'Children', '10000000-0000-0000-0000-000000000001', false),
  ('10000000-0000-0000-0000-000000000003', 'EM 청년부', 'EM Young Adults', '10000000-0000-0000-0000-000000000001', false),
  ('10000000-0000-0000-0000-000000000004', '재정부', 'Finance', null, true);

insert into public.people (id, name, legal_name_en, phone_e164, email, church_title, status, needs_in_person_check) values
  ('20000000-0000-0000-0000-000000000001', '관리자', 'Admin Dev', '+12135550101', 'admin@church.test', '집사', 'active', true),
  ('20000000-0000-0000-0000-000000000002', '김작성', 'Writer Kim', '+12135550102', 'writer@church.test', '집사', 'active', false),
  ('20000000-0000-0000-0000-000000000003', '박부장', 'Head Park', '+12135550103', 'head@church.test', '권사', 'active', true),
  ('20000000-0000-0000-0000-000000000004', '이장로', 'Elder Lee', '+12135550104', 'elder@church.test', '장로', 'active', true),
  ('20000000-0000-0000-0000-000000000005', '최재정', 'Finance Choi', '+12135550105', 'finance@church.test', '집사', 'active', true),
  ('20000000-0000-0000-0000-000000000006', '정재정장로', 'Finance Elder Jung', '+12135550106', 'felder@church.test', '장로', 'active', true),
  ('20000000-0000-0000-0000-000000000007', '한감사', 'Auditor Han', '+12135550107', 'auditor@church.test', '장로', 'active', true),
  ('20000000-0000-0000-0000-000000000008', '오초대', 'Invitee Oh', '+12135550108', null, '성도', 'invited', false);

insert into public.positions (person_id, department_id, role, starts_on) values
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'dept_head', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'elder', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004', 'finance', '2026-01-01'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000004', 'finance_elder', '2026-01-01');

insert into public.admin_grants (person_id, grant_kind, basis) values
  ('20000000-0000-0000-0000-000000000001', 'admin', 'seed'),
  ('20000000-0000-0000-0000-000000000007', 'auditor', 'seed');

-- Auth users for the seeded people (email provider), linked through person_logins.
do $$
declare
  r record;
begin
  for r in
    select p.id as person_id, p.email,
           ('30000000-0000-0000-0000-' || right(p.id::text, 12))::uuid as uid
      from public.people p
     where p.email is not null
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.uid, 'authenticated', 'authenticated', r.email, now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), r.uid::text, r.uid,
            jsonb_build_object('sub', r.uid::text, 'email', r.email, 'email_verified', true),
            'email', now(), now(), now());
    insert into public.person_logins (auth_user_id, person_id, provider, linked_via)
    values (r.uid, r.person_id, 'email', 'admin');
  end loop;
end
$$;
