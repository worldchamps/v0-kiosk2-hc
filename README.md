# AGAIN Kiosk

숙소별 예약 조회, 체크인, 현장예약, 결제, 영수증 인쇄와 PMS 연동을 처리하는
Windows Electron 키오스크입니다.

## 최신 기준 문서

설치, 환경변수, 실행, GitHub 업데이트, property별 장비 구성, SAM4S/Bixolon 프린터,
Toss Front 및 장애 대응은 [최신 통합 운영 가이드](docs/KIOSK_OPERATIONS_GUIDE.md)를 따릅니다.

기존 문서에 Vercel 자동 배포 또는 property4 Web Serial 방식이 적혀 있더라도 현재 운영에는
적용하지 않습니다. 현재 배포는 GitHub push 후 각 키오스크 PC에서 pull하는 방식이며,
property4 SAM4S는 Windows 프린터 드라이버로 출력합니다.

## 현재 배포 기준

- 저장소: `worldchamps/v0-kiosk2-hc`
- 운영 브랜치: `main`
- 개발 PC 기준 폴더: `C:\AGAIN_kiosk\v0-kiosk2-hc`
- 키오스크별 로컬 설정: `.env.local`

## 빠른 실행

최초 설치와 빌드:

```powershell
.\build_all.bat
```

일반 실행:

```powershell
.\run_kiosk_auto.bat
```

Git pull 후에는 기존 빌드가 남아 있어도 다시 빌드합니다.

```powershell
git pull --ff-only origin main
npm.cmd run build
.\run_kiosk_auto.bat
```

키오스크 PC에 추적 파일 변경이 있으면 pull 전에 원인을 확인하고 자동 reset하지 않습니다.

## 주요 문서

- [최신 통합 운영 가이드](docs/KIOSK_OPERATIONS_GUIDE.md)
- [Codex 작업 규칙](AGENTS.md)
- [Toss Front 플러그인 설명](toss-front-plugin/README.md)

그 밖의 `docs` 문서는 과거 구성 또는 기능별 참고 자료입니다. 내용이 충돌하면 최신 통합
운영 가이드를 우선합니다.

## 라이선스

Private - All rights reserved
