# epc-hub · 교회 인트라넷 지출청구 전자결재

미국 한인교회의 종이 지출청구서를 휴대폰 웹 결재로 바꾸는 프로젝트다. 작성자가 청구서를 올리면 부장과 담당 장로가 승인하고, 재정부가 서류를 확인해 수표를 발행한다.

- **문서 사이트: https://dennis2lee.github.io/epc-hub/** (설계서·구조 보고서를 바로 연다)
- 설계서: [`doc/design.html`](doc/design.html) (브라우저로 연다)
- 구조 보고서: [`doc/overview.html`](doc/overview.html) (전체 구조를 네 단계 깊이로, 사용자 관점 포함)
- 결정 기록: [`doc/decisions.md`](doc/decisions.md)
- 개발 환경 준비: [`doc/setup.md`](doc/setup.md)
- 마일스톤과 진행 상황: [`doc/milestones.md`](doc/milestones.md)
- 운영 절차서: [`doc/operations.md`](doc/operations.md) · 배포 절차: [`doc/deploy.md`](doc/deploy.md) · 실기기 점검표: [`doc/device-checklist.md`](doc/device-checklist.md)

## 디렉터리

| 경로 | 내용 |
|---|---|
| `src/app` | Next.js 화면과 라우트 |
| `src/lib` | 서버·클라이언트 공용 코드 (Supabase 클라이언트, 금액, 시간대, 문구) |
| `src/supabase` | DB 마이그레이션, pgTAP 테스트, 시드 데이터 (Supabase CLI는 `--workdir src`로 실행) |
| `src/ops` | 운영 맥미니용 설치·배포·백업·복원 스크립트, launchd, Cloudflare Tunnel 설정 (`doc/deploy.md`) |
| `src/scripts` | 로컬 환경 파일 생성, 백업·영수증 복원 스크립트 |
| `doc` | 한국어 문서: 구조 보고서, 설계서, 결정 기록, 운영·배포 절차 |
| `build` | 빌드·테스트 산출물. 커밋하지 않는다 |

## 빠른 시작

```bash
npm install
cp .env.example .env.local   # 값 채우기는 doc/setup.md 참고
npm run db:start             # 로컬 Supabase (Docker 필요)
npm run dev
```

## 규칙

- 문서는 한국어, 코드 주석은 영어로 쓴다.
- 결재 상태 변경은 DB 함수로만 한다.
- 주요 결정과 마일스톤 검토는 `doc/decisions.md`, `doc/reviews/`에 남긴다.
