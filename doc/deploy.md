# 맥미니 운영 배포 절차

운영 서버는 전용 맥미니 한 대다(D41~D46). 화면(Next.js)과 Supabase(공식 self-hosted Docker 구성)가 같은 기기에서 돈다. 교인은 Cloudflare Tunnel을 거쳐서만 접속한다. 아래 절차는 기술 담당이 맥미니 앞에서 직접 한다. 비밀값은 문서·채팅·메일에 옮기지 않는다.

이 절차는 2026-11-22 개발용 MacBook Air에서 리허설했다. 순서는 설치 → 마이그레이션 → DB 테스트 143건 → 화면 테스트 6건 → 백업 → 전부 삭제 → 복원 → 화면 테스트 6건이다. 결과는 `doc/reviews/2026-11-22-mac-mini-rehearsal.md`에 있다.

## 0. 구성

```
교인 휴대폰 ─ https ─> Cloudflare (epcsj-hub.org)
                          │ Tunnel (맥미니가 바깥으로 연결, 공유기 포트 개방 없음)
                          ▼
맥미니  cloudflared ─┬─> 127.0.0.1:3000  Next.js (www.epcsj-hub.org)
                     └─> 127.0.0.1:8000  Supabase 게이트웨이 (api.epcsj-hub.org, /auth·/rest·/storage만)
                                           └─ db · auth · rest · storage · imgproxy · meta · studio (Docker, Colima)
메일: Resend (notify.epcsj-hub.org)    백업: 매일 밤 age 암호화 → Google Drive (rclone)
```

| 주소 | 용도 |
|---|---|
| `www.epcsj-hub.org` | 앱 화면. `epcsj-hub.org`는 www로 보낸다 |
| `api.epcsj-hub.org` | Supabase API. 인증·데이터·파일 경로만 열린다(D43) |
| `notify.epcsj-hub.org` | 알림·로그인 코드 메일을 보내는 도메인(Resend) |

맥미니 안 폴더는 `~/church`다(아래에서 `CHURCH_HOME`).

| 경로 | 내용 | 권한 |
|---|---|---|
| `repo/` | GitHub 저장소 사본(배포 원본) | |
| `releases/<커밋>/`, `current` | 빌드된 배포본과, 지금 쓰는 배포본을 가리키는 링크 | |
| `supabase/` | Supabase 설치본과 `.env`(DB 비밀번호·JWT 키 등) | `.env` 600 |
| `app.env` | 앱 환경변수 | 600 |
| `deploy.env` | DB 관리자 접속 주소(마이그레이션용) | 600 |
| `backup.env` | 백업용 접속 정보·age 공개 키·Drive 위치 | 600 |
| `backups/` | 최근 3일치 암호화 백업 | |
| `logs/` | 앱·Cron·백업 기록 | |

## 1. 준비물과 계정

| 항목 | 메모 |
|---|---|
| 맥미니 | **이 용도 전용.** macOS 최신, 유선 인터넷, 기존 UPS를 USB로 연결. 개인 Apple ID로 로그인하지 않는다 |
| Cloudflare | `tech-media@kepc.org`로 가입. `epcsj-hub.org`를 Cloudflare Registrar에서 등록한다(DNS가 자동 연결됨) |
| Resend | 같은 주소로 가입. 도메인 `notify.epcsj-hub.org`를 추가한다(DNS는 Cloudflare에 자동 또는 손으로) |
| 카카오 개발자 | 교회 공용 카카오 계정. `doc/kakao-trial.md` 1~5단계 |
| Google Drive | `tech-media@kepc.org`의 Drive에 `intra-net-backup` 폴더(가능하면 공유 드라이브) |
| age 키 한 쌍 | 맥미니가 **아닌** 컴퓨터에서 만든다. 개인 키는 USB 두 개(기술 담당용, 당회 서기 봉투용)에 둔다. 맥미니에는 공개 키만 둔다 |
| (권장) healthchecks.io | 무료. 매일 점검이나 백업이 멈추면 `tech-media@kepc.org`로 알림 메일이 온다. 맥미니가 꺼져도 알 수 있다 |

## 2. 맥미니 기본 설정 (한 번)

1. 전용 macOS 사용자 `church`(관리자)를 만들고, 운영은 이 사용자로만 한다.
2. 전원과 잠자기를 설정한다.

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1
```

   - `autorestart 1`: 정전 뒤 전기가 들어오면 자동으로 켜진다.
   - 시스템 설정 → 배터리(UPS를 연결하면 "UPS" 항목이 생긴다): UPS 잔량이 20%가 되면 종료하도록 한다.
3. **FileVault는 켠다**(도난 때 기록 보호). 대신 재시작 뒤에는 누군가 잠금을 풀어야 서비스가 다시 돈다.
   - 계획된 재시작(업데이트)은 `sudo fdesetup authrestart`로 한다. 잠금 해제 없이 한 번 다시 켜진다.
   - 정전 뒤 재시작: 같은 네트워크의 다른 기기에서 SSH로 잠금을 풀거나(macOS 원격 잠금 해제), 맥미니 앞에서 로그인한다.
   - 무인 복구를 위해 FileVault를 끄는 것은 **당회 결정 사항**이다(`doc/reviews/2026-11-22-mac-hosting-consult.md`).
4. 시스템 설정 → 일반 → 공유: 원격 로그인(SSH)을 관리자에게만 켠다. 화면 공유는 필요할 때만 켠다.
5. 방화벽을 켠다. 자동 업데이트는 "보안 응답과 시스템 파일"만 자동으로 두고, macOS 업데이트는 매월 한 번 손으로 한다(9장).
6. 원격 관리용으로 Tailscale을 설치하고 기술 담당 기기만 초대한다. 공유기 포트는 열지 않는다.

## 3. 도구 설치 (한 번)

```bash
brew install git node@24 colima docker docker-compose jq age rclone cloudflared gh
```

```bash
colima start --cpu 4 --memory 8 --disk 60
```

```bash
brew services start colima
```

- Colima는 로그인할 때 자동으로 켜지고, 컨테이너는 `restart: unless-stopped` 설정이라 함께 다시 켜진다.
- Colima는 홈 폴더 아래만 컨테이너에 연결한다. 운영 파일은 모두 `~/church` 아래에 둔다(리허설에서 임시 폴더를 쓰다 실패한 적이 있다).

```bash
mkdir -p ~/church/logs ~/church/releases && git clone https://github.com/dennis2lee/intra-net.git ~/church/repo
```

`gh auth login`으로 저장소를 읽을 수 있게 한다. 배포 전에 CI 결과를 확인하는 데 쓴다.

## 4. Supabase 설치 (한 번)

```bash
sh ~/church/repo/src/ops/supabase/install.sh
```

- 공식 구성을 고정 버전(`self-hosted/v0.8.4`)으로 받아 `~/church/supabase`에 설치한다.
- 고유한 JWT 키, API 키, DB 비밀번호를 만들어 `.env`(권한 600)에 넣는다. 화면에 비밀값을 출력하지 않는다.
- 개발용 `supabase start`는 절대 쓰지 않는다. 키가 공개된 기본값이다(D43).

`~/church/supabase/.env`를 편집기로 열어 아래 세 값을 넣는다.

| 변수 | 값 |
|---|---|
| `SMTP_PASS` | Resend API 키(로그인 코드 메일 발송) |
| `KAKAO_REST_API_KEY` | 카카오 앱 REST API 키 |
| `KAKAO_CLIENT_SECRET` | 카카오 Client Secret(켰다면) |

```bash
sh ~/church/repo/src/ops/supabase/start.sh
```

모든 서비스가 healthy인지, 포트가 `127.0.0.1:8000`과 `127.0.0.1:54329`로만 열려 있는지 확인한다.

로그인 관련 설정은 `src/ops/supabase/docker-compose.church.yml`에 들어 있다. 코드 재요청 간격 1분, 코드 10분·6자리, 발송 한도, 카카오 공급자 설정이다.

## 5. 앱 설정 파일 (한 번)

`~/church/app.env` (권한 600):

| 변수 | 값 |
|---|---|
| `APP_ENV` | `production` (이 기기에서만, D46) |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.epcsj-hub.org` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `supabase/.env`의 `SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | `supabase/.env`의 `SUPABASE_SECRET_KEY` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.epcsj-hub.org` |
| `NEXT_PUBLIC_CHURCH_TIME_ZONE` | `America/Los_Angeles` (교회 확인) |
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 앱 값 |
| `CRON_SECRET` | 32자 이상 임의 문자열(`openssl rand -hex 24`) |
| `RESEND_API_KEY` | Resend API 키(앱 알림) |
| `MAIL_FROM` | `교회 지출청구 <no-reply@notify.epcsj-hub.org>` |
| `NEXT_PUBLIC_OFFICE_PHONE` | 사무실 번호 |
| `NEXT_PUBLIC_KAKAO_OPTION1`, `TRIAL_PAGES` | 비워 둔다. 실기기 시험 때만 `1`로 하고, 끝나면 비우고 다시 배포한다 |
| `HEALTHCHECK_CRON_URL` | (권장) healthchecks.io 주소 |

`~/church/deploy.env` (권한 600) 한 줄: `DATABASE_ADMIN_URL=postgresql://postgres:<supabase/.env의 POSTGRES_PASSWORD>@127.0.0.1:54329/postgres`

`~/church/backup.env` (권한 600)은 7장을 참고한다.

```bash
chmod 600 ~/church/app.env ~/church/deploy.env ~/church/backup.env
```

## 6. 첫 배포와 자동 실행 (한 번)

1. 배포한다. 빌드 → 마이그레이션(`supabase db push`, 확인 질문에 y) → `current` 링크 변경 → 앱 재시작 순서로 진행된다.

```bash
sh ~/church/repo/src/ops/bin/deploy.sh
```

2. 자동 실행을 등록한다. 앱 상시 실행, 매일 07:00 점검, 매일 02:30 백업이다.

```bash
for n in app cron backup; do sed "s#__HOME__#$HOME#g" ~/church/repo/src/ops/launchd/org.epcsj-hub.$n.plist > ~/Library/LaunchAgents/org.epcsj-hub.$n.plist; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.epcsj-hub.$n.plist; done
```

3. Cloudflare Tunnel을 만든다.

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create epcsj-hub
```

```bash
cloudflared tunnel route dns epcsj-hub www.epcsj-hub.org && cloudflared tunnel route dns epcsj-hub api.epcsj-hub.org
```

   `src/ops/cloudflared/config.yml.example`을 `~/.cloudflared/config.yml`로 복사하고, 터널 ID와 사용자 이름을 넣은 뒤 서비스로 등록한다.

```bash
sudo cloudflared service install
```

4. Cloudflare 대시보드에서 설정한다.
   - Rules → Redirect: `epcsj-hub.org/*` → `https://www.epcsj-hub.org/$1`(301).
   - SSL/TLS: Full. "Always Use HTTPS" 켬.
5. 카카오 개발자 콘솔에 넣는다.
   - Redirect URI: `https://www.epcsj-hub.org/auth/kakao/callback`, `https://api.epcsj-hub.org/auth/v1/callback`
   - 사이트 도메인: `https://www.epcsj-hub.org`
6. 교회 홈페이지(`www.epcsj.org`)에 "지출청구" 링크로 `https://www.epcsj-hub.org`를 건다. 교인이 진짜 주소임을 알 수 있게 하기 위해서다(D42).

### 6-1. 첫 관리자 (한 번)

1. 맥미니에서 브라우저로 `http://127.0.0.1:8000`을 연다(Studio, 외부에는 열리지 않음). 사용자 이름과 비밀번호는 `supabase/.env`의 `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`다.
2. Authentication → Users → Add user로 첫 관리자의 메일 주소를 만들고 UID를 복사한다.
3. SQL Editor에서 아래를 실행한다. 관리자가 이미 있으면 거부되고, 감사 기록에는 "초기 설정"으로 남는다.

```sql
select public.bootstrap_first_admin('<UID>', '<이름>', '+1XXXXXXXXXX', '<메일>', '<당회 결의 날짜 등 근거>');
```

4. 그 뒤로는 모든 일을 앱의 관리자 화면에서 한다. 두 번째 관리자와 감사위원 권한도 여기서 준다(D30).

## 7. 백업 (매일 자동, D44)

1. rclone에 Google Drive를 연결한다. `tech-media@kepc.org`로 로그인하고 이름은 `church-drive`로 한다.

```bash
rclone config
```

2. `~/church/backup.env` (권한 600):

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:8000` (맥 안에서 직접 접속) |
| `SUPABASE_SECRET_KEY` | `supabase/.env`의 `SUPABASE_SECRET_KEY` |
| `BACKUP_DB_URL` | `deploy.env`의 주소와 같음 |
| `BACKUP_AGE_RECIPIENT` | age **공개** 키(`age1…`) |
| `BACKUP_REMOTE` | `church-drive:intra-net-backup` |
| `HEALTHCHECK_BACKUP_URL` | (권장) healthchecks.io 주소 |

3. 한 번 손으로 돌려서 Drive에 `daily/backup-<날짜>.tar.age`가 생기는지 확인한다.

```bash
sh ~/church/current/src/ops/bin/backup-nightly.sh
```

**보관 규칙**
- 매일 02:30에 돈다.
- Drive `daily/`에는 31일치, `monthly/`에는 매월 1일 것을 7년 남긴다. 오래된 것 정리는 당회 승인 뒤 손으로 한다.

**복원 연습** (시범 전 1회, 이후 분기 1회)
1. 맥미니가 아닌 다른 맥에 빈 Supabase를 설치하고 시작한다.
2. 백업의 `release.txt`에 적힌 배포본을 준비한다.
3. 아래를 실행한다.

```bash
sh ~/church/current/src/ops/bin/restore.sh <backup-날짜.tar.age> <age 개인 키 파일>
```

4. 복원 뒤 청구서 몇 건을 열어 영수증이 보이는지 확인한다.

## 8. 확인 (첫 배포 뒤, 그리고 큰 변경 뒤)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.epcsj-hub.org/api/cron/daily
```

401이어야 한다(비밀값 없이 호출).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.epcsj-hub.org/trial
```

404여야 한다(시험 화면이 꺼져 있음).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.epcsj-hub.org/
```

404여야 한다(Studio와 관리 API가 밖에 열려 있지 않음).

1. 메일: 관리자 로그인 코드가 1분 안에 받은편지함으로 온다(스팸함이 아니어야 한다). 시험 청구를 올리면 알림 메일이 온다.
2. 시험 청구 한 건을 끝까지 진행한다. 사람 등록 → 초대 → 본인 휴대폰 연결 → 대면 확인 → 결재 → 서류 확인 → 수표 기록 → 무효 처리로 정리한다.
3. 맥미니를 `sudo fdesetup authrestart`로 재시작해서 앱, Supabase, Tunnel이 저절로 다시 뜨는지 본다.
4. UPS 전원 코드를 한 번 뽑아 본다. 맥미니가 UPS로 버티는지, 잔량 기준에서 안전하게 꺼지는지 확인한다.
5. `doc/device-checklist.md`를 실기기로 진행하고, `doc/operations.md`의 **시범 시작 전 점검표**를 끝낸다.

## 9. 업데이트와 되돌리기

- **앱:** `main`에 병합하고 CI가 통과하면 아래를 실행한다.

```bash
sh ~/church/repo/src/ops/bin/deploy.sh
```

  문제가 있으면 `deploy.sh --rollback`으로 이전 배포본으로 돌아간다. DB 마이그레이션은 되돌리지 않고, 고치는 마이그레이션을 새로 추가한다(D8).
- **macOS:** 매월 한 번, 주일과 월초 지급일을 피해 저녁에 한다. 업데이트 → `sudo fdesetup authrestart` → 8장 1번 확인.
- **Supabase:** 분기에 한 번, 또는 보안 공지가 있을 때 한다.
  1. 개발용 맥에서 먼저 리허설한다. `install.sh`의 고정 버전을 올려 설치하고 테스트한다.
  2. 맥미니에서 백업 → 공식 `update.sh` → `start.sh` → 8장 확인.
  3. 고정 버전을 올렸으면 `install.sh`의 `SUPABASE_REF`도 고쳐 커밋한다.
- **기록:** 무엇을 언제 바꿨는지 `doc/operations.md`의 변경 기록에 적는다.

## 10. 맥미니가 고장 났을 때

1. healthchecks.io 알림이나 교인의 연락으로 알게 된다. `doc/operations.md` 7장 "사이트가 안 열릴 때"를 따른다(장애 중 수표 금지, D35).
2. 전원이나 인터넷 문제면 고쳐서 켠다. FileVault 잠금을 풀면 서비스가 저절로 다시 뜬다.
3. 기기가 죽었으면 다른 맥에서 2~7장을 다시 하고, Google Drive의 최신 백업으로 복원한다(7장). Cloudflare Tunnel은 같은 이름으로 다시 만들고 DNS를 새 터널로 돌린다.
4. 복원한 날짜와, 마지막 백업 이후 잃어버린 기간을 기록해 당회에 보고한다. 그 사이에 올린 청구는 작성자가 다시 올린다.
