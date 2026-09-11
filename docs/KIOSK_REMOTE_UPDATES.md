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
- 앞으로 정식 릴리스는 **같은 버전의 32비트(ia32)와 64비트(x64)를 함께 빌드·검증·게시**한다.
  두 설치파일과 두 서명 메타데이터의 GitHub 게시 및 전용 업데이트 DB 등록을 모두 확인해야 릴리스 완료다.
  단일 비트수 게시 명령은 운영자가 명시한 예외/부분 실패 복구에만 사용한다.

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
# 아래 python은 64비트 Python이어야 한다.
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
QA 개선 이후 장비 진단 화면의 잘못된 import를 정리했고 타입 검사 생략을 제거했다.
일반 빌드와 설치파일 빌드 모두 전체 회귀 검사를 먼저 실행한다. 린트는 아직 구성하지 않았으며 통과로 간주하지 않는다.
현재 소스의 검증 절차와 현장 승인 조건은 [키오스크 QA 기준](KIOSK_QA.md)을 따른다.

### Windows 32비트 빌드 (1.3.0부터)

CPU가 x64여도 **Windows가 32비트이면 ia32 설치파일**을 사용한다.
기본 릴리스 준비는 `electron:build:all`이며 x64 다음 ia32를 순서대로 빌드한다.
개별 검사용 `electron:build`는 기존처럼 x64만, `electron:build:ia32`는 ia32만 빌드한다.
Node.js 개발 도구는 64비트를 사용해도 되지만 내장 장비 프로그램을 만드는 Python은 대상 비트수와 같아야 한다.
공식 [Python Windows 배포](https://docs.python.org/3/using/windows.html#the-nuget-org-packages)의
32비트 Python을 별도 폴더에 준비한 후 다음 명령을 실행한다. 기존 Python/Windows를 교체하지 않는다.

```powershell
# <32비트 Python 경로>를 실제 준비한 경로로 바꾼다.
& '<32비트 Python 경로>/python.exe' -m venv .local/build-python-ia32
.local/build-python-ia32/Scripts/python.exe -m pip install -r hardware_server/requirements-build.txt
# 기존 장비가 신뢰하는 공개키를 사용한다. keygen을 다시 실행하지 않는다.
$env:KIOSK_UPDATE_PUBLIC_KEY_FILE = (Resolve-Path .local/update-signing/public.pem).Path
npm.cmd run electron:build:ia32
```

다른 위치의 빌드용 Python은 `KIOSK_BUILD_PYTHON_X64`, `KIOSK_BUILD_PYTHON_IA32`로 각각 지정한다.
우선순위는 비트수별 변수 → 기존 공통 `KIOSK_BUILD_PYTHON` → 기본 venv 경로다.
공통 변수에 한 비트수의 Python만 설정한 채 두 비트수를 빌드하면 다른 쪽에서 중단되므로, 비트수별 변수를 지정하거나 공통 변수만 해제한다.
빌드는 Python 실행파일과 실제 런타임 비트수를 확인하며, 다르면 패키징 전에 중단한다.
[PyInstaller도 Python의 비트수에 따라 실행파일을 생성한다.](https://pyinstaller.org/en/v6.16.0/operating-mode.html)

| Windows | 빌드 명령 | 설치파일 |
| --- | --- | --- |
| 64비트 | `npm.cmd run electron:build` | `dist/x64/TheBeachStay Kiosk Setup 1.3.0-x64.exe` |
| 32비트 | `npm.cmd run electron:build:ia32` | `dist/ia32/TheBeachStay Kiosk Setup 1.3.0-ia32.exe` |

두 빌드는 순서대로 실행한다. 같은 `.next` 빌드 폴더를 사용하므로 병렬 실행하지 않는다.
검증은 NSIS 외부 실행파일(항상 32비트일 수 있음)이 아닌 내부 페이로드와 Electron/장비 EXE의 비트수를 검사한다.
패키지의 장비 프로그램은 `--self-test`로, Electron은 Node 모드로 의존성 로딩과 임시 loopback 웹서버의 설정 응답을 확인한다.
예약/운영 DB 및 장비에는 연결하지 않는다.
[SerialPort가 제공하는 N-API 바이너리](https://serialport.io/docs/guide-installation/)를 사용한다.
빌드 래퍼는 대상 비트수의 바이너리를 확인한 뒤 재컴파일을 생략하고, 최종 Electron에서 실제 로딩을 검증한다.
제조사 Bixolon DLL을 포함해야 하면 같은 비트수의 DLL 경로를 `KIOSK_BIXOLON_SDK_FILE`로 지정한다.
함께 빌드할 때는 `KIOSK_BIXOLON_SDK_FILE_X64`, `KIOSK_BIXOLON_SDK_FILE_IA32`를 사용하면 각 값이 공통 변수보다 우선한다.
지정하지 않으면 제조사 DLL을 새로 포함하지 않으므로 실제 프린터의 드라이버/SDK 준비 여부를 별도로 확인한다.

기존 Electron 28.3.3을 유지한 호환성 확장이다. 최신 런타임으로 교체한 보안 업데이트는 아니다.
[Electron 43은 마지막 32비트 지원 계열](https://www.electronjs.org/blog/electron-43-0)이므로 추후 런타임 업그레이드 시 지원 범위를 다시 확인한다.
Windows 10 Enterprise 2016 LTSB 32비트 실기기에서의 화면/결제/인쇄/재부팅/원격 업데이트 검증은 별도로 필요하다.

## Firebase 초기 설정

전용 프로젝트의 무료 기본 DB만 사용한다. 기존 `kiosk-pms`에 아래 규칙을 배포하면 안 된다.
Firebase 콘솔에서 무료 Authentication 시작하기를 완료하고 익명 로그인만 활성화한다.
`ops/updates/database.rules.json`을 전용 DB에 배포한다. 기존 운영 규칙과 병합하지 않는다.
`electron/update-cloud.json`은 실제 전용 프로젝트와 PRIVATE 저장소에 고정된 공개 연결 설정이다.
Cloud Run/Identity Platform 유료 업그레이드나 결제 계정 연결은 하지 않는다.
무료 한도 초과 시 업데이트 연결이 제한될 수 있으나 별도 프로젝트라 PMS 한도와 공유하지 않는다.

## 키오스크 최초 등록

property3의 A동/B동 PC는 각각 해당 동 객실만 판매·체크인한다.
등록 전에 [A/B동 설치 설정](KIOSK_BUILDING_SCOPE.md)에 따라 각 PC의 `KIOSK_BUILDING`을 지정한다.
같은 등록파일이나 암호화된 사용자 데이터 폴더를 두 PC에 복사하지 않는다.

```powershell
node scripts/kiosk-deploy.cjs register --device property3-kiosk-01 --property property3 --out .local/property3-registration.json
# 새 32비트 PC 등록 예시. 실제 승인된 장비 ID로 변경한다.
node scripts/kiosk-deploy.cjs register --device property3-kiosk-a-32 --property property3 --arch ia32 --out .local/property3-a-32-registration.json
```

`--arch` 생략 시 x64이다. 등록 JSON과 장비 등록 목록에 비트수를 기록하며, 앱의 비트수와 다르면 초기 등록을 중단한다.
비트수 필드가 없는 기존 등록은 x64로 해석한다. 기존 장비의 비트수를 재등록으로 덮어쓰거나 자동 전환하지 않는다.
32비트 OS용 신규 장비는 새 ID와 `--arch ia32`로 등록한다. A/B동 설정과 등록 ID는 비트수와 별도로 관리한다.

지정한 키오스크에서 기존 BAT 프로그램을 정상 종료하고 새 설치파일을 실행한다.
등록 화면에서 받은 JSON과 **그 PC의 기존 .env.local**을 선택한다.
등록 코드는 1시간 안에 사용하고, 네트워크 장애 시 같은 파일/저장된 UID로 재시도한다.
기한이 지났다면 register를 새 출력 파일에 재발급하고 '새 등록 파일로 다시 시작'을 누른다.
이미 등록된 장비나 숙소를 덮어쓰지 않는다. 교체 PC는 새 장비 ID를 사용하고 이전 장비는 revoke한다.
프린터/COM/숙소/기존 예약 API 인증 설정은 암호화된 사용자 데이터에 보관하며 업데이트 후 유지한다.
현재 예약 API의 기존 Google/Firebase 인증은 여전히 이 PC 설정에 필요하다. 공용 설치파일에는 포함하지 않는다.
제조사 프린터/USB/결제단말기 드라이버는 각 PC에 별도로 설치되어 있어야 한다.

## 배포 PC에서 요청

먼저 package.json/package-lock.json을 같은 새 버전으로 올리고 두 비트수의 Python/SDK를 준비한다.
빌드와 게시 명령을 분리하며, `kiosk:release`는 실제 게시 승인을 받은 경우에만 실행한다.
이미 게시한 버전은 재빌드 파일로 교체하지 않는다.

```powershell
npm.cmd run electron:build:all
$releaseVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
npm.cmd run kiosk:release -- --version $releaseVersion --key .local/update-signing/private.pem
```

`kiosk:release`는 `publish-all`을 실행한다. `dist/x64`와 `dist/ia32`의 같은 버전 파일을 모두 검사하고,
DB 접근 및 두 GitHub 태그의 중복 여부를 확인한 다음 순서대로 게시한다. 한 파일이 없거나 비트수/버전이 틀리면 첫 업로드 전에 중단한다.
`--arch`/`--file`로 한쪽만 선택할 수 없으며 장비 업데이트 요청은 생성하지 않는다.

GitHub의 두 릴리스와 DB 기록은 단일 트랜잭션이 아니다. 업로드 중 장애가 나면 일부만 게시될 수 있으며 성공 메시지를 내지 않는다.
이때 기존 파일을 삭제/덮어쓰지 말고 각 태그의 draft/게시 상태와 DB 등록을 먼저 확인한다.
재실행 시 이미 있는 릴리스는 중복 방지로 중단한다. 운영자 승인 후 미완료 비트수만 기존 `publish --file ... --version ... --arch ... --key ...`로 복구한다.
GitHub에 이미 있고 DB에만 없는 경우 `publish` 재시도로 해결되지 않는다. 기존 파일·서명 검증 후 별도 DB 등록 복구가 필요하다.

장비 업데이트는 게시와 별도로 명시적으로 선택한 장비에만 요청한다. 아래 버전은 해당 장비의 실제 현재/목표 버전으로 바꾼다.

```powershell
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs request --device property3-kiosk-01 --version 1.3.0 --from-version 1.2.0 --key .local/update-signing/private.pem
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs cancel --device property3-kiosk-01
```

request는 운영자가 명시적으로 지정한 장비와 버전에만 실행한다.
publish는 실제 EXE 버전/이름/내부 비트수/업로드 SHA-256을 확인하고 SHA-512 서명 메타데이터를 저장한다.
x64는 기존 태그/DB 경로(`v1.3.0`, `releases/v1_3_0`)를 유지하고 ia32는 별도 경로(`v1.3.0-ia32`, `releases/v1_3_0-ia32`)를 사용한다.
request는 장비 등록의 비트수로 릴리스를 선택한다. 앱에서도 서명된 비트수를 확인해 잘못된 파일은 다운로드 전에 거부한다.
32비트 지원을 위해 Firebase 보안 규칙이나 PMS를 변경할 필요는 없다.
업로드 도중 실패하면 비공개 draft를 확인한다. 임의 덮어쓰기 대신 원인 확인 후 새 버전을 사용한다.
취소/접근 차단은 이미 시작된 설치 또는 이미 전달된 만료형 URL을 회수하지 못한다.
초기 무료 연결 버전은 1.2.0이며, 최초 설치한 장비의 다음 원격 업데이트는 더 높은 버전이어야 한다.
비트수 필드가 없는 기존 x64 장비/릴리스 경로는 유지한다. ia32 장비는 ia32 파일만, x64 장비는 x64 파일만 받는다.
장비 비트수의 자동 전환은 지원하지 않는다. 결제/체크인/인쇄 중 설치 보류, 서명·해시 검사와 기존 PC 설정 유지도 그대로 적용한다.

2026-09-09 게시 상태: `v1.3.0-ia32`만 GitHub에 게시됐고, Google CLI 재로그인이 필요해 전용 DB 등록은 보류됐다.
따라서 1.3.0 전체 비트수의 원격 업데이트 준비가 완료된 상태는 아니다. 운영 전 로그인 및 각 릴리스/DB 상태를 다시 확인한다.

## 검증

### 2026-09-11 체크인 확인 중 반복 (1.3.3)

Firebase의 단발성 `once()` 읽기는 리스너가 없어지면 로컬 캐시를 비운다.
그 직후 상태 전환 transaction이 `null`을 받고 `undefined`로 중단해,
예약표 저장 이후에도 체크인 및 현장 예약이 다음 단계로 진행하지 못했다.
1.3.3은 해당 상태 전환 동안 읽기 리스너를 유지하고 완료·실패 시 자기 리스너만 해제한다.
서버의 조건부 갱신, 중복 예약·결제·객실 명령 방지 및 업데이트 안전 조건은 유지한다.

회귀 검사는 실제 Firebase Admin SDK를 loopback 모의 서버에 연결해 캐시 소멸과
수정 후 읽기를 검증한다. 운영 서비스와 실제 고객 데이터를 사용하지 않는다.
이미 직접 안내한 손님의 예약이나 대기 중 작업을 업데이트 목적으로 삭제·완료 처리하지 않는다.
미확정 체크인 화면은 자동 설치를 보류하므로 현장 상태를 별도로 확인해야 한다.
소스·빌드 검증은 게시나 실제 장비 업데이트 완료를 뜻하지 않는다.

### 2026-09-10 원격 다운로드 오류와 최초 복구

1.3.1 두 비트수의 비공개 게시/서명/DB 등록은 완료됐으나, property3 B동 32비트의
1.3.0 → 1.3.1 첫 요청은 다운로드 캐시 파일 생성 단계에서 ENOENT로 실패했다.
설치·앱 종료는 시작되지 않았고 나머지 장비에 요청하지 않았다. 실패한 요청은 취소했다.

기존 PrivateReleaseProvider가 확장자 없는 GitHub 자산 URL 전체를 `info.url`에 넣었고,
electron-updater 6.6.2가 이를 Windows 캐시 파일명으로 사용한 것이 원인이다.
1.3.2에서는 캐시 파일명을 `installer.exe`로 분리하고 실제 네트워크 URL/서명/해시 검증은 유지한다.
Windows 경로로 변형된 다운로드 URL도 오류 보고에서 숨긴다.
실제 NsisUpdater 다운로드/캐시 코드에 모의 전송을 연결한 회귀 검사로 재현·수정을 확인한다.

이미 설치된 1.2.0/1.3.0 및 1.3.1에는 이 클라이언트 오류가 남아 있으므로 서버 요청 재발급만으로
복구되지 않는다. 현장 또는 별도로 승인된 원격 제어로 같은 비트수의 1.3.2 이상 설치파일을 한 번 적용한다.

1. 고객의 결제·입실·현금 반환·인쇄 및 미확정 거래가 없는지 운영자가 확인한다.
2. 기존 키오스크를 실행하던 동일한 Windows 사용자로 로그인하고 프로그램을 정상 종료한다.
3. 기존 프로그램을 먼저 제거하거나 사용자 데이터를 지우지 말고, 해당 PC 비트수의 새 설치파일을 실행한다.
4. 기존 설치 위치를 유지하고 실행 후 기존 숙소/동/장비 설정과 화면을 확인한다.
   새 등록 화면이 예상치 않게 나타나면 재등록·설정 초기화를 하지 말고 중단해 확인한다.
5. 서버의 새 버전 응답과 실제 화면을 확인한다. 이후 정상적인 더 높은 버전의 원격 업데이트 및
   거래 중 보류·재부팅·설정 유지까지 현장에서 검증한 후 확대한다.

1.3.1은 덮어쓰거나 삭제하지 않으며 신규 설치·복구용으로 권장하지 않는다.

아래 1.3.0 결과는 당시 패키지의 이력이며 이후 QA 수정본이 현장에 설치됐다는 뜻이 아니다.
소스 커밋과 별도로 새 버전의 두 아키텍처 설치파일 및 현장 검증이 필요하다.

1.3.0 개발 PC 검증 (2026-09-09, Windows 11 x64): 업데이트/아키텍처 테스트 24개와 예약/A·B동 회귀 테스트 25개 통과.
production 빌드 및 ia32/x64 NSIS 생성, 각 패키지의 PE 비트수·통신 모듈 로딩·장비 import·로컬 웹서버 응답 검사 통과.
ia32 실행 검사는 64비트 Windows의 32비트 실행 환경에서 수행했다. Windows 10 LTSB 32비트 실기기 검증을 대신하지 않는다.
이 검증에서 설치파일 게시, 실제 NSIS 설치, 장비 업데이트 요청, 결제/인쇄, 운영 DB 변경은 수행하지 않았다.

```powershell
npm.cmd run test:updates
node --experimental-strip-types --test tests/reservation-check-in.test.mts tests/reservation-schedule.test.mts tests/kiosk-sales-config.test.mts tests/kiosk-building-scope.test.mts
npm.cmd run electron:build
npm.cmd run electron:build:ia32
# 명시적 live QA: 전용 프로젝트에 임시 qa-* 데이터/계정을 만들고 검사 후 제거한다.
node scripts/test-update-cloud.cjs --run-live
node scripts/test-update-cloud.cjs --run-live --release-version 1.2.0
```

live QA도 설치파일을 실행하거나 장비/예약 데이터를 사용하지 않는다.
등록/인증/타 장비 접근 차단/만료/취소/파일 검증과 실제 NSIS 업데이트는 별도 검증이다.
현장 한 대에서 두 버전 간 설치, 결제/체크인/인쇄 중 보류, 재부팅, 설정 유지와 영수증을 검증한 후 확대한다.
