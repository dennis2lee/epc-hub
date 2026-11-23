# 개발 환경 준비

## 필요한 것

| 도구 | 확인 방법 | 메모 |
|---|---|---|
| Node.js 24 이상 | `node -v` | 개발 시점에는 26 사용 |
| Docker (Colima) | `docker info` | 로컬 Supabase용. `colima start --cpu 2 --memory 4` |
| GitHub CLI | `gh auth status` | 저장소 `dennis2lee/epc-hub` (public) |

Supabase CLI는 devDependency로 설치되어 있어 따로 깔 필요가 없다. 반드시 npm 스크립트로 부른다. 직접 부르면 `--workdir src`를 빼먹어 루트에 `supabase/` 폴더가 새로 생긴다.

## 처음 한 번

```bash
npm install
colima start --cpu 2 --memory 4
npm run db:start      # 이미지 내려받기 때문에 처음에는 몇 분 걸린다
npm run db:status     # API URL과 키 확인
cp .env.example .env.local
```

`.env.local`에 `npm run db:status`가 보여 준 값을 넣는다.

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API URL (보통 `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `SUPABASE_SECRET_KEY` | Secret key (서버 전용, 알림 발송에만 쓴다) |

## 매일

```bash
npm run db:start
npm run dev           # http://localhost:3000
```

- 로그인 코드 메일은 로컬 메일함 http://127.0.0.1:54324 에서 본다.
- 시드 계정(가상 인물): `writer@church.test`(작성자), `head@church.test`(유년부 부장), `elder@church.test`(교육위원회 담당 장로), `finance@church.test`(재정부원), `felder@church.test`(재정 담당 장로), `auditor@church.test`(감사), `admin@church.test`(관리자).

## 검사

```bash
npm run check         # lint + 타입 검사 + 단위 테스트
npm run db:reset      # 마이그레이션과 시드를 처음부터 다시 적용
npm run db:test       # pgTAP (결재 규칙과 권한)
npm run test:int      # 로컬 Supabase에 붙는 통합 테스트
npm run test:e2e      # Playwright (휴대폰 크기, dev 서버를 띄워 둔 채로)
npm run build         # 결과물은 build/next (커밋하지 않음)
```

## 문제 해결

- **CSS를 고쳤는데 화면에 반영되지 않는다**: Turbopack 개발 캐시가 오래된 결과를 내줄 때가 있다. dev 서버를 끄고 `build/next/dev` 폴더를 지우거나 다른 이름으로 옮긴 뒤 다시 켠다.
- **`.env.local`을 셸에서 읽을 때 오류가 난다**: 공백·괄호·`<`가 있는 값(`MAIL_FROM`, `NEXT_PUBLIC_OFFICE_PHONE`)은 큰따옴표로 감싼다.
- **카카오 1안 버튼**: 실기기 시험 때만 `NEXT_PUBLIC_KAKAO_OPTION1=1`로 켠다. 평소 로그인 화면에는 2안만 보인다.

마이그레이션이나 DB 함수를 바꾸면 `npm run db:reset && npm run db:test && npm run db:types` 순서로 돌리고, 바뀐 `src/lib/database.types.ts`를 함께 커밋한다.

## 카카오 로그인 키 넣기

카카오 개발자 앱을 만든 뒤(`doc/kakao-trial.md`) 다음을 채운다.

- 방식 2(기본): `.env.local`의 `KAKAO_REST_API_KEY`, 필요하면 `KAKAO_CLIENT_SECRET`
- 방식 1(시험): `SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET`를 셸 환경에 두고 `npm run db:stop && npm run db:start`

`supabase start`는 `.env.local`을 읽지 않으므로 방식 1 변수는 셸에서 넘긴다.

```bash
set -a; source .env.local; set +a; npm run db:start
```
