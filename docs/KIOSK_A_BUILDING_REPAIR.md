# property3 A동 설정 복구파일

설치형 키오스크 **1.3.2**에서 `KIOSK_BUILDING` 누락으로 시작 화면이 막힌 **property3 A동 PC**용이다.
소스 실행형 `.env.local` 편집기, 재등록, 앱 설치/업데이트, B동 전환 도구가 아니다.

## 현장 사용

1. 해당 PC가 A동이며 진행 중이거나 미확정인 결제·입실·환불·인쇄가 없는지 확인한다.
2. 평소 키오스크를 실행하는 Windows 계정에서 키오스크를 정상 종료한다. 제거하거나 사용자 데이터를 삭제하지 않는다.
3. `Property3-A-Repair-v2-x64.exe`(64비트 Windows) 또는 `Property3-A-Repair-v2-x86.exe`(32비트 Windows)를 실행한다.
   자동 검색이 안 되거나 설치본이 여러 개이면 파일 선택창이 열린다. **바탕화면의 기존 TheBeachStay Kiosk 바로가기**를 선택한다.
   또는 실제 설치 폴더의 `TheBeachStay Kiosk.exe`를 선택한다. `installer.exe`나 복구파일을 선택하지 않는다.
   취소하면 설정을 읽거나 변경하지 않고 종료한다. 창 제목에 `v2`가 없으면 이전 복구파일이다.
4. 표시된 장비 ID와 A동 여부를 확인하고 `예`를 누른다. 다른 계정으로 관리자 실행하지 않는다.
5. 완료 후 기존 키오스크를 실행해 오류가 사라지고 **A동 객실만 표시되는지** 확인한다.
   여전히 오류가 있으면 화면을 전달한다. 이 도구가 다른 누락된 인증/장비 설정까지 복원하지는 않는다.

키오스크 실행 중, 기존 B동 설정, 다른 숙소, 등록/인증 없음, 다른 버전, 복호화 실패, 동시 파일 변경은 중단한다.
자동 종료·재시작·재부팅·서비스 요청·원격 업데이트 요청은 하지 않는다. Windows 보안 차단을 자동 우회하지 않는다.
실행 파일은 Windows Authenticode 서명되지 않았다. 신뢰한 전달 경로와 SHA-256을 확인한다.

## 보존 범위와 백업

`%APPDATA%\thebeachstay-kiosk\kiosk-device.bin`의 기존 설정 중 `env.KIOSK_BUILDING`만 `A`로 설정한다.
장비 ID, 등록 상태, Firebase UID/갱신 토큰, 프린터, 결제 및 알 수 없는 기존 필드도 보존한다.
이미 정확히 A이면 파일 변경/추가 백업 없이 종료한다. B(공백/소문자 포함)는 A로 덮어쓰지 않는다.

같은 설정 폴더의 새 `A-repair-backup-*` 폴더에 원본 `kiosk-device.bin`과 `Local State`를 **암호화 상태 그대로** 보관한다.
두 파일의 백업 바이트 검증과 임시 파일 flush 후 원자적 이름 변경으로 교체한다. `Local State` 원본은 수정하지 않는다.
백업은 기존 Windows 계정/PC에 보관하며 다른 PC에 복제하거나 채팅에 올리지 않는다.
복원은 키오스크를 종료한 뒤 관리자 확인 하에 원본 암호화 설정을 되돌린다. 앱 사용 후에는 과거 인증 토큰이 갱신되었을 수 있으므로 무조건 복원하지 않는다.

현재 설치 앱은 복구 도구와 잠금을 공유하지 않는다. 실행 프로세스 및 파일 변경 검사를 하지만 현장에서 복구 중 키오스크를 다시 실행해서는 안 된다.

## 구현과 재현 검사

새 의존성 없이 Windows .NET Framework와 **설치된 Electron 28.3.3의 Node 모드**를 사용한다.
키오스크 bootstrap/웹서버/장비/네트워크는 실행하지 않는다. 암호화 키는 명령줄·파일·로그가 아닌 자식 프로세스 stdin으로만 전달한다.
설치 위치는 현재 사용자 NSIS 등록 및 표준 설치 경로에서 찾고 앱 이름/버전/main과 실행파일 제품 정보를 검사한다.
v2는 레지스트리의 InstallLocation/DisplayIcon/UninstallString을 확인하고 같은 경로의 대소문자·구분자·상대 요소를 중복 제거한다.
검색 실패/복수 설치는 Windows 기본 파일 선택창으로 이어진다. 유효하지 않은 프로그램은 실행하지 않는다.
프로필 경로는 앱 package.json의 `name=thebeachstay-kiosk` 및 기존 `app.getPath('userData')`에 따른다.

암호화 형식 근거: [Electron 28.3.3 safeStorage](https://github.com/electron/electron/blob/v28.3.3/shell/browser/api/electron_api_safe_storage.cc),
[Chromium 120 Windows OSCrypt](https://github.com/chromium/chromium/blob/120.0.6099.291/components/os_crypt/sync/os_crypt_win.cc).
프로필 `Local State`의 DPAPI 키를 동일 Windows 사용자로 해제하고, Node 기본 AES-256-GCM으로 v10 데이터를 읽고 쓴다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-kiosk-repair.ps1
node --test tests/kiosk-repair.test.cjs
# 두 비트수의 기존 1.3.2 패키지가 준비된 경로 지정
pwsh.exe -NoProfile -File scripts/test-kiosk-repair.ps1 -PackageRoot .local/release-1.3.2/dist
npm.cmd run build
```

v2 출력은 `.local/property3-a-repair-v2/`에 생성되며 이전 복구파일을 덮어쓰지 않는다. EXE·테스트 프로필·로그는 Git에 커밋하지 않는다.
개발 PC의 검증 스크립트는 PowerShell 7에서 실행한다. 현장 복구 EXE에는 PowerShell 7이나 개발 도구가 필요하지 않다.
합성 데이터만 사용해 Electron safeStorage → .NET DPAPI + 설치 패키지 Node 복구 → Electron safeStorage 재읽기를 검사한다.
32비트 검사는 개발 PC의 Windows 11 x64/WOW64에서 수행하며 Windows 10 LTSB 32비트 실기기 검증을 대신하지 않는다.
현장 PC에서의 실행/객실 목록 확인 전에는 현장 복구 완료로 보고하지 않는다.
v2의 경로 미검색/중복/복수 설치/취소/잘못된 실행파일 검사 및 두 비트수 암호화 복구 검사는 통과했다.
개발 PC UI 검사에서는 파일 선택창이 표시되는 것을 확인하지 못했으므로, 바로가기 선택의 실제 UI 동작은 현장 확인이 필요하다.
이 유틸리티를 키오스크 `installer.exe`로 게시하거나 업데이트 DB에 등록하지 않는다.
