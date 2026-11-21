@AGENTS.md

# 프로젝트 작업 규칙

- 모든 문서(`doc/`, `README.md`, 커밋 메시지 본문 제외 문서류)는 한국어로 쓴다.
- 코드 주석은 영어로 쓴다.
- 루트에서 `src/`(코드), `doc/`(문서), `build/`(빌드·테스트 산출물)를 운영한다. `build/`는 커밋하지 않는다.
- 주요 결정은 Fable 모델 자문을 거쳐 정하고, 결과를 `doc/decisions.md`에 남긴다.
- 구현 마일스톤마다 Fable 모델로 레드팀 검토를 하고, 결과와 조치를 `doc/reviews/`에 남긴다.
- 설계의 기준 문서는 `doc/design.html`이다. 설계를 바꾸면 이 문서와 `doc/decisions.md`를 함께 고친다.
- 결재 상태 변경은 반드시 `src/supabase/migrations`의 Postgres 함수로만 한다. 화면이나 서버 코드에서 상태 컬럼을 직접 쓰지 않는다.
