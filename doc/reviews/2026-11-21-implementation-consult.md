# 구현 착수 자문 (Fable, 2026-11-21)

구현 착수 전 핵심 결정 7가지를 Fable 모델에 자문했다. 채택한 결정은 `doc/decisions.md`의 D1~D12에 있다. 여기에는 자문 요지와 채택 여부만 남긴다.

| 주제 | 자문 요지 | 채택 |
|---|---|---|
| 디렉터리 | 초안대로 가되 Supabase CLI는 npm 스크립트로만, `tsconfig`의 타입 경로를 `build/next`로, 서버 전용 코드는 `src/lib/server/`에 `server-only`로 | 채택 |
| cacheComponents | 켠 채로 간다. `cookies()`는 `<Suspense>` 안에서만, DB 데이터에 공용 `"use cache"` 금지 | 채택 |
| DB 검증 | Docker 위의 `supabase start` + pgTAP. PGlite·embedded-postgres는 역할·RLS·동시성을 흉내 낼 뿐이라 증거가 안 된다. 동시 승인은 연결 두 개로 따로 시험 | 채택 (동시 승인 시험은 M1 보강에서 추가) |
| 알림 | DB 함수가 `notifications` 행을 쓰고 서버가 service role로 보낸다. 중복 발송은 상태 선점으로 막고, 주소 없는 수신자는 `no_address`로 | 채택 |
| 카카오 시험판 | 방식 1은 기본 scope 문제로 실패할 가능성이 있어 방식 2(자체 OIDC + `signInWithIdToken`)를 같이 넣는다. 둘 다 실패하면 서버에서 직접 검증하는 3안이 필요 | 채택 |
| 마일스톤 | M0 기반·시험판 → M1 DB 핵심 → M2 작성·결재 → M3 재정·알림·문서 → M4 시범 준비. 레드팀은 M1에 가장 무게 | 채택 (`doc/milestones.md`) |
| 지금 정할 것 | 사람과 로그인 1:N, 날짜 판정은 DB 한 곳, 마이그레이션은 버전 파일(선언형 diff 대신), URL에 언어를 넣지 않는 i18n | 채택 |

## 자문 중 확인이 필요하다고 표시된 것

- Supabase 카카오 공급자의 기본 scope와 이메일 없는 id_token 처리 → 실기기 시험(`doc/kakao-trial.md`)으로 확인한다.
- Vercel이 `distDir: "build/next"`를 그대로 받는지 → 첫 배포에서 확인한다. 막히면 Vercel에서만 `.next`를 쓴다.
- Supabase 기본 SMTP 발송 한도 → 처음부터 외부 메일 서비스를 연결한다.
