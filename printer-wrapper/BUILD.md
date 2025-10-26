# BIXOLON 프린터 래퍼 빌드 가이드

## 필요 사항
- .NET 6.0 SDK 이상
- BXLPApi_X64.dll

## 빌드 방법

1. .NET SDK 설치 확인:
\`\`\`bash
dotnet --version
\`\`\`

2. 프로젝트 빌드:
\`\`\`bash
cd printer-wrapper
dotnet publish -c Release
\`\`\`

3. 빌드된 파일 위치:
\`\`\`
printer-wrapper/bin/Release/net6.0/win-x64/publish/BixolonPrinterWrapper.exe
\`\`\`

4. 실행 파일을 프로젝트 루트의 `bin` 폴더로 복사:
\`\`\`bash
copy bin\Release\net6.0\win-x64\publish\BixolonPrinterWrapper.exe ..\bin\
\`\`\`

5. `BXLPApi_X64.dll`도 같은 `bin` 폴더에 복사

## 사용 예시

\`\`\`bash
# 프린터 연결
BixolonPrinterWrapper.exe connect COM2 9600

# 텍스트 인쇄
BixolonPrinterWrapper.exe print "Hello World"

# 줄 바꿈
BixolonPrinterWrapper.exe linefeed 3

# 용지 절단
BixolonPrinterWrapper.exe cut

# 상태 확인
BixolonPrinterWrapper.exe status

# 연결 해제
BixolonPrinterWrapper.exe disconnect
