# 클라우드 배포 절차 (리허설용)

Supabase·Vercel·카카오·Resend 계정은 교회 공용 계정으로 만든다(개인 계정 금지, `doc/operations.md` 8장). 아래 절차는 계정 소유자가 직접 한다. 개발 담당은 비밀값을 문서·채팅에 옮기지 않는다.

## 확정한 구성 (2026-11-22)

- 서비스: Vercel(화면·서버) + Supabase(DB·파일·로그인) + Resend(메일) + 카카오(로그인). AWS·Cloudflare 단일 구성과 교회 맥미니 운영은 검토 후 택하지 않았다(D40).
- 계정 소유 메일: 교회 Google Workspace의 기술 담당 공용 주소. 기술 담당 두 명이 받을 수 있게 그룹 메일로 둔다.
- 교회 도메인 `epcsj.org`: 홈페이지(`www`)는 Squarespace, DNS도 Squarespace(Domains → DNS 설정), 교회 메일은 Google Workspace(MX). 아래 레코드는 기존 홈페이지·메일과 겹치지 않는다.

| 용도 | 주소 | DNS 레코드 (Squarespace에 추가) |
|---|---|---|
| 운영 화면 | `claims.epcsj.org` | CNAME → Vercel이 알려 주는 값(보통 `cname.vercel-dns.com`) |
| 미리보기 화면 | `preview.epcsj.org` | CNAME → 같은 값 |
| 알림·로그인 코드 메일 | 보내는 주소 `no-reply@notify.epcsj.org` | Resend가 알려 주는 `notify.epcsj.org`의 MX·TXT(SPF)·TXT(DKIM). 루트 `epcsj.org`의 Google 메일 설정은 건드리지 않는다 |

- `MAIL_FROM` 예: `교회 지출청구 <no-reply@notify.epcsj.org>`(보내는 이름은 교회가 정한다). Supabase Auth SMTP의 보내는 주소도 같다.
- 메일에 회신하면 사라지므로, 본문의 안내대로 문의는 사무실로 한다.

## 0. 준비물

| 항목 | 메모 |
|---|---|
| Supabase 프로젝트 2개 | `intra-net-prod`(운영, **Pro 필수**: 무료는 백업이 없고 7일 쉬면 멈춘다), `intra-net-preview`(미리보기, 무료). 리전은 미국 서부(`us-west-1`) |
| Vercel 프로젝트 1개 | GitHub `dennis2lee/intra-net` 연결. 함수 리전은 `vercel.json`의 `sfo1`(Supabase와 같은 서부) |
| 도메인 | `claims.epcsj.org`(운영), `preview.epcsj.org`(미리보기 고정 주소). Squarespace DNS 관리 권한이 필요하다 |
| Resend | 보내는 도메인 `notify.epcsj.org` 인증(SPF·DKIM). 앱 알림과 Supabase 인증 메일(로그인 코드)이 함께 쓴다 |
| 카카오 개발자 앱 | `doc/kakao-trial.md` 1~5단계 |
| age 키 한 쌍 | 백업 암호화용(`doc/operations.md` 7장). 공개 키만 백업 설정에 넣는다 |

## 1. DB (운영과 미리보기 각각)

운영 DB에는 아래 한 경로로만 변경을 적용한다(설계서 12장, D8).

```bash
npm run db:reset
```

```bash
npm run db:test
```

```bash
npx supabase link --workdir src --project-ref <프로젝트 ref>
```

```bash
npx supabase db push --workdir src
```

- `seed.sql`과 `seeds/`는 운영에 넣지 않는다(가상 인물, 시험 버킷). `db push`는 시드를 넣지 않는다.
- **운영에 `trial` 버킷이 없는지 확인한다**(Storage 화면). 미리보기 프로젝트에만 실기기 시험 때 SQL 편집기로 `src/supabase/seeds/trial_bucket.sql`을 넣고, 시험이 끝나면 버킷과 정책을 지운다(D37).

### 1-1. Auth 설정 (대시보드, 두 프로젝트 모두)

`db push`는 `src/supabase/config.toml`의 인증 설정을 옮기지 않는다. 아래를 손으로 맞춘다. 하나라도 빠지면 주일 등록 데스크에서 로그인 코드가 오지 않는다.

| 화면 | 설정 | 값 |
|---|---|---|
| Authentication → URL Configuration | Site URL | 운영 `https://claims.epcsj.org`, 미리보기 `https://preview.epcsj.org` |
| 같은 화면 | Redirect URLs | `https://claims.epcsj.org/auth/callback**`, 미리보기는 `https://preview.epcsj.org/auth/callback**` |
| Authentication → Emails → SMTP | Custom SMTP | 켬. Resend SMTP, 보내는 주소 `no-reply@notify.epcsj.org`, 보내는 이름은 `MAIL_FROM`과 같게 |
| Authentication → Emails → Templates | Magic Link, Confirm signup | `src/supabase/templates/otp.html` 내용(6자리 코드) |
| Authentication → Providers → Email | Confirm email | 켬 |
| 같은 화면 | Email OTP expiration | 600초(10분) |
| 같은 화면 | Email OTP length | 6 (로그인 화면이 6자리만 받는다) |
| Authentication → Rate Limits | 메일 발송 | 시간당 100통 이상(등록 데스크 한 번에 40명 기준) |
| 같은 화면 | 같은 주소 재요청 간격 | 60초 ("코드 다시 받기는 1분 뒤") |
| Authentication → Providers → Kakao | 켬 | **방식 2(운영 버튼)도 이 설정이 필요하다.** Client ID = `KAKAO_REST_API_KEY`, "Allow users without an email" 켬 |

### 1-2. 첫 관리자 (운영, 한 번만)

1. 첫 관리자가 운영 주소의 로그인 화면에서 메일 코드로 한 번 로그인한다. "등록되지 않은 계정" 화면이 나오면 정상이다.
   - 초대 없이 새 계정을 만들 수 없으므로(D27), 계정 소유자가 Supabase 대시보드 Authentication → Users → "Add user"로 그 메일 주소를 먼저 만든다.
2. 대시보드 Authentication → Users에서 그 사용자의 UID를 복사한다.
3. SQL 편집기에서 아래를 실행한다(service role 권한). 감사 기록에 "초기 설정"으로 남는다. 관리자가 이미 있으면 거부된다.

```sql
select public.bootstrap_first_admin('<UID>', '<이름>', '+1XXXXXXXXXX', '<메일>', '<당회 결의 날짜 등 근거>');
```

4. 그 뒤 모든 일은 앱의 관리자 화면에서 한다. 두 번째 관리자·감사위원 권한도 관리자 화면 → **관리자·감사위원 권한**에서 준다(D30). 첫 관리자의 대면 확인은 두 번째 관리자가 한다.

## 2. Vercel 환경변수

| 변수 | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | 운영 프로젝트 값 | **미리보기 프로젝트 값** |
| `SUPABASE_PROD_REF` | 운영 프로젝트 ref | **같은 값(필수)**. 미리보기가 운영 DB를 가리키면 시작하지 않는다(D38) |
| `NEXT_PUBLIC_SITE_URL` | `https://claims.epcsj.org` | `https://preview.epcsj.org`(고정 주소. 배포마다 바뀌는 주소를 쓰면 카카오 로그인이 실패한다) |
| `NEXT_PUBLIC_CHURCH_TIME_ZONE` | `America/Los_Angeles` (교회 확인) | 같음 |
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 앱 값 | 같음 |
| `CRON_SECRET` | 32자 이상 임의 문자열 | 다른 값 |
| `RESEND_API_KEY`, `MAIL_FROM` | 운영 값. 둘 다 없으면 운영에서 오류로 멈춘다 | 테스트 키, 같은 형식의 보내는 주소 |
| `NEXT_PUBLIC_OFFICE_PHONE` | 사무실 번호 | 같음 |
| `NEXT_PUBLIC_KAKAO_OPTION1` | 비움 | 실기기 시험 때만 `1` |
| `TRIAL_PAGES` | **비움** | 실기기 시험 때만 `1` |

- Vercel에서 변수를 추가할 때 기본값이 "모든 환경"이다. 범위를 반드시 골라 넣는다. 다 넣은 뒤 아래로 확인한다.

```bash
npx vercel env ls
```

- 미리보기 고정 주소(`preview.epcsj.org`)는 Vercel → Domains에서 `main`이 아닌 미리보기 브랜치에 연결한다. 카카오 앱과 미리보기 Supabase Redirect URLs에도 이 주소를 넣는다.
- Vercel → Deployment Protection: 교인이 미리보기 주소를 카톡에서 열면 Vercel 로그인 화면이 나온다. 실기기 시험 기간에만 그 고정 주소의 보호를 끈다.

## 3. 배포와 확인

1. `main`에 병합하면 Vercel이 배포한다. GitHub Actions CI(`check`, `database`)가 먼저 통과해야 한다.
2. Vercel Cron(`vercel.json`, 매일 15:00 UTC = 태평양 07:00/08:00)이 `/api/cron/daily`를 부르는지 Vercel 로그에서 본다.
3. 운영 주소에서 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://claims.epcsj.org/api/cron/daily
```

401이 나와야 한다(비밀값 없이 호출).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://claims.epcsj.org/trial
```

404가 나와야 한다(시험 화면이 꺼져 있음).

4. 메일 확인: 관리자 계정으로 로그인 코드를 받아 본다(인증 메일). 관리자 화면에서 시험용 교인을 메일과 함께 등록하고 시험 청구를 올려 알림 메일이 오는지 본다(앱 메일). 둘 다 스팸함이 아니라 받은편지함에 와야 한다.
5. 관리자 계정으로 시험 청구 한 건을 끝까지 진행한다. 사람 등록 → 초대 링크 → 본인 휴대폰 연결 → 대면 확인 → 결재 → 서류 확인 → 수표 기록 → 수표 무효 처리로 정리.
6. 백업을 한 번 받고 복원을 해 본다(`doc/operations.md` 7장).
7. `doc/device-checklist.md`를 실기기로 진행한다.
8. `doc/operations.md`의 **시범 시작 전 점검표**를 끝낸다.

## 4. 되돌리기

- 앱: Vercel에서 이전 배포로 "Promote to Production".
- DB: 마이그레이션은 되돌리지 않는다. 고치는 마이그레이션을 새로 추가해 같은 경로(1장)로 적용한다.
- 데이터 손상: Supabase 백업(Pro: 일일, PITR 선택)으로 DB를 복원한다. **Supabase 백업에는 영수증 파일(Storage)이 없다.** 영수증은 주간 백업(`npm run backup`)에서 되살린다. DB만 복원하면 첨부 행은 있는데 파일이 없는 청구가 생길 수 있다.
