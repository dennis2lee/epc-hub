# 카카오 로그인 시험판

목적: 실제 휴대폰의 카카오톡 안 브라우저에서 로그인, 원래 화면 복귀, 영수증 첨부, 파일 받기가 되는지 개발 전에 확인한다(설계서 2장 "가장 먼저 할 일"). 결과에 따라 로그인 방식을 확정한다.

## 1. 준비 (사람이 해야 하는 일)

시험판을 실기기로 돌리려면 휴대폰에서 열 수 있는 HTTPS 주소가 필요하다. 계정 만들기와 결제는 개발 담당이 직접 한다.

1. **Supabase 클라우드 프로젝트**: 미국 리전, 교회 공용 계정 소유. 마이그레이션 적용은 `npx supabase link --workdir src` 후 `npx supabase db push --workdir src`.
2. **Vercel 프로젝트**: 이 저장소 연결, 환경 변수는 `.env.example` 참고. 미리보기 배포는 운영 DB가 아닌 시험용 Supabase를 가리키게 한다.
3. **카카오 개발자 앱** (https://developers.kakao.com):
   - 앱 만들기 → 앱 키의 REST API 키를 `KAKAO_REST_API_KEY`에 넣는다.
   - 카카오 로그인 활성화, OpenID Connect 활성화(방식 2에 필요).
   - Redirect URI 등록:
     - 방식 2: `https://<배포 주소>/auth/kakao/callback`
     - 방식 1: `https://<Supabase 프로젝트>.supabase.co/auth/v1/callback`
   - 동의항목: 닉네임(필수)만 켠다. 이메일은 비즈 앱 전용이라 쓰지 않는다.
   - 보안 → Client Secret을 켰다면 `KAKAO_CLIENT_SECRET`에 넣는다.
   - 플랫폼 → Web 사이트 도메인에 배포 주소를 넣는다.
4. **Supabase 대시보드** (방식 1·2 모두 필요): Authentication → Providers → Kakao 켜기, Client ID에 REST API 키, Client Secret 입력, "Allow users without an email" 켜기. 방식 2(운영 버튼)도 이 공급자 설정으로 id_token을 확인한다. 로그인 화면에 방식 1 버튼을 보이려면 환경변수 `NEXT_PUBLIC_KAKAO_OPTION1=1`을 넣는다(평소에는 숨김).
5. **이메일 발송**: Authentication → SMTP에 메일 서비스(예: Resend)를 넣고, Email Templates의 Magic Link와 Confirm signup을 `src/supabase/templates/otp.html` 내용(`{{ .Token }}` 6자리 코드)으로 바꾼다.

6. **시험 화면과 시험 버킷** (미리보기 프로젝트에만): Vercel 미리보기 환경변수에 `TRIAL_PAGES=1`을 넣는다(없으면 `/trial`이 404). 미리보기 Supabase의 SQL 편집기에서 `src/supabase/seeds/trial_bucket.sql`을 실행한다. 운영 프로젝트에는 둘 다 넣지 않는다(D37). 시험이 끝나면 환경변수를 지우고 버킷과 정책을 삭제한다.
7. **미리보기 주소**: 배포마다 바뀌는 주소 말고 고정 주소(`preview.<도메인>`)를 쓴다. 카카오 Redirect URI와 Supabase Redirect URLs에 이 주소를 넣고, Vercel Deployment Protection을 시험 기간에만 끈다(`doc/deploy.md` 2장).

## 2. 시험 방법

1. 시험할 사람에게 `https://<배포 주소>/trial` 링크를 카카오톡으로 보낸다.
2. 받은 사람이 카톡 안에서 링크를 열고 화면 위에서부터 차례로 누른다.
3. 마지막 "결과 복사하기"를 눌러 결과를 개발 담당에게 카톡으로 보낸다.

## 3. 시험 항목과 판단 기준

| # | 항목 | 성공 기준 | 실패하면 |
|---|---|---|---|
| 1 | 카카오 로그인 방식 2 (자체 OIDC + `signInWithIdToken`) | "로그인됨", 방식 `kakao` | 오류 문구를 기록. 방식 1 시도 |
| 2 | 카카오 로그인 방식 1 (Supabase 공급자) | 같음 | KOE205면 기본 scope에 이메일이 들어간 것. 방식 2로 확정 |
| 3 | 원래 화면 복귀 | 로그인 후 `/trial`로 돌아옴 | `kakao_state_mismatch`면 외부 브라우저 전환으로 쿠키가 끊긴 것 |
| 4 | 이메일 6자리 코드 로그인 | 로그인됨 | 메일 미수신이면 SMTP 확인 |
| 5 | 영수증 올리기 (카메라·사진첩·PDF·아이폰 HEIC) | 목록에 sha256과 함께 표시 | MIME과 크기를 기록 |
| 6 | CSV 받기 | 파일이 저장됨 | 안드로이드 카톡에서 자주 실패. 외부 브라우저 안내로 대체 |
| 7 | 인쇄 | 인쇄 대화상자 열림 | 재정부는 PC에서 인쇄 |
| 8 | 공유 | 공유 시트 열림 | 링크 복사로 대체 |
| 9 | 로그인 유지 | 카톡을 닫았다 다시 열어도 로그인됨 | 세션 설정 확인 |

시험 기기: 안드로이드 1대 이상, 아이폰 1대 이상, 미국 번호(+1)로 가입한 카카오 계정.

## 4. 결과 기록

시험 결과는 `doc/reviews/`에 날짜별로 남기고, 로그인 방식 결정은 `doc/decisions.md`에 적는다.
