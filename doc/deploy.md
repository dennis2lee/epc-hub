# 맥미니 운영 배포 절차

운영 서버는 교회 IT실에 두는 **교회 소유** 전용 맥미니 한 대다(D41~D47, D49). 24시간 켜져 있다. 화면(Next.js)과 Supabase(공식 self-hosted Docker 구성)가 같은 기기에서 돈다. 교인은 Cloudflare Tunnel을 거쳐서만 접속한다. 아래 절차는 기술 담당이 맥미니 앞에서 직접 한다. 비밀값은 문서·채팅·메일에 옮기지 않는다.

이 절차는 2026-11-22 개발용 MacBook Air에서 두 번 리허설했다. 설치, 배포 스크립트, 운영 빌드 화면 테스트, 백업, 전부 삭제 뒤 복원, 되돌리기를 거쳤다. 결과는 `doc/reviews/2026-11-22-mac-mini-rehearsal.md`에 있다.

## 0. 구성

```
교인 휴대폰 ─ https ─> Cloudflare (epcsj-hub.org)
                          │ Tunnel (맥미니가 바깥으로 연결, 공유기 포트 개방 없음)
                          ▼
맥미니  cloudflared ─┬─> 127.0.0.1:3000  Next.js (www.epcsj-hub.org)
                     └─> 127.0.0.1:8000  Supabase 게이트웨이 (api.epcsj-hub.org: 로그인 코드·세션·카카오·서명된 영수증 주소만)
                                           └─ db · auth · rest · storage · imgproxy · meta · studio (Docker, Colima)
Next.js 서버 → Supabase: 맥 안에서 127.0.0.1:8000으로 직접 (외부를 거치지 않음)
메일: Resend (notify.epcsj-hub.org)    백업: 매일 03:30 age 암호화 → Google Drive (rclone)
```

| 주소 | 용도 |
|---|---|
| `www.epcsj-hub.org` | 앱 화면. `epcsj-hub.org`는 www로 보낸다 |
| `api.epcsj-hub.org` | 브라우저가 쓰는 Supabase 경로만 열린다(D43, D47). 데이터 API·관리 화면·가입은 닫힘 |
| `notify.epcsj-hub.org` | 알림·로그인 코드 메일을 보내는 도메인(Resend) |

맥미니 안 폴더는 `~/church`다(아래에서 `CHURCH_HOME`).

| 경로 | 내용 | 권한 |
|---|---|---|
| `repo/` | GitHub 저장소 사본(배포 원본) | |
| `releases/<커밋>-<시각>/` | 빌드된 배포본. 배포할 때마다 새 폴더 | |
| `current`, `previous` | 지금 쓰는 배포본, 바로 전의 정상 배포본 | |
| `supabase/` | Supabase 설치본과 `.env`(DB 비밀번호·JWT 키 등) | `.env` 600 |
| `app.env` | 앱 환경변수 | 600 |
| `deploy.env` | DB 관리자 접속 주소(마이그레이션용. 앱은 모름) | 600 |
| `backup.env` | 백업용 접속 정보·age 공개 키·Drive 위치 | 600 |
| `backups/` | 최근 3일치 암호화 백업, 영수증 개수 기록 | |
| `logs/` | 서비스 기록(매주 순환, 8주 보관) | |

## 1. 준비물과 계정

| 항목 | 메모 |
|---|---|
| 맥미니 | **교회 소유, 이 용도 전용**, 교회 IT실, 24시간 켜짐. 사양은 아래 1-1장. macOS 최신, 유선 인터넷, UPS를 USB로 연결. Apple ID로 로그인하지 않는다 |
| Cloudflare | `tech-media@kepc.org`로 가입. `epcsj-hub.org`를 Cloudflare Registrar에서 등록한다(DNS 자동 연결) |
| Resend | 같은 주소로 가입. 도메인 `notify.epcsj-hub.org` 추가. API 키를 **두 개** 만든다: 로그인 코드용(Supabase), 알림용(앱). 하나가 막혀도 다른 쪽은 돈다 |
| 카카오 개발자 | 교회 공용 카카오 계정. `doc/kakao-trial.md` 1~5단계 |
| Google Drive | `tech-media@kepc.org`의 Drive에 `epc-hub-backup` 폴더(가능하면 공유 드라이브) |
| age 키 한 쌍 | 맥미니가 **아닌** 컴퓨터에서 만든다. 개인 키는 USB 두 개(기술 담당용, 당회 서기 봉투용)에 둔다. 맥미니에는 공개 키만 둔다 |
| healthchecks.io (강력 권장) | 무료. 검사 3개를 만든다: 앱 상태, 매일 점검, 백업. 멈추면 `tech-media@kepc.org`로 알림. 맥미니 전체가 꺼져도 알 수 있는 유일한 장치다 |

## 1-1. 맥미니 사양과 설치 장소 (D49)

자문 기록: `doc/reviews/2026-11-23-mac-mini-spec-consult.md`. 가격은 대략값이며 구매 전에 다시 확인한다.

| 등급 | 칩 | 메모리 | 내장 SSD | 대략 가격 | 메모 |
|---|---|---|---|---|---|
| **권장** | 현행 기본 칩 | **24 GB** | **512 GB** | 약 $999 | 5~7년 사용. Colima 설정 그대로 |
| 예산 절충 | 현행 기본 칩 | 16 GB | 512 GB | 약 $799 | 메모리보다 디스크를 먼저 올린다. Colima `--memory 6` |
| 최소 | 현행 기본 칩 | 16 GB | 256 GB | 약 $599 | 동작은 한다. 디스크는 2~3년차에 모자란다 |
| 필요 없음 | Pro 칩 | - | - | $1,399 이상 | 100명 규모에서 CPU는 남는다 |

- 메모리와 SSD는 사고 나서 늘릴 수 없다.
- 백업하는 동안 디스크는 영수증 용량의 약 6~7배를 쓴다(평문 모음, tar, 암호화본, 로컬 보관 3개). 백업을 증분 방식으로 바꾸는 일이 남아 있다(D49).

| 설치 환경 | 할 일 |
|---|---|
| UPS | 라인 인터랙티브, 순수 정현파, 850~1000 VA, USB HID. 기존 UPS를 쓰면 배터리 연도를 보고, 3~5년이 넘었으면 교체한다. **맥미니와 함께 모뎀·공유기·스위치**를 물린다 |
| 네트워크 | 내장 유선(Cat6), Wi-Fi 끔. 공유기에서 DHCP 예약으로 주소를 고정한다. 손님 Wi-Fi·방송 장비와 다른 내부망에 둔다 |
| 방 | 잠긴 IT실. 사방 5 cm 이상 띄우고, 실온 10~35°C, 다른 장비 위에 쌓지 않는다. 주중 냉방이 꺼지면 여름 한 주 동안 온도를 기록한다 |
| 현장 장비 | 모니터와 유선 키보드를 IT실에 둔다(FileVault 잠금 해제용). HDMI 더미 플러그, 외장 SSD, Time Machine은 쓰지 않는다 |
| 표시 | 본체·전원 코드·UPS에 "교회 지출청구 서버. 끄거나 뽑지 마시오. 연락처"를 붙인다. UPS는 벽 콘센트에 바로 꽂고 시설 담당에게 알린다 |
| 자산 | 교회 비품 대장에 모델, 일련번호, 구입일, 구입가, 위치, 담당자를 적는다. 교체는 5~6년, 또는 macOS 보안 업데이트가 끝날 때 |

## 2. 맥미니 기본 설정 (한 번)

1. 전용 macOS 사용자 `church`(관리자)를 만들고, 운영은 이 사용자로만 한다.
2. 시간대와 전원을 설정한다(매일 점검 07:00, 백업 03:30이 교회 시간 기준이 되도록).

```bash
sudo systemsetup -settimezone America/Los_Angeles
```

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestart 1 womp 1
```

   - `autorestart 1`: 정전 뒤 전기가 들어오면 자동으로 켜진다.
   - UPS 잔량 때문에 맥이 스스로 꺼졌는데 UPS가 꺼지기 전에 전기가 돌아오면 `autorestart`가 동작하지 않을 수 있다. 매일 06:00 전원 켜기 예약을 함께 건다.

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 06:00:00
```

   - 시스템 설정 → 배터리(UPS를 연결하면 "UPS" 항목이 생긴다): UPS 잔량이 20%가 되면 종료하도록 한다.
3. **FileVault는 켠다**(도난 때 기록 보호). 대신 예정에 없던 재시작 뒤에는 누군가 잠금을 풀어야 한다.
   - 서비스는 시스템 서비스(LaunchDaemon)로 등록하므로, 잠금만 풀리면 아무도 로그인하지 않아도 모두 다시 뜬다.
   - 계획된 재시작(업데이트)은 `sudo fdesetup authrestart`로 한다. 잠금 해제 없이 한 번 다시 켜진다.
   - 정전 뒤 재시작: 같은 네트워크의 다른 기기에서 SSH로 잠금을 풀거나(macOS 원격 잠금 해제), 맥미니 앞에서 잠금을 푼다.
   - 무인 복구를 위해 FileVault를 끄는 것은 **당회 결정 사항**이다(`doc/reviews/2026-11-22-mac-hosting-consult.md`).
4. 시스템 설정 → 일반 → 공유: 원격 로그인(SSH)을 관리자에게만 켠다. 화면 공유는 필요할 때만 켠다.
5. 방화벽을 켠다. 자동 업데이트는 "보안 응답과 시스템 파일"만 자동으로 두고, macOS 업데이트는 매월 한 번 손으로 한다(9장).
6. 원격 관리용으로 Tailscale을 설치하고 기술 담당 기기만 초대한다. Tailscale 계정은 `tech-media@kepc.org` 소유로 만든다. SSH는 사람마다 다른 키로 접속한다. 공유기 포트는 열지 않는다.

## 3. 도구 설치 (한 번)

```bash
brew install git node@24 colima docker docker-compose jq age rclone cloudflared gh
```

Colima 가상 머신을 한 번 만들고 멈춘다. 이후에는 시스템 서비스가 켠다(6장).

```bash
colima start --cpu 4 --memory 8 --disk 60 && colima stop
```

- 메모리 16 GB 기기는 `--memory 6`으로 만든다(빌드·백업이 겹칠 때 스왑 방지, D49).
- DB와 영수증은 `~/church/supabase/volumes/`(맥 디스크)에 쌓이는지 설치 뒤 확인한다. VM 디스크 60 GB에는 이미지만 들어가야 한다. Colima 디스크는 늘릴 수만 있다.

- `node@24`는 Homebrew에서 별도 경로(`/opt/homebrew/opt/node@24/bin`)에 설치된다. 운영 스크립트가 그 경로를 먼저 쓴다.
- Colima는 홈 폴더 아래만 컨테이너에 연결한다. 운영 파일은 모두 `~/church` 아래에 둔다(리허설에서 임시 폴더를 쓰다 실패한 적이 있다).

```bash
mkdir -p ~/church/logs ~/church/releases && git clone https://github.com/dennis2lee/epc-hub.git ~/church/repo
```

`gh auth login`으로 저장소를 읽을 수 있게 한다. 배포 스크립트가 CI 결과를 확인하는 데 쓰며, `gh`가 없으면 배포를 거부한다.

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
| `SMTP_PASS` | Resend **로그인 코드용** API 키 |
| `KAKAO_REST_API_KEY` | 카카오 앱 REST API 키 |
| `KAKAO_CLIENT_SECRET` | 카카오 Client Secret(켰다면) |

Colima를 잠시 켜고 Supabase를 시작한다. 6장에서 시스템 서비스로 넘긴다.

```bash
colima start && sh ~/church/repo/src/ops/supabase/start.sh
```

모든 서비스가 healthy인지, 포트가 `127.0.0.1:8000`과 `127.0.0.1:54329`로만 열려 있는지 확인한다.

교회용 인증 설정은 `src/ops/supabase/docker-compose.church.yml`에 들어 있다.
- 로그인 코드: 10분, 6자리, 같은 주소 재요청 간격 1분
- 발송 한도
- 접속자 IP별 제한: 코드 확인 5분에 30번
- 카카오 공급자
- 영수증 크기 5MB

## 5. 앱 설정 파일 (한 번)

값에 따옴표를 붙이지 않는다. 공백이나 `<`, `&`가 있어도 그대로 쓴다. 스크립트는 파일을 한 줄씩 글자 그대로 읽는다.

`~/church/app.env` (권한 600):

| 변수 | 값 |
|---|---|
| `APP_ENV` | `production` (이 기기에서만, D46) |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.epcsj-hub.org` (브라우저용) |
| `SUPABASE_INTERNAL_URL` | `http://127.0.0.1:8000` (서버용, 맥 안에서 직접, D47) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `supabase/.env`의 `SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | `supabase/.env`의 `SUPABASE_SECRET_KEY` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.epcsj-hub.org` |
| `NEXT_PUBLIC_CHURCH_TIME_ZONE` | `America/Los_Angeles` (교회 확인) |
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` | 카카오 앱 값 |
| `CRON_SECRET` | 32자 이상 임의 문자열(`openssl rand -hex 24`) |
| `RESEND_API_KEY` | Resend **알림용** API 키 |
| `MAIL_FROM` | `교회 지출청구 <no-reply@notify.epcsj-hub.org>` |
| `NEXT_PUBLIC_OFFICE_PHONE` | 사무실 번호 |
| `NEXT_PUBLIC_KAKAO_OPTION1`, `TRIAL_PAGES` | 비워 둔다. 실기기 시험 때만 `1`로 하고, 끝나면 비우고 다시 배포한다 |
| `HEALTHCHECK_CRON_URL` | healthchecks.io "매일 점검" 주소 |

`~/church/deploy.env` (권한 600) 한 줄: `DATABASE_ADMIN_URL=postgresql://postgres:<supabase/.env의 POSTGRES_PASSWORD>@127.0.0.1:54329/postgres`

`~/church/backup.env` (권한 600)은 7장을 참고한다.

```bash
chmod 600 ~/church/app.env ~/church/deploy.env ~/church/backup.env
```

## 6. 시스템 서비스, 첫 배포, Tunnel (한 번)

1. 시스템 서비스 네 개를 등록한다. Colima, 앱 상시 실행, 매일 07:00 점검, 매일 03:30 백업이다. 부팅 때 로그인 없이 `church` 사용자로 돈다. 앱 서비스는 첫 배포 전까지 몇 초마다 다시 시도하는데, 정상이다. 로그 순환 설정도 함께 넣는다.

```bash
colima stop; for n in colima app cron backup; do sed -e "s#__HOME__#$HOME#g" -e "s#__USER__#$(whoami)#g" ~/church/repo/src/ops/launchd/org.epcsj-hub.$n.plist | sudo tee /Library/LaunchDaemons/org.epcsj-hub.$n.plist >/dev/null; sudo chown root:wheel /Library/LaunchDaemons/org.epcsj-hub.$n.plist; sudo launchctl bootstrap system /Library/LaunchDaemons/org.epcsj-hub.$n.plist; done
```

```bash
sed -e "s#__HOME__#$HOME#g" -e "s#__USER__#$(whoami)#g" ~/church/repo/src/ops/newsyslog/org.epcsj-hub.conf | sudo tee /etc/newsyslog.d/org.epcsj-hub.conf >/dev/null
```

   Colima가 다시 켜지면 Supabase 컨테이너도 저절로 다시 뜬다(`docker compose ps`로 확인).

2. 배포한다. CI가 통과한 `origin/main` 커밋만 받는다. 새 폴더에 빌드 → 마이그레이션(확인 질문에 y) → 전환 → 앱 재시작(관리자 비밀번호) → `/api/health` 확인 순서다. 확인에 실패하면 이전 배포본으로 저절로 돌아간다.

```bash
sh ~/church/repo/src/ops/bin/deploy.sh
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

   시스템 서비스는 `/etc/cloudflared/`에서 설정을 읽는다. `src/ops/cloudflared/config.yml.example`을 `/etc/cloudflared/config.yml`로, `~/.cloudflared/<터널 ID>.json`을 `/etc/cloudflared/`로 복사한다. 터널 ID를 넣고 규칙을 검사한 뒤 서비스로 등록한다.

```bash
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
```

```bash
sudo cloudflared service install
```

4. Cloudflare 대시보드에서 설정한다.
   - Rules → Redirect: `epcsj-hub.org/*` → `https://www.epcsj-hub.org/$1`(301).
   - SSL/TLS: Full, "Always Use HTTPS" 켬.
   - Rules → Settings → **Normalize URLs to origin** 켬(경로 우회 방지, Tunnel 규칙과 이중 방어).
   - Security → WAF → Rate limiting rules: `api.epcsj-hub.org`의 `/auth/v1/otp`, `/auth/v1/verify`에 IP당 10초 20회 초과 시 차단. 무료 요금제는 규칙 한 개만 되므로 두 경로를 한 규칙에 넣는다.
   - Security → Bots: Bot Fight Mode는 끈다(카카오톡 안 브라우저와 Tunnel 요청을 막을 수 있다).
   - Caching → Cache Rules: `api.epcsj-hub.org` 전체 "Bypass cache"(서명된 영수증 주소가 기한 뒤에도 캐시에 남지 않게).
5. 카카오 개발자 콘솔에 넣는다.
   - Redirect URI: `https://www.epcsj-hub.org/auth/kakao/callback`, `https://api.epcsj-hub.org/auth/v1/callback`
   - 사이트 도메인: `https://www.epcsj-hub.org`
6. healthchecks.io "앱 상태" 검사를 `https://www.epcsj-hub.org/api/health`에 5분 간격으로 건다(외부에서 보는 상태).
7. 교회 홈페이지(`www.epcsj.org`)에 "지출청구" 링크로 `https://www.epcsj-hub.org`를 건다. 교인이 진짜 주소임을 알 수 있게 하기 위해서다(D42).

### 6-1. 첫 관리자 (한 번)

1. 맥미니에서 브라우저로 `http://127.0.0.1:8000`을 연다(Studio, 외부에는 열리지 않음). 사용자 이름과 비밀번호는 `supabase/.env`의 `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`다.
2. Authentication → Users → Add user로 첫 관리자의 메일 주소를 만들고 UID를 복사한다.
3. SQL Editor에서 아래를 실행한다. 관리자가 이미 있으면 거부되고, 감사 기록에는 "초기 설정"으로 남는다.

```sql
select public.bootstrap_first_admin('<UID>', '<이름>', '+1XXXXXXXXXX', '<메일>', '<당회 결의 날짜 등 근거>');
```

4. 그 뒤로는 모든 일을 앱의 관리자 화면에서 한다. 두 번째 관리자와 감사위원 권한도 여기서 준다(D30).

## 7. 백업 (매일 자동, D44, D47)

1. rclone에 Google Drive를 연결한다. 이름은 `church-drive`, 권한 범위(scope)는 **`drive.file`**(rclone이 만든 파일만 다룸)로 한다. `tech-media@kepc.org`로 로그인한다.

```bash
rclone config
```

2. `~/church/backup.env` (권한 600):

| 변수 | 값 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:8000` (맥 안에서 직접) |
| `SUPABASE_SECRET_KEY` | `supabase/.env`의 `SUPABASE_SECRET_KEY` |
| `BACKUP_DB_URL` | `deploy.env`의 주소와 같음 |
| `BACKUP_AGE_RECIPIENT` | age **공개** 키(`age1…`) |
| `BACKUP_REMOTE` | `church-drive:epc-hub-backup` |
| `HEALTHCHECK_BACKUP_URL` | healthchecks.io "백업" 주소 |

3. 한 번 손으로 돌려서 Drive에 `daily/backup-<날짜>.tar.age`와 `monthly/backup-<날짜>.tar.age`가 생기는지 확인한다.

```bash
sh ~/church/current/src/ops/bin/backup-nightly.sh
```

**백업이 하는 일**
- 영수증을 하나도 빠짐없이 받고 해시를 원본과 대조한다. 영수증이 없거나 다르면, 백업은 올리되 healthchecks.io에 실패로 알린다.
- 내려받기가 일시적으로 실패하면 그날 백업 전체를 실패로 처리한다. 반쯤 된 백업을 성공으로 올리지 않는다.
- 영수증 개수가 전날보다 줄면 실패로 알린다.
- 실패하면 암호화하지 않은 사본을 지운다.

**보관 규칙**
- Drive `daily/`에는 31일치를 둔다.
- `monthly/`에는 매월 처음 성공한 백업을 7년 둔다. 오래된 것 정리는 당회 승인 뒤 손으로 한다.
- Drive에서 지운 파일은 휴지통에 30일 남는다.

**복원 연습** (시범 전 1회, 이후 분기 1회, 맥미니가 아닌 맥에서)
1. 2~6장대로 빈 Supabase를 설치·시작하고, 백업의 `release.txt`에 적힌 커밋을 배포한다.
2. 아래를 실행한다.

```bash
sh ~/church/current/src/ops/bin/restore.sh <backup-날짜.tar.age> <age 개인 키 파일>
```

3. 복원 뒤 청구서 몇 건을 열어 영수증이 보이는지 확인한다.

복원 스크립트의 안전장치:
- 운영 서버(`APP_ENV=production`)에서는 `RESTORE_TARGET_OK=<그 기기 이름>`을 주지 않으면 거부한다.
- 교인·로그인·청구가 하나라도 있는 DB는 거부한다.
- 백업 때와 Supabase 버전이나 배포본이 다르면 거부한다.
- 데이터는 한 트랜잭션으로 불러오므로, 중간에 실패하면 아무것도 바뀌지 않는다.

## 8. 확인 (첫 배포 뒤, 그리고 큰 변경 뒤)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.epcsj-hub.org/api/health
```

200이어야 한다(앱이 DB와 인증 서버에 닿음).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.epcsj-hub.org/api/cron/daily
```

401이어야 한다(비밀값 없이 호출).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.epcsj-hub.org/trial
```

404여야 한다(시험 화면이 꺼져 있음).

```bash
for p in / /rest/v1/people /auth/v1/signup /auth/v1/admin/users /pg/tables /auth/v1/../../ /auth/v1/%2e%2e/%2e%2e/; do printf "%s " "$p"; curl -s --path-as-is -o /dev/null -w "%{http_code}\n" "https://api.epcsj-hub.org$p"; done
```

모두 404여야 한다. 하나라도 401이나 200이면 Tunnel 규칙이나 URL 정규화 설정이 잘못된 것이다(Studio·관리 API 노출).

1. 메일: 관리자 로그인 코드가 1분 안에 받은편지함으로 온다(스팸함이 아니어야 한다). 시험 청구를 올리면 알림 메일이 온다.
2. 시험 청구 한 건을 끝까지 진행한다. 사람 등록 → 초대 → 본인 휴대폰 연결 → 대면 확인 → 결재 → 서류 확인 → 수표 기록 → 무효 처리로 정리한다.
3. 맥미니를 `sudo fdesetup authrestart`로 재시작해서 Colima·Supabase·앱·Tunnel이 로그인 없이 저절로 다시 뜨는지 본다.
4. UPS 전원 코드를 한 번 뽑아 본다. 맥미니와 네트워크 장비가 UPS로 버티는지, 잔량 기준에서 안전하게 꺼지는지, 전기가 들어오면 다시 켜지는지(그다음 FileVault 잠금 해제) 확인한다. 전기가 일찍 돌아온 경우에는 다음 날 06:00 예약으로 켜지는지도 본다.
   - 주중에 아무도 없을 때 FileVault 잠금을 어떻게 풀지 정하고 실제로 해 본다: 교회 망 안의 중계 기기에서 SSH로 풀기, 주중에 올 수 있는 사람, 또는 FileVault 끄기(당회 결정).
5. `doc/device-checklist.md`를 실기기로 진행하고, `doc/operations.md`의 **시범 시작 전 점검표**를 끝낸다.

## 9. 업데이트와 되돌리기

- **앱:** `main`에 병합하고 CI가 통과하면 아래를 실행한다.

```bash
sh ~/church/repo/src/ops/bin/deploy.sh
```

  - 문제가 있으면 `deploy.sh --rollback`으로 바로 전의 정상 배포본으로 돌아간다.
  - DB 마이그레이션은 되돌리지 않는다. 마이그레이션은 기존 앱이 계속 돌 수 있게 **추가만** 하고(D8), 고칠 일이 있으면 고치는 마이그레이션을 새로 추가한다.
- **macOS:** 매월 한 번, 주일과 월초 지급일을 피해 저녁에 한다. 업데이트 → `sudo fdesetup authrestart` → 8장 첫 확인.
- **Supabase:** 분기에 한 번, 또는 보안 공지가 있을 때 한다.
  1. 개발용 맥에서 먼저 리허설한다. `install.sh`의 고정 버전을 올려 설치하고 테스트한다.
  2. 맥미니에서 백업 → 공식 `update.sh` → `start.sh`(쓰지 않는 서비스는 켜지 않는다) → 8장 확인.
  3. 고정 버전을 올렸으면 `install.sh`의 `SUPABASE_REF`도 고쳐 커밋한다. 백업에는 Supabase 버전이 기록되고, 복원은 같은 버전에서만 된다.
- **기록:** 무엇을 언제 바꿨는지 `doc/operations.md`의 변경 기록에 적는다.

## 10. 맥미니가 고장 났을 때

1. healthchecks.io 알림이나 교인의 연락으로 알게 된다. `doc/operations.md` 7장 "사이트가 안 열릴 때"를 따른다(장애 중 수표 금지, D35).
2. 전원이나 인터넷 문제면 고쳐서 켠다. FileVault 잠금을 풀면 로그인하지 않아도 모든 서비스가 다시 뜬다.
3. 기기가 죽었으면 다른 맥에서 2~6장을 다시 하고, Google Drive의 최신 백업으로 복원한다(7장 복원 절차, 이때는 그 맥이 새 운영 서버다). Cloudflare Tunnel은 새로 만들고 DNS를 새 터널로 돌린다.
4. 복원한 날짜와, 마지막 백업 이후 잃어버린 기간을 기록해 당회에 보고한다. 그 사이에 올린 청구는 작성자가 다시 올린다.
5. **도난·분실:** FileVault가 기록을 보호한다. 그래도 Supabase 키, Resend 키, Tunnel 토큰, `CRON_SECRET`을 모두 바꾸고, 새 기기에 복원하고, 당회에 보고한다.
6. **교체·폐기:** 새 서버로 옮겨 확인한 뒤 옛 기기는 "모든 콘텐츠 및 설정 지우기"를 하고, 비밀값을 바꾸고, 비품 대장에 날짜를 적는다.
