# Web Serial Port 프린터 설정 가이드 (Property3, 4)

## 개요

Property3와 Property4는 Electron 없이 웹 브라우저(Chrome/Edge)에서 직접 실행되며, Web Serial Port API를 사용하여 프린터와 통신합니다.

## 브라우저 요구사항

### 지원 브라우저
- Google Chrome 89 이상
- Microsoft Edge 89 이상
- Opera 75 이상

### 필수 조건
- HTTPS 연결 또는 localhost
- Web Serial Port API 활성화 (기본적으로 활성화됨)

## 프린터 연결 방법

### 1. 초기 설정

Property3 또는 Property4 키오스크를 처음 실행하면:

1. 체크인 완료 후 자동으로 프린터 연결 시도
2. 브라우저에서 시리얼 포트 선택 팝업 표시
3. 프린터가 연결된 COM 포트 선택 (예: COM2)
4. "연결" 버튼 클릭

### 2. 자동 재연결

한 번 연결한 후에는:
- 브라우저가 포트 정보를 기억
- 다음 실행 시 자동으로 재연결
- 사용자 개입 불필요

### 3. 수동 연결

관리자 페이지에서 수동으로 프린터 연결 가능:
1. 관리자 모드 진입
2. "프린터 테스트" 메뉴
3. "프린터 연결" 버튼 클릭

## 프린터 설정

### 지원 프린터
- BK3-3 열전사 프린터
- SAM4S ELLIX/GIANT
- 기타 ESC/POS 호환 프린터

### 시리얼 포트 설정
\`\`\`
Baud Rate: 115200
Data Bits: 8
Stop Bits: 1
Parity: None
Flow Control: Hardware
\`\`\`

### 환경 변수
\`\`\`env
# Simple Mode 활성화 (선택사항)
PRINTER_SIMPLE_MODE=true

# BK3-3 프린터 강제 Simple Mode (선택사항)
FORCE_SIMPLE_FOR_BK3=true
\`\`\`

## 문제 해결

### 프린터가 연결되지 않을 때

1. **브라우저 권한 확인**
   - Chrome 설정 → 개인정보 및 보안 → 사이트 설정 → 시리얼 포트
   - 해당 사이트에 시리얼 포트 권한 부여 확인

2. **COM 포트 확인**
   - Windows 장치 관리자에서 프린터 COM 포트 확인
   - 다른 프로그램이 포트를 사용 중인지 확인

3. **브라우저 재시작**
   - 브라우저를 완전히 종료 후 재시작
   - 캐시 및 쿠키 삭제

4. **HTTPS 확인**
   - localhost가 아닌 경우 HTTPS 필수
   - 자체 서명 인증서도 가능

### 인쇄가 안 될 때

1. **프린터 상태 확인**
   - 전원 켜짐 확인
   - 용지 장착 확인
   - 에러 LED 확인

2. **Simple Mode 시도**
   - 관리자 페이지에서 Simple Mode 활성화
   - 일부 프린터는 Simple Mode에서만 작동

3. **테스트 인쇄**
   - 관리자 페이지에서 테스트 페이지 인쇄
   - 프린터 자체 테스트 버튼으로 하드웨어 확인

## Electron과의 차이점

| 기능 | Electron (Property1,2) | Web Browser (Property3,4) |
|------|----------------------|--------------------------|
| 프린터 연결 | 자동 (백그라운드) | 사용자 선택 필요 (최초 1회) |
| 포트 관리 | Node.js SerialPort | Web Serial Port API |
| 권한 | 앱 레벨 | 브라우저 레벨 |
| 재연결 | 자동 | 자동 (권한 유지 시) |
| 오프라인 | 가능 | HTTPS 필요 |

## 보안 고려사항

1. **권한 관리**
   - 사용자가 명시적으로 포트 선택
   - 브라우저가 권한 관리

2. **HTTPS 필수**
   - 프로덕션 환경에서는 HTTPS 필수
   - localhost는 예외

3. **포트 접근 제한**
   - 한 번에 하나의 탭만 포트 접근 가능
   - 다른 프로그램과 충돌 방지

## 참고 자료

- [Web Serial API 문서](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [Chrome Platform Status](https://chromestatus.com/feature/6577673212002304)
- [ESC/POS 명령어 참조](https://reference.epson-biz.com/modules/ref_escpos/)
