# 클라우드 배포 절차 (리허설용)

Supabase·Vercel·카카오·Resend 계정은 교회 공용 계정으로 만든다(개인 계정 금지, `doc/operations.md` 8장). 아래 절차는 계정 소유자가 직접 한다. 개발 담당은 비밀값을 문서·채팅에 옮기지 않는다.

## 0. 준비물

| 항목 | 메모 |
|---|---|
| Supabase 프로젝트 2개 | `intra-net-prod`(운영, Pro 권장), `intra-net-preview`(미리보기, 무료). 리전은 미국 서부 |
| Vercel 프로젝트 1개 | GitHub `dennis2lee/intra-net` 연결 |
| 도메인 | 예: `claims.<교회도메인>` |
| Resend | 보내는 도메인 인증(SPF·DKIM) |
| 카카오 개발자 앱 | `doc/kakao-trial.md` 1~4단계 |

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

- `seed.sql`은 운영에 넣지 않는다(가상 인물). 첫 관리자는 SQL 편집기에서 `people`, `admin_grants`를 직접 넣고, 첫 로그인 뒤 `person_logins`를 연결한다. 이 작업은 감사 기록에 "초기 설정"으로 남긴다.
- `20261121000050_trial_bucket.sql`의 `trial` 버킷은 카카오 실기기 시험이 끝나면 지우는 마이그레이션을 추가한다.
- Auth 설정: Site URL = 운영 도메인, Redirect URLs = `https://<도메인>/auth/callback**`. 이메일 템플릿(매직 링크·가입 확인)은 `src/supabase/templates/otp.html` 내용으로 바꾼다(6자리 코드).
- 카카오 공급자(방식 1 시험 시): 대시보드에서 켜고 "Allow users without an email"을 켠다.

## 2. Vercel 환경변수

| 변수 | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | 운영 프로젝트 값 | **미리보기 프로젝트 값** |
| `NEXT_PUBLIC_SITE_URL` | `https://<도메인>` | 미리보기 배포 주소 |
| `NEXT_PUBLIC_CHURCH_TIME_ZONE` | `America/Los_Angeles` (교회 확인) | 같음 |
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 앱 값 | 같음 |
| `CRON_SECRET` | 32자 이상 임의 문자열 | 다른 값 |
| `RESEND_API_KEY`, `MAIL_FROM` | 운영 값 | 테스트 키 (운영 빌드에서는 비우면 오류가 난다. 메일 내용이 로그에 남지 않게 하려는 장치) |
| `NEXT_PUBLIC_OFFICE_PHONE` | 사무실 번호 | 같음 |
| `NEXT_PUBLIC_KAKAO_OPTION1` | 비움 | 실기기 시험 때만 `1` |

미리보기 배포가 운영 DB를 가리키지 않는지 반드시 확인한다(설계서 12장 "운영 DB 보호").

## 3. 배포와 확인

1. `main`에 병합하면 Vercel이 배포한다. GitHub Actions CI(`check`, `database`)가 먼저 통과해야 한다.
2. Vercel Cron(`vercel.json`, 매일 15:00 UTC = 태평양 07:00/08:00)이 `/api/cron/daily`를 부르는지 Vercel 로그에서 본다.
3. 운영 주소에서 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<도메인>/api/cron/daily
```

401이 나와야 한다(비밀값 없이 호출).

4. 관리자 계정으로 로그인 → 관리자 화면 → 사람 등록·초대 링크 → 본인 휴대폰으로 연결 → 대면 확인 → 시험 청구 한 건을 끝까지 → 수표 무효 처리로 정리.
5. `doc/device-checklist.md`를 실기기로 진행한다.

## 4. 되돌리기

- 앱: Vercel에서 이전 배포로 "Promote to Production".
- DB: 마이그레이션은 되돌리지 않는다. 고치는 마이그레이션을 새로 추가해 같은 경로(1장)로 적용한다. 데이터 손상은 Supabase 백업(Pro: 일일, PITR 선택)으로 복원한다.
