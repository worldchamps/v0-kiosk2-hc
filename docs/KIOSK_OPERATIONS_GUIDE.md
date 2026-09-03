# AGAIN Kiosk 최신 통합 운영 가이드

> 최종 확인일: 2026-09-03 · 운영 브랜치: `main`

이 문서는 AGAIN Kiosk의 현재 운영 구조, 새 PC 설치, 환경설정, 실행, 업데이트,
프린터와 결제 장비 설정, 테스트 및 장애 대응을 한곳에 모은 기준 문서입니다.
다른 문서의 Vercel 배포 또는 property4 Web Serial 설명이 이 문서와 충돌하면 이 문서를 따릅니다.

## 1. 시스템 개요

AGAIN Kiosk는 숙소별 키오스크에서 다음 기능을 제공합니다.

- 예약자 이름 또는 Toss Front QR로 예약 조회
- 현재 키오스크와 예약 숙소가 일치하는지 확인
- 체크인 처리 후 객실번호와 도어락 비밀번호 표시·인쇄
- 공실 조회 후 숙박 또는 대실 현장예약
- 현금 또는 카드 결제
- Google Sheets 예약 기록 및 Firebase 객실 상태·PMS 대기열 갱신
- 관리자 화면의 장비 진단, 매출 확인, 카드 승인취소
- 외부 요청을 Firebase 인쇄 대기열로 전달하는 원격 인쇄

현재 운영은 Vercel 자동 배포 방식이 아닙니다. 개발 PC에서 GitHub에 push하고,
각 키오스크 PC가 같은 브랜치를 `git pull --ff-only`로 내려받아 로컬에서 실행합니다.

## 2. 현재 구성

```text
키오스크 Electron
├─ 로컬 Next.js 화면·API (http://localhost:3000)
│  ├─ Google Sheets: 예약 조회·체크인·현장예약 기록
│  └─ Firebase: 객실 상태·PMS 상태·PMS/인쇄 대기열
├─ 로컬 Python Hardware Server (ws://localhost:8082)
│  ├─ property1/3: Bixolon, 지폐 인식기, 지폐 배출기
│  └─ property4: BAC-2400 지폐 장비
├─ Windows 인쇄 시스템
│  └─ property4: SAM4S GCUBE 드라이버 인쇄
└─ Toss Front Bridge
   └─ WebSocket 또는 Serial로 Toss Front 플러그인과 통신
```

Electron은 실행 후 Python Hardware Server를 자동으로 시작합니다. 정상 실행 중에는
`hardware_server/start_server.bat`를 별도로 실행하지 않습니다. 별도 실행하면 8082 포트나
COM 포트를 두 프로세스가 동시에 사용해 충돌할 수 있습니다.

## 3. Property별 운영 방식

| Property | 객실 구분 | 화면 모드 | 영수증 프린터 | 현금 장비 |
|---|---|---|---|---|
| `property1` | C동, D동 | 기존 PMS 위 Electron 오버레이 | Bixolon, Hardware Server | 개별 인식기·배출기 |
| `property2` | Kariv | 기존 PMS 위 Electron 오버레이 | 현재 키오스크 출력 흐름에서 사용 안 함 | 개별 인식기·배출기 |
| `property3` | A동, B동 | Electron 전체화면 | Bixolon, Hardware Server | 개별 인식기·배출기 |
| `property4` | CAMP | Electron 전체화면 | SAM4S GCUBE, Windows 드라이버 | BAC-2400 통합 보드 |

소스에서 객실 구분은 `C/D → property1`, `KARIV → property2`, `A/B → property3`,
`CAMP → property4`로 판단합니다. 한 property 전용 변경은 반드시 property ID 조건으로
제한하여 다른 숙소의 흐름을 바꾸지 않아야 합니다.

## 4. 저장 위치와 Git 원칙

### Git에 커밋하는 항목

- `app/`, `components/`, `lib/`, `electron/`, `hardware_server/`의 공용 소스
- `package.json`, `package-lock.json`과 공용 설정
- 운영 배치 파일과 문서
- 모든 키오스크에 동일하게 적용해야 하는 수정

### PC에만 두는 항목

- `.env.local`: 비밀키, property ID, COM 포트, 프린터 이름과 출력 보정값
- `.next/`, `dist/`, 로그, 임시 폴더와 ZIP 산출물
- Toss 개발자센터에 직접 업로드할 로컬 플러그인 변경과 ZIP
- `C:\AGAIN_kiosk\sam4s`, `bixolon`, 제조사 드라이버·유틸리티·SDK 원본

`toss-front-plugin`의 기본 파일 일부는 과거부터 Git이 추적하고 있습니다. 현재 운영 원칙은
사용자가 Git 반영을 별도로 요청하지 않는 한 이 폴더의 로컬 변경과 ZIP을 스테이징하지 않는 것입니다.
키오스크 PC에서는 공용 소스를 직접 수정하지 않아야 하며, `git status --short`에 추적 파일 변경이
나타나면 pull하기 전에 원인을 확인합니다.

## 5. 새 키오스크 PC 설치

### 5.1 준비 프로그램

- Windows 10/11 64비트
- Git
- Node.js 22 LTS 권장 (`22.15.0` 환경에서 확인)
- Python 3와 `pip`
- 해당 PC의 USB/Serial 장치 드라이버
- property4: SAM4S GCUBE Windows 프린터 드라이버

PowerShell에서 `npm` 실행 정책 오류가 나면 항상 `npm.cmd`를 사용합니다.

### 5.2 저장소 받기

새 PC에서는 운영할 폴더에서 다음 브랜치를 clone합니다.

```powershell
git clone --branch main https://github.com/worldchamps/v0-kiosk2-hc.git
cd v0-kiosk2-hc
```

이미 clone되어 있다면 브랜치와 변경 상태부터 확인합니다.

```powershell
git branch --show-current
git status --short
```

브랜치는 `main`이어야 합니다. 키오스크 PC에서 수정 파일이 보이면
임의로 reset하거나 덮어쓰지 말고 먼저 변경 내용을 확인합니다.

### 5.3 의존성 설치와 최초 빌드

가장 간단한 최초 설치 방법은 저장소 루트에서 다음 파일을 실행하는 것입니다.

```powershell
.\build_all.bat
```

이 파일은 Python Hardware Server 패키지, Node 모듈, Next.js 운영 빌드를 순서대로 준비합니다.
직접 실행할 경우에는 다음과 같습니다.

```powershell
python -m pip install -r hardware_server\requirements.txt
npm.cmd install
npm.cmd run build
```

## 6. `.env.local` 설정

`.env.local`은 저장소 루트에 만들며 Git에 커밋하지 않습니다. 기존 정상 키오스크에서
복사할 때도 키오스크별 property, 위치, COM 포트와 프린터 이름은 새 PC 환경에 맞춰 확인합니다.

### 6.1 공통 property 설정

다음 세 property 값은 동일하게 맞춥니다.

```env
KIOSK_PROPERTY=property4
KIOSK_PROPERTY_ID=property4
NEXT_PUBLIC_KIOSK_PROPERTY_ID=property4
KIOSK_START_LOCATION=Camp
OVERLAY_MODE=false
KIOSK_WINDOW_MODE=true
```

property별 대표값:

| Property | ID 값 | `KIOSK_START_LOCATION` | `OVERLAY_MODE` |
|---|---|---|---|
| Property1 | `property1` | 필요 시 `C` 또는 `D` | `true` |
| Property2 | `property2` | `KARIV` | `true` |
| Property3 | `property3` | `A` 또는 `B` | `false` |
| Property4 | `property4` | `Camp` | `false` |

`KIOSK_WINDOW_MODE=true`는 운영 PC의 Electron 창을 키오스크 전체화면으로 고정합니다.
오버레이 키오스크에서는 기존 PMS 창 제목에 맞는 `PMS_WINDOW_TITLE`도 설정합니다.

### 6.2 Firebase와 Google Sheets

실제 값은 기존 보안 저장소에서 전달받아 입력합니다. 값 자체를 문서나 Git에 기록하지 않습니다.

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID=
```

Google 서비스 계정은 대상 Spreadsheet에 접근 권한이 있어야 합니다. `FIREBASE_PRIVATE_KEY`와
`GOOGLE_SHEETS_PRIVATE_KEY`는 줄바꿈을 `\n`으로 넣고 전체를 큰따옴표로 감쌉니다.

### 6.3 API와 영수증 사업자 정보

```env
API_KEY=
ADMIN_API_KEY=
NEXT_PUBLIC_API_KEY=

NEXT_PUBLIC_RECEIPT_HOTEL_NAME=
NEXT_PUBLIC_RECEIPT_BUSINESS_NAME=
NEXT_PUBLIC_RECEIPT_BUSINESS_NUMBER=
NEXT_PUBLIC_RECEIPT_REPRESENTATIVE=
NEXT_PUBLIC_RECEIPT_ADDRESS=
NEXT_PUBLIC_RECEIPT_PHONE=
```

비어 있는 영수증 사업자 항목은 출력에서 생략됩니다. 키나 관리자 비밀번호는 이 문서에 적지 않습니다.

### 6.4 Bixolon과 일반 지폐 장비

property1/3을 포함한 일반 Hardware Server 설정입니다.

```env
PRINTER_PORT=COM2
ACCEPTOR_PORT=COM4
DISPENSER_PORT=COM5
```

- Bixolon 통신 속도는 현재 Hardware Server에서 `115200`을 사용합니다.
- 새 설치에서는 `PRINTER_PATH`가 아니라 `PRINTER_PORT`를 사용합니다.
- 실제 COM 번호는 Windows 장치 관리자에서 확인합니다.
- 하나의 COM 포트는 한 프로그램만 열 수 있습니다.

### 6.5 property4 BAC-2400과 SAM4S

```env
BAC2400_PORT=COM5

# 자동 검색으로 찾지 못하거나 SAM4S 프린터가 여러 개일 때만 지정
SAM4S_PRINTER_NAME=SAM4S GCUBE-102

# 선택: 양수는 오른쪽/아래쪽, 음수는 왼쪽/위쪽으로 이동
SAM4S_OFFSET_X_MM=0
SAM4S_OFFSET_Y_MM=0
```

`BOARD3400_PORT`는 `BAC2400_PORT`가 없을 때 사용하는 이전 호환 이름입니다. 새 설정에서는
`BAC2400_PORT`를 사용합니다. SAM4S 드라이버가 사용하는 COM 포트는 Windows 프린터 속성에서
설정하며, 앱이 그 COM 포트를 직접 열지 않습니다.

### 6.6 Toss Front 결제

WebSocket 방식:

```env
TOSS_FRONT_TRANSPORT=websocket
TOSS_FRONT_WS_URL=ws://프론트-IP:9000/kiosk
TOSS_FRONT_PAIRING_KEY=16자-이상의-동일한-키
```

Serial 방식:

```env
TOSS_FRONT_TRANSPORT=serial
TOSS_FRONT_SERIAL_PATH=COM3
TOSS_FRONT_SERIAL_BAUD_RATE=115200
TOSS_FRONT_PAIRING_KEY=16자-이상의-동일한-키
```

`TOSS_FRONT_TRANSPORT=auto`이면 설정된 연결을 우선 사용하고 가능한 다른 방식으로 재시도합니다.
키오스크와 Toss Front 플러그인의 pairing key는 같아야 합니다.

## 7. 실행과 종료

### 정상 운영 실행

운영 PC에서는 저장소 루트의 다음 파일을 실행합니다.

```powershell
.\run_kiosk_auto.bat
```

이 파일은 기존 `.next` 빌드가 없을 때만 자동 빌드하고, Next.js 서버와 Electron을 실행합니다.
Git pull 후에는 이전 빌드가 남아 있을 수 있으므로 반드시 먼저 `npm.cmd run build`를 실행합니다.

개발 모드는 다음 명령을 사용합니다.

```powershell
npm.cmd run electron:dev
```

개발 모드는 느린 `HEAD / 200` 로그나 개발용 재빌드가 반복될 수 있으므로 실제 운영에는 사용하지 않습니다.

### 종료

Electron 창과 Next.js 명령창을 정상 종료합니다. 전용 키오스크 PC에서만 필요하면
`stop-kiosk.bat`를 사용할 수 있지만, 이 파일은 PC에서 실행 중인 모든 Node/Electron 프로세스를
종료하므로 다른 프로그램이 함께 실행되는 PC에서는 사용하지 않습니다.

## 8. GitHub 업데이트 반영

### 개발 PC

1. 원격 배포 브랜치를 fetch합니다.
2. 작업 전 기존 변경을 확인합니다.
3. 한 기능만 수정하고 관련 테스트와 운영 빌드를 실행합니다.
4. 해당 파일만 스테이징하여 한 커밋으로 만듭니다.
5. `origin/main`에 push합니다.

### 키오스크 PC

프로그램을 종료하고 저장소 루트에서 확인합니다.

```powershell
git branch --show-current
git status --short
```

브랜치가 맞고 추적 파일 변경이 없을 때만 진행합니다.

```powershell
git pull --ff-only origin main
npm.cmd install
npm.cmd run build
.\run_kiosk_auto.bat
```

`package.json`과 `package-lock.json`이 바뀌지 않은 업데이트라면 `npm.cmd install`은 생략할 수 있습니다.
`.env.local`은 Git 대상이 아니므로 pull 후에도 해당 PC 설정이 유지됩니다.

## 9. 주요 업무 흐름

### 기존 예약 체크인

1. 고객명 또는 Toss Front QR로 Google Sheets 예약을 조회합니다.
2. 객실번호와 숙소 정보를 이용해 현재 property에서 처리 가능한 예약인지 확인합니다.
3. 체크인을 확정하면 `Reservations` 시트의 상태와 체크인 시간을 갱신합니다.
4. Firebase PMS 대기열에 객실번호, 고객명, 체크인 날짜를 추가합니다.
5. 객실번호와 비밀번호를 표시하고 해당 property의 방식으로 영수증을 인쇄합니다.

### 현장예약

1. Firebase에서 현재 공실을 가져옵니다.
2. Firebase `pms_status`의 객실별 숙박·대실, 현금·카드 요금을 표시합니다.
3. 결제 정보를 검증하고 같은 카드 결제가 중복 사용되지 않도록 선점합니다.
4. Google Sheets에 숙소명과 예약 경로 `키오스크`로 예약을 저장합니다.
5. Firebase 객실 상태를 `사용 중`으로 변경하고 PMS 대기열에 추가합니다.
6. 결제·객실 정보가 포함된 영수증을 출력합니다.

현장예약과 체크인 SMS 발송은 현재 소스에서 비활성화되어 있습니다.

## 10. 프린터 운영

### 10.1 property4 SAM4S GCUBE

현재 property4는 Web Serial이 아니라 Windows 프린터 드라이버를 사용합니다.

1. SAM4S GCUBE 드라이버를 설치합니다.
2. Windows 프린터 목록에서 장치가 보이는지 확인합니다.
3. 프린터 속성의 포트를 실제 연결된 COM 포트로 지정합니다.
4. 드라이버 테스트 페이지와 메모장 한글 인쇄가 정상인지 먼저 확인합니다.
5. 드라이버/유틸리티에서 KOR 글꼴과 80mm 용지, 작업 종료 시 용지 공급·자르기를 설정합니다.
6. 앱의 관리자 화면에서 `객실 정보 영수증 인쇄`를 실행합니다.

앱은 `SAM4S_PRINTER_NAME`이 있으면 정확히 일치하는 장치를 사용하고, 없으면 이름에
`SAM4S`와 `GCUBE`가 포함된 프린터를 자동 선택합니다. Windows GDI가 `맑은 고딕`으로
한글과 크기·굵기를 렌더링하며, 프린터의 물리 절단은 Windows 드라이버 설정이 처리합니다.

출력이 좌우 또는 상하로 밀리면 `.env.local`의 `SAM4S_OFFSET_X_MM`,
`SAM4S_OFFSET_Y_MM`을 1~2mm 단위로 조정하고 앱을 완전히 재시작합니다. 현재 인쇄 코드는
프린터 드라이버의 hard margin을 자동 보정하므로 큰 값을 먼저 넣지 않습니다.

인쇄하지 않고 한글 렌더러만 검사:

```powershell
node electron\sam4s-receipt.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File electron\sam4s-print.ps1 -CheckOnly
```

정상 출력은 각각 `SAM4S receipt self-check passed`, `SAM4S GDI self-check passed`입니다.

### 10.2 Bixolon

Bixolon은 Python Hardware Server가 `hardware_server/bin/BXLPAPI_x64.dll` 또는 32비트 DLL을
불러와 COM 포트로 연결합니다. 한글은 Windows SDK의 KS5601 코드페이지 949로 보내며,
인쇄 후 SDK의 `CutPaper`를 실행합니다.

앱을 완전히 종료한 상태에서만 단독 테스트를 실행합니다.

```powershell
python hardware_server\test_bixolon_korean.py --port COM2
```

앱과 테스트 프로그램을 동시에 실행하면 같은 COM 포트를 두 프로그램이 열 수 없어 실패합니다.

## 11. 현금 장비와 Hardware Server

- Electron이 Hardware Server를 자동 시작하고 `ws://localhost:8082`에 연결합니다.
- property4는 `BAC2400_PORT`의 BAC-2400 V1.3 통합 보드로 BV1/BD1을 제어합니다.
- 다른 property는 `ACCEPTOR_PORT`와 `DISPENSER_PORT`를 각각 사용합니다.
- property4에서는 Hardware Server가 SAM4S를 열지 않으며 프린터는 Windows 드라이버가 담당합니다.

장치가 반응하지 않으면 다음 순서로 확인합니다.

1. Windows 장치 관리자에서 COM 번호 확인
2. 다른 프로그램이 같은 COM 포트를 사용 중인지 확인
3. `.env.local`의 포트 확인 후 앱 완전 재시작
4. Electron 명령창에서 `[HARDWARE_SERVER]`와 `[HARDWARE_BRIDGE]` 로그 확인
5. 앱을 종료한 뒤 `python hardware_server\serial_check.py`로 포트 접근 가능 여부 확인

## 12. Toss Front 플러그인

`toss-front-plugin`은 Toss Place 개발자센터에 ZIP으로 직접 업로드하는 플러그인입니다.

1. 플러그인 파일이 ZIP 최상단에 오도록 압축합니다.
2. Toss 개발자센터의 개발 배포에 업로드합니다.
3. 필요한 ACL에 `https://cdn.tossplace.com`, `https://static.toss.im`을 등록합니다.
4. Front 설정 화면과 키오스크 `.env.local`에 동일한 pairing key를 입력합니다.
5. WebSocket이면 Front IP와 9000 포트, Serial이면 실제 COM 포트를 확인합니다.

예약 QR은 `AGAIN:RESERVATION:<예약번호>` 형식을 사용합니다. 카드 테스트는 실제 승인이
발생할 수 있으므로 승인번호와 시각을 기록하고 테스트 직후 승인취소를 확인합니다.
플러그인 변경 및 ZIP은 현재 Git 배포와 분리하여 로컬에서 관리합니다.

## 13. 배포 후 필수 점검

코드가 빌드됐다는 것만으로 키오스크 배포를 완료 처리하지 않습니다.

- 시작 위치와 property가 올바른지 확인
- 예약자 이름 조회와 property 불일치 안내 확인
- 승인된 테스트 예약으로 체크인 완료 확인
- 공실·PMS 요금 로딩 확인
- 안전한 테스트 데이터가 있을 때만 현장예약·결제 확인
- Google Sheets 체크인/현장예약 기록 확인
- Firebase 객실 상태와 PMS 대기열 확인
- 실제 영수증의 한글, 글자 크기, 정렬, 용지 공급, 절단 확인
- 현금 장비와 Toss Front 연결 상태 확인

실제 고객 데이터가 바뀌는 검사는 승인된 테스트 예약이 있을 때만 수행합니다.

## 14. 문제 해결

### PowerShell에서 `npm.ps1` 실행이 차단됨

`npm` 대신 `npm.cmd`를 사용합니다.

### 화면이 로딩되지 않음

- Next.js 서버가 `http://localhost:3000`에서 실행 중인지 확인
- `.env.local`의 Firebase/Google 키와 property 값 확인
- 개발 모드가 아닌 운영 빌드로 재확인
- Electron 명령창의 `did-fail-load` 또는 API 오류 확인

### property4에서 종이가 조금만 나오고 빈 상태로 잘림

- Windows 테스트 페이지와 메모장 한글 인쇄부터 확인
- 설치된 프린터 이름과 `SAM4S_PRINTER_NAME` 확인
- 드라이버의 용지 폭, 공급·자르기 설정 확인
- 명령창의 `[SAM4S] Native Windows print requested`와 실패 메시지 확인
- 앱이 아닌 일반 브라우저로 실행 중인지 확인. 운영은 Electron으로 실행

### SAM4S 출력이 좌우로 밀림

- `SAM4S_OFFSET_X_MM`을 작은 단위로 조정
- Y 방향도 밀리면 `SAM4S_OFFSET_Y_MM` 조정
- 매번 앱을 완전히 재시작하고 같은 테스트 영수증으로 비교

### Hardware Server가 연결되지 않음

- Python과 `hardware_server/requirements.txt` 설치 확인
- 8082 포트를 다른 프로세스가 사용 중인지 확인
- Electron이 이미 실행 중일 때 Hardware Server를 수동으로 중복 실행하지 않음

### `git pull`이 거부됨

- `git status --short`로 키오스크 PC의 수정 파일 확인
- `.env.local`은 ignore되므로 원인이 아님
- 수정 파일을 자동 reset하거나 삭제하지 말고 개발 PC와 비교하여 원인을 확인

## 15. 문서 역할

- `docs/KIOSK_OPERATIONS_GUIDE.md`: 설치·운영·장비·배포의 최신 기준 문서
- `AGENTS.md`: Codex가 따라야 하는 Git 및 작업 안전 규칙
- `toss-front-plugin/README.md`: Toss Front 플러그인 업로드와 QR 사용 설명
- 그 밖의 `docs/*.md`: 과거 구조 또는 특정 기능 참고 자료. 충돌 시 이 통합 가이드 우선

프로그램의 배포 방식, 환경변수, property별 하드웨어 또는 실행 명령이 변경되면 기능 변경과
같은 커밋에서 이 문서도 함께 갱신합니다.
