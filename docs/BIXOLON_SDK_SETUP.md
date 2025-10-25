# BIXOLON SDK 설치 가이드

## 필요한 파일

### 1. SDK 다운로드
BIXOLON 홈페이지(www.bixolon.com)에서 Windows POS SDK를 다운로드합니다.

### 2. 필수 파일 복사

프로젝트 루트에 `bin` 폴더를 생성하고 다음 파일을 복사:

\`\`\`
프로젝트/
├── bin/
│   └── BXLPApi.dll          # BIXOLON SDK DLL
├── electron/
│   ├── main.js
│   └── bixolon-printer.js   # 프린터 제어 모듈
\`\`\`

### 3. 의존성 설치

프로젝트에 이미 설치되어 있는 패키지:
- `ffi-napi` - DLL 함수 호출용
- `ref-napi` - C 타입 변환용

### 4. COM 포트 설정

`.env.local` 파일에 프린터 포트 설정:
\`\`\`
PRINTER_PATH=COM2
\`\`\`

## 사용 방법

### Electron main.js에서 초기화

\`\`\`javascript
const bixolonPrinter = require('./bixolon-printer');

// 앱 시작 시 프린터 연결
app.whenReady().then(() => {
  const printerPort = process.env.PRINTER_PATH || 'COM2';
  const connected = bixolonPrinter.connect(printerPort, 9600);
  
  if (connected) {
    console.log('[BIXOLON] Printer connected to', printerPort);
  } else {
    console.error('[BIXOLON] Failed to connect printer');
  }
});
\`\`\`

### 인쇄 예제

\`\`\`javascript
// 텍스트 인쇄
bixolonPrinter.printText('체크인 완료', 1, 0, 1); // 중앙 정렬, 큰 글씨
bixolonPrinter.lineFeed(2);
bixolonPrinter.printText('객실: 101호', 0, 0, 0);
bixolonPrinter.lineFeed(3);
bixolonPrinter.cutPaper();
\`\`\`

## 상수 값

### Alignment (정렬)
- 0: 왼쪽 정렬
- 1: 중앙 정렬
- 2: 오른쪽 정렬

### Attribute (속성)
- 0: 일반
- 1: 굵게
- 2: 밑줄
- 4: 반전

### TextSize (크기)
- 0: 일반 (1x1)
- 1: 2배 크기 (2x2)
- 16: 가로 2배
- 1: 세로 2배

## 문제 해결

### DLL을 찾을 수 없음
- `bin/BXLPApi.dll` 파일이 올바른 위치에 있는지 확인
- 32bit/64bit DLL 버전이 Node.js 버전과 일치하는지 확인

### 연결 실패
- COM 포트 번호가 올바른지 확인 (장치 관리자에서 확인)
- 다른 프로그램이 COM 포트를 사용 중인지 확인
- 프린터 전원이 켜져 있는지 확인
