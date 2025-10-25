# 서브도메인 기반 Property 설정 가이드

## 개요

Property3, 4는 웹 브라우저(Chrome/Edge)에서 실행되며, 서브도메인을 통해 자동으로 Property를 감지합니다.

## 서브도메인 매핑

### Property 1 (C, D동)
- `property1.yourdomain.com`
- `p1.yourdomain.com`
- `c.yourdomain.com`
- `d.yourdomain.com`
- `cd.yourdomain.com`

### Property 2 (Kariv)
- `property2.yourdomain.com`
- `p2.yourdomain.com`
- `kariv.yourdomain.com`

### Property 3 (A, B동)
- `property3.yourdomain.com`
- `p3.yourdomain.com`
- `a.yourdomain.com`
- `b.yourdomain.com`
- `ab.yourdomain.com`
- `a3.yourdomain.com`
- `b3.yourdomain.com`

### Property 4 (Camp)
- `property4.yourdomain.com`
- `p4.yourdomain.com`
- `camp.yourdomain.com`

## Vercel 배포 설정

### 1. 도메인 추가

Vercel 프로젝트 설정에서 각 서브도메인을 추가합니다:

\`\`\`
Settings → Domains → Add Domain
\`\`\`

예시:
- `property3.yourdomain.com`
- `property4.yourdomain.com`
- `camp.yourdomain.com`

### 2. DNS 설정

도메인 제공업체(예: Cloudflare, GoDaddy)에서 CNAME 레코드를 추가합니다:

| Type | Name | Value |
|------|------|-------|
| CNAME | property3 | cname.vercel-dns.com |
| CNAME | property4 | cname.vercel-dns.com |
| CNAME | camp | cname.vercel-dns.com |
| CNAME | a3 | cname.vercel-dns.com |
| CNAME | b3 | cname.vercel-dns.com |

### 3. 환경변수 (선택사항)

서브도메인을 사용하면 환경변수 설정이 **필요 없습니다**.

하지만 로컬 개발 시에는 환경변수를 사용할 수 있습니다:

\`\`\`env
# .env.local
NEXT_PUBLIC_KIOSK_PROPERTY_ID=property3
\`\`\`

## 로컬 개발 환경

### hosts 파일 수정

로컬에서 서브도메인을 테스트하려면 hosts 파일을 수정합니다:

**Windows**: `C:\Windows\System32\drivers\etc\hosts`
**Mac/Linux**: `/etc/hosts`

\`\`\`
127.0.0.1 property3.localhost
127.0.0.1 property4.localhost
127.0.0.1 camp.localhost
127.0.0.1 a3.localhost
\`\`\`

### 개발 서버 실행

\`\`\`bash
npm run dev
\`\`\`

접속:
- `http://property3.localhost:3000`
- `http://property4.localhost:3000`
- `http://camp.localhost:3000`

## 우선순위

Property 감지 우선순위:

1. **서브도메인** (최우선)
2. `NEXT_PUBLIC_KIOSK_PROPERTY_ID` 환경변수
3. 기본값 (`property3`)

## Property3, 4 웹앱 접속 방법

### 프로덕션 환경

1. **서브도메인으로 접속**
   \`\`\`
   https://property3.yourdomain.com
   https://camp.yourdomain.com
   \`\`\`

2. **Chrome/Edge에서 전체화면 모드**
   - F11 키 또는
   - 브라우저 설정 → "전체화면"

3. **키오스크 모드로 실행 (권장)**
   \`\`\`bash
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://property3.yourdomain.com

   # Mac
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --kiosk --app=https://property3.yourdomain.com
   \`\`\`

### 개발 환경

1. **환경변수 설정**
   \`\`\`env
   NEXT_PUBLIC_KIOSK_PROPERTY_ID=property3
   \`\`\`

2. **또는 hosts 파일 + 서브도메인 사용**
   \`\`\`
   http://property3.localhost:3000
   \`\`\`

## Web Serial Port 권한

Property3, 4는 프린터를 사용하므로 Web Serial Port 권한이 필요합니다:

1. **HTTPS 필수** (프로덕션)
   - `https://property3.yourdomain.com` ✅
   - `http://property3.yourdomain.com` ❌

2. **localhost는 HTTP 허용** (개발)
   - `http://localhost:3000` ✅
   - `http://property3.localhost:3000` ✅

3. **첫 실행 시 프린터 포트 선택**
   - 브라우저가 시리얼 포트 접근 권한 요청
   - 프린터 포트 선택 (예: COM3)
   - 선택한 포트는 브라우저에 저장됨

## 트러블슈팅

### 서브도메인이 감지되지 않음

1. DNS 전파 확인 (최대 48시간 소요)
   \`\`\`bash
   nslookup property3.yourdomain.com
   \`\`\`

2. 브라우저 캐시 삭제

3. 콘솔에서 Property 확인
   \`\`\`javascript
   // 브라우저 콘솔에서
   console.log(window.location.hostname)
   \`\`\`

### Web Serial Port가 작동하지 않음

1. HTTPS 사용 확인
2. Chrome/Edge 최신 버전 사용
3. 브라우저 권한 설정 확인

### 프린터가 연결되지 않음

1. 프린터 전원 확인
2. USB 케이블 연결 확인
3. 시리얼 포트 드라이버 설치 확인
4. 브라우저에서 시리얼 포트 권한 재설정

## 배포 체크리스트

- [ ] Vercel에 서브도메인 추가
- [ ] DNS CNAME 레코드 설정
- [ ] HTTPS 인증서 확인 (Vercel 자동 발급)
- [ ] 각 서브도메인에서 접속 테스트
- [ ] Web Serial Port 권한 테스트
- [ ] 프린터 연결 테스트
- [ ] 전체화면/키오스크 모드 테스트
