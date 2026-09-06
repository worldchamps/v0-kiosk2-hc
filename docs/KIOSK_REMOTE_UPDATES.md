# 설치형 키오스크 / 비공개 무료 업데이트

키오스크 PC는 로컬 객실관리 PC와 별개다. PMS 화면/운영 DB/객실관리 프로그램은 변경하지 않는다.
키오스크에는 Codex, Git, Node.js, Python 개발환경 없이 설치파일과 제조사 장비 드라이버만 필요하다.

## 연결 구조

- 무료 Firebase 프로젝트: `beachstay-kiosk-updates` (Spark, 결제 계정 미연결).
- DB: `https://beachstay-kiosk-updates-default-rtdb.asia-southeast1.firebasedatabase.app`.
- 비공개 설치파일: https://github.com/worldchamps/kiosk-private-releases
- 소스 저장소는 기존 공개 설정 유지. 설치파일은 별도의 PRIVATE 저장소에만 업로드한다.
- Cloud Run, Cloud Storage 설치파일 버킷, 상주 배포 서버는 사용하지 않는다.
- Firebase 공개 앱 설정/API 키는 인증 비밀이 아니다. 장비 권한은 Firebase Auth UID와 DB 보안 규칙으로 제한한다.
- 코드 수정/빌드/업로드/장비 업데이트 요청은 서로 별도다. Git push 및 파일 업로드만으로 장비를 재시작하지 않는다.

## 인증과 안전 경계

1. 배포 PC의 Google Cloud CLI 및 GitHub CLI 로그인은 배포 PC에서만 사용한다.
2. register가 128비트 무작위 코드(1시간 유효)를 발급한다. 등록 전 재발급하면 이전 코드는 무효다.
3. 키오스크는 전용 Firebase의 새 익명 UID를 만들고 갱신 토큰을 Windows safeStorage로 저장한 후 등록한다.
4. DB의 원자적 최초 등록 규칙이 코드와 UID를 결합한다. 같은 등록 파일로 다른 PC를 등록할 수 없다.
5. 등록 장비는 자기 요청만 읽고 자기 상태만 기록한다. 요청 생성/수정, 다른 장비/등록 목록 접근은 금지한다.
6. 배포 PC가 비공개 GitHub 파일의 만료형 다운로드 주소를 받아, 장비/버전/주소를 함께 서명한다.
   GitHub 계정 토큰, 서비스 계정 키, 서명 개인키는 키오스크에 전달하지 않는다.
7. 다운로드 주소는 짧은 유효기간을 가지며, 링크를 아는 사람은 만료 전까지 파일을 받을 수 있다.
   따라서 주소를 공개 로그/채팅/공유 문서에 남기지 않는다. 장비는 이를 읽을 권한이 있는 자기 요청에서만 받는다.
   설치파일은 24시간 요청 유효기간 안에 적용하되, 다운로드는 별도로 표시된 downloadExpiresAt 전에 시작해야 한다.
   오래 오프라인이었거나 주소가 만료되면 이전 요청을 취소하고 새 요청을 발급한다. 자동 링크 갱신 서버는 없다.
8. 고정 Ed25519 공개키로 요청/파일 메타데이터 서명을 검증하고 SHA-512와 크기를 검증한다.
9. 대기 화면, 60초 무입력, 신선한 UI 상태, 결제/체크인/인쇄 IPC와 HTTP 종료, 장비 브리지 준비를 확인한다.
   점검 화면 전환 후 취소/만료를 다시 확인하고 설치한다. 강제 설치와 앱 종료 시 자동 설치는 끈다.
10. 설치 시도를 디스크에 기록하고 새 버전 UI가 준비된 뒤 완료 보고한다. 실패한 요청을 반복 설치하지 않는다.
    설치 중 전원 차단에 대한 원자적 롤백은 없다. 복구는 수정한 정상 코드를 더 높은 버전으로 배포하거나 현장 재설치한다.

앱이 꺼졌거나 PC가 꺼지면 수신하지 않는다. Windows 로그인 시 자동 실행한다.
정상 앱은 약 60초마다 연결하고 마지막 상태가 3분 이내이면 online을 표시한다.
별도 Windows 서비스, 원격 전원 켜기, PMS 업데이트 버튼은 포함하지 않는다.
등록 갱신 토큰을 포함한 사용자 데이터 폴더는 다른 PC에 복제하지 않는다.

## 최초 개발 PC 준비 및 빌드

PowerShell, 키오스크 저장소 루트에서:

```powershell
npm.cmd ci
python -m venv .local/build-python
.local/build-python/Scripts/python.exe -m pip install -r hardware_server/requirements-build.txt
# 최초 한 번만 생성. 기존 개인키를 재생성하거나 덮어쓰지 않는다.
node scripts/kiosk-deploy.cjs keygen --out .local/update-signing
$env:KIOSK_UPDATE_PUBLIC_KEY_FILE = (Resolve-Path .local/update-signing/public.pem).Path
npm.cmd run electron:build
```

개인키는 배포 PC의 접근 제한된 장소에 백업한다. 공개키 교체는 별도 신뢰 마이그레이션이 필요하다.
package.json/package-lock.json 버전을 함께 올린다. 같은 버전 덮어쓰기는 금지한다.
공용 설치파일은 PC별 .env 없이 깨끗한 빌드 폴더에서 생성한다.
Windows Authenticode 인증서가 없으면 SmartScreen 경고가 있을 수 있다. Ed25519와 Windows 코드 서명은 다른 기능이다.
기존 장비 진단 화면의 import 경고와 기존 타입/린트 검사 생략 설정은 이 작업에서 변경하지 않았다.

## Firebase 초기 설정

전용 프로젝트의 무료 기본 DB만 사용한다. 기존 `kiosk-pms`에 아래 규칙을 배포하면 안 된다.
Firebase 콘솔에서 무료 Authentication 시작하기를 완료하고 익명 로그인만 활성화한다.
`ops/updates/database.rules.json`을 전용 DB에 배포한다. 기존 운영 규칙과 병합하지 않는다.
`electron/update-cloud.json`은 실제 전용 프로젝트와 PRIVATE 저장소에 고정된 공개 연결 설정이다.
Cloud Run/Identity Platform 유료 업그레이드나 결제 계정 연결은 하지 않는다.
무료 한도 초과 시 업데이트 연결이 제한될 수 있으나 별도 프로젝트라 PMS 한도와 공유하지 않는다.

## 키오스크 최초 등록

```powershell
node scripts/kiosk-deploy.cjs register --device property3-kiosk-01 --property property3 --out .local/property3-registration.json
```

지정한 키오스크에서 기존 BAT 프로그램을 정상 종료하고 새 설치파일을 실행한다.
등록 화면에서 받은 JSON과 **그 PC의 기존 .env.local**을 선택한다.
등록 코드는 1시간 안에 사용하고, 네트워크 장애 시 같은 파일/저장된 UID로 재시도한다.
기한이 지났다면 register를 새 출력 파일에 재발급하고 '새 등록 파일로 다시 시작'을 누른다.
이미 등록된 장비나 숙소를 덮어쓰지 않는다. 교체 PC는 새 장비 ID를 사용하고 이전 장비는 revoke한다.
프린터/COM/숙소/기존 예약 API 인증 설정은 암호화된 사용자 데이터에 보관하며 업데이트 후 유지한다.
현재 예약 API의 기존 Google/Firebase 인증은 여전히 이 PC 설정에 필요하다. 공용 설치파일에는 포함하지 않는다.
제조사 프린터/USB/결제단말기 드라이버는 각 PC에 별도로 설치되어 있어야 한다.

## 배포 PC에서 요청

```powershell
node scripts/kiosk-deploy.cjs publish --file "dist/TheBeachStay Kiosk Setup 1.2.0.exe" --version 1.2.0 --key .local/update-signing/private.pem
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs request --device property3-kiosk-01 --version 1.2.0 --from-version 1.1.0 --key .local/update-signing/private.pem
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs cancel --device property3-kiosk-01
```

request는 운영자가 명시적으로 지정한 장비와 버전에만 실행한다.
publish는 실제 EXE 버전/이름/업로드 SHA-256을 확인하고 SHA-512 서명 메타데이터를 저장한다.
업로드 도중 실패하면 비공개 draft를 확인한다. 임의 덮어쓰기 대신 원인 확인 후 새 버전을 사용한다.
취소/접근 차단은 이미 시작된 설치 또는 이미 전달된 만료형 URL을 회수하지 못한다.
초기 무료 연결 버전은 1.2.0이며, 최초 설치한 장비의 다음 원격 업데이트는 더 높은 버전이어야 한다.

## 검증

```powershell
npm.cmd run test:updates
node --experimental-strip-types --test tests/reservation-check-in.test.mts tests/reservation-schedule.test.mts tests/kiosk-sales-config.test.mts
npm.cmd run electron:build
# 명시적 live QA: 전용 프로젝트에 임시 qa-* 데이터/계정을 만들고 검사 후 제거한다.
node scripts/test-update-cloud.cjs --run-live
node scripts/test-update-cloud.cjs --run-live --release-version 1.2.0
```

live QA도 설치파일을 실행하거나 장비/예약 데이터를 사용하지 않는다.
등록/인증/타 장비 접근 차단/만료/취소/파일 검증과 실제 NSIS 업데이트는 별도 검증이다.
현장 한 대에서 두 버전 간 설치, 결제/체크인/인쇄 중 보류, 재부팅, 설정 유지와 영수증을 검증한 후 확대한다.
