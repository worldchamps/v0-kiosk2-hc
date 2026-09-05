# 설치형 키오스크 / Codex 배포

키오스크에는 Codex, Git, Node.js, Python 개발환경이 필요하지 않다.
Electron/Next.js와 Python 장비 제어 EXE를 설치파일에 포함한다.
제조사 프린터/USB/결제단말기 드라이버는 해당 PC에 별도 설치되어 있어야 한다.
로컬 객실관리 PC 및 PMS 화면/서버 코드는 변경하지 않는다.

## 안전 경계

- 빌드/업로드와 장비 업데이트 요청은 별도 명령이다. Git push로 현장 업데이트하지 않는다.
- 명시한 단일 장비 ID만 대상. 숙소 전체를 암묵적으로 선택하지 않는다.
- 장비 등록 코드는 1시간, 업데이트 요청은 24시간 유효하다.
- 전용 비공개 Google Cloud Storage 버킷과 별도 HTTPS 서버(Cloud Run)를 사용한다.
  기존 Firebase 프로젝트 안에 만들되 예약 RTDB/객실관리 명령과 공유하지 않는다.
- 서버에는 배포 명령 API가 없다. 배포 PC의 Cloud IAM 권한으로 요청을 등록한다.
- 장비는 등록 토큰으로 자기 요청/파일만 읽는다. 클라이언트에 서비스 계정 키를 배포하지 않는다.
- 공개키가 설치파일에 고정된다. Ed25519 서명된 요청과 버전/파일 SHA-512를 확인한다.
  업데이트 서버 침해만으로 다른 설치파일을 승인할 수 없다. 개인키는 배포 PC에만 보관한다.
- NSIS 자동 quit 업데이트는 끈다. 대기 화면, 최근 상태 보고, 60초 무입력,
  결제/체크인/인쇄 IPC 및 HTTP 작업 종료, 점검 화면 응답을 확인한 뒤 설치한다.
  다운로드 후 취소/기한 만료도 다시 확인한다. 새 요청이 없으면 업데이트하지 않는다.
- 설치 시도 상태를 디스크에 기록하고 새 버전 UI가 시작된 뒤 완료 보고한다.
  실패한 요청은 반복 설치하지 않는다. **설치 중 전원 차단에 대한 원자적 롤백은 없다.**
  복구는 이전 정상 코드를 더 높은 버전으로 재배포하거나 현장 재설치한다.
- Windows Authenticode 인증서가 없으면 최초 설치에 SmartScreen 경고가 있을 수 있다.
  Ed25519 배포 검증과 Windows 실행파일 코드 서명은 서로 다른 목적이다.
- 앱을 완전히 종료하거나 PC가 꺼지면 수신하지 않는다. Windows 로그인 시 자동 실행한다.
  별도 상주 Windows 서비스, 원격 전원 켜기, 강제 업데이트는 포함하지 않는다.

## 최초 개발 PC 준비

PowerShell, 저장소 루트에서:

```powershell
npm.cmd ci
python -m venv .local/build-python
.local/build-python/Scripts/python.exe -m pip install -r hardware_server/requirements-build.txt
node scripts/kiosk-deploy.cjs keygen --out .local/update-signing
$env:KIOSK_UPDATE_PUBLIC_KEY_FILE = (Resolve-Path .local/update-signing/public.pem).Path
npm.cmd run electron:build
```

개인키는 재생성하지 말고 접근 제한된 위치에 백업한다. 공개키 교체는 기존 키로
신뢰 변경을 배포하는 별도 마이그레이션이 필요하다. 키/등록파일/설정은 Git에 넣지 않는다.
빌드 버전은 package.json/package-lock.json을 함께 올린다. 같은 버전 덮어쓰기 금지.
설치파일은 dist에 생성된다. 빌드는 업로드/배포하지 않는다.

## Cloud 준비 (별도 운영 승인 및 인증 필요)

1. 기존 Firebase 프로젝트 ID와 결제 계정/요금제를 확인한다. 자동 결제 전환 금지.
2. 업데이트 전용 버킷을 생성한다. Uniform bucket-level access와 Public access prevention을
   켜고 공개/익명 권한을 주지 않는다. 기존 예약 버킷/DB 규칙을 변경하지 않는다.
3. 업데이트 서버 전용 서비스 계정에는 이 버킷의 Object User 권한만 준다.
   배포 작업자에게는 같은 버킷의 객체 관리 권한과 필요한 빌드/서비스 배포 권한을 준다.
4. Dockerfile: ops/update-server/Dockerfile. 저장소 루트를 빌드 문맥으로 사용한다.
   Cloud Run 환경변수는 KIOSK_UPDATE_BUCKET 및 KIOSK_UPDATE_PUBLIC_KEY(PEM 공개키).
   HTTPS, timeout 3600초, 최소 인스턴스 0으로 시작한다.
5. Cloud Run은 장비 토큰을 앱에서 검증하므로 HTTPS 엔드포인트 접근은 허용하되
   비공개 버킷은 절대 공개하지 않는다. 등록 코드는 128비트 무작위 값이다.
6. 배포 PC에는 Application Default Credentials를 구성한다. 서비스 계정 JSON 대신
   가능한 경우 사용자 로그인/서비스 계정 impersonation을 사용한다.

서버 업로드 전 문맥에 비밀정보가 포함되지 않도록 .gcloudignore/.dockerignore를 확인한다.
Google Cloud 인증/프로젝트 선택/요금 승인이 없으면 서버를 임의로 만들지 않는다.

## 장비 등록 및 설정 이전

```powershell
$env:KIOSK_UPDATE_BUCKET = "승인된-비공개-버킷"
node scripts/kiosk-deploy.cjs register --device property3-kiosk-01 --property property3 --server https://승인된-서버주소 --out .local/property3-registration.json
```

키오스크에서 기존 BAT 프로그램을 정상 종료한 뒤 설치파일을 실행한다.
최초 등록 화면에서 해당 등록 JSON 및 **그 PC의** 기존 .env.local을 선택한다.
등록 파일은 1시간 이내에 사용한다. 인터넷 장애 시 동일 파일/토큰으로 재시도한다.
등록 전에 기한이 끝났다면 같은 장비 ID로 register 명령을 새 출력 파일에 재발급하고
등록 화면의 '새 등록 파일로 다시 시작'을 사용한다. 이전 코드는 무효화된다.
이미 서버 등록을 마친 장비의 인증은 재발급으로 덮어쓰지 않는다.
기존 파일을 삭제하지 않고, 설정을 Windows safeStorage로 암호화해 앱 사용자 데이터에 저장한다.
설정 안의 숙소 ID와 등록 숙소가 다르면 거부한다.
기존 예약/결제 API가 사용하는 Google/Firebase 인증정보는 아직 이 로컬 설정에 필요하다.
이를 장비 최소 권한 API로 완전히 전환하는 작업은 별도이며 **공용 설치파일에 넣지 않는다.**
등록/설정 파일을 공유 폴더에 방치하지 않는다. 다른 Windows 계정으로 복사하면 복호화할 수 없다.

## Codex에서 실행할 배포

```powershell
node scripts/kiosk-deploy.cjs publish --file "dist/TheBeachStay Kiosk Setup 1.2.0.exe" --version 1.2.0 --key .local/update-signing/private.pem
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs request --device property3-kiosk-01 --version 1.2.0 --from-version 1.1.0 --key .local/update-signing/private.pem
node scripts/kiosk-deploy.cjs status --device property3-kiosk-01
node scripts/kiosk-deploy.cjs cancel --device property3-kiosk-01
```

publish는 검증한 NSIS 설치파일만 업로드한다. version 인자는 실제 EXE 버전과 같아야 한다.
request는 운영자의 명시적 대상/버전 승인 후에만 실행한다.
status는 마지막 보고가 90초 이내일 때 online을 표시하며 전원이 켜져 있다는 보장은 아니다.
revoke --device ID는 분실/폐기 장비의 연결을 차단한다.
실패/기한 만료 시 원인을 확인한 후 새 요청을 만든다.
설치가 시작된 뒤에는 cancel로 중단/되돌릴 수 없다.

## 검증

```powershell
npm.cmd run test:updates
node --experimental-strip-types --test tests/reservation-check-in.test.mts tests/reservation-schedule.test.mts tests/kiosk-sales-config.test.mts
npm.cmd run build
```

서버 테스트는 인메모리 저장소, 가짜 설치파일, 임시 localhost만 사용한다.
실제 장비/Cloud 배포 전에는 테스트 키오스크에서 등록, 2개 버전 간 NSIS 업데이트,
취소/오프라인/결제/체크인/인쇄 중 보류, 재부팅, 설정 유지, 실제 영수증을 확인해야 한다.
그 검증 없이 전체 키오스크 배포 완료라고 보고하지 않는다.
