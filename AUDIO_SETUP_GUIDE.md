# 오디오 파일 설정 가이드

## 📁 필요한 오디오 파일 목록

다음 오디오 파일들을 `/public/audio/` 폴더에 복사해주세요:

### 필수 음성 안내 파일
1. **reservation-prompt.mp3** - 예약자명 입력 안내
2. **reservation-found.mp3** - 예약 확인됨 안내
3. **reservation-not-found.mp3** - 예약 없음 안내
4. **multiple-reservations.mp3** - 여러 예약 발견 안내

### 건물별 안내 음성
5. **building-a-guide.mp3** - A동 위치 안내
6. **building-b-guide.mp3** - B동 위치 안내
7. **building-c-guide.mp3** - C동 위치 안내
8. **building-d-guide.mp3** - D동 위치 안내
9. **building-camp-guide.mp3** - 캠프동 위치 안내

### 배경음악 및 환영 멘트
10. **idle-welcome.mp3** - 대기화면 환영 멘트
11. **bgm.mp3** - 배경음악 (루프 재생)

## 📂 폴더 구조

\`\`\`
public/
└── audio/
    ├── reservation-prompt.mp3
    ├── reservation-found.mp3
    ├── reservation-not-found.mp3
    ├── multiple-reservations.mp3
    ├── building-a-guide.mp3
    ├── building-b-guide.mp3
    ├── building-c-guide.mp3
    ├── building-d-guide.mp3
    ├── building-camp-guide.mp3
    ├── idle-welcome.mp3
    └── bgm.mp3
\`\`\`

## 🔧 설정 방법

### 1. 오디오 파일 복사
로컬에 있는 오디오 파일들을 프로젝트의 `/public/audio/` 폴더에 복사합니다.

\`\`\`bash
# Windows
xcopy "C:\your-audio-files\*.mp3" "public\audio\" /Y

# Mac/Linux
cp /path/to/your-audio-files/*.mp3 public/audio/
\`\`\`

### 2. 파일명 확인
복사한 파일명이 위의 목록과 정확히 일치하는지 확인하세요. 파일명이 다르면 오디오가 재생되지 않습니다.

### 3. 파일 형식
- **권장 형식**: MP3 (가장 호환성이 좋음)
- **지원 형식**: MP3, WAV, M4A (HTML5 Audio API 지원 형식)
- **권장 비트레이트**: 128kbps ~ 192kbps
- **권장 샘플레이트**: 44.1kHz

### 4. 파일 크기
- 음성 안내: 1~3MB 권장
- BGM: 5MB 이하 권장
- 너무 큰 파일은 로딩 시간이 길어질 수 있습니다

## 🎵 오디오 재생 시점

### 자동 재생
- **대기 화면 진입 시**: `idle-welcome.mp3` → `bgm.mp3` (루프)
- **예약 확인 화면**: `reservation-prompt.mp3`
- **예약 발견**: `reservation-found.mp3`
- **예약 없음**: `reservation-not-found.mp3`
- **여러 예약 발견**: `multiple-reservations.mp3`
- **체크인 완료**: 건물별 안내 음성 (A/B/C/D/CAMP)

### 볼륨 설정
- **음성 안내**: 80% (0.8)
- **배경음악**: 30% (0.3)

## 🔍 문제 해결

### 오디오가 재생되지 않을 때

1. **파일 경로 확인**
   - 브라우저 개발자 도구 (F12) → Console 탭에서 오류 확인
   - `404 Not Found` 오류가 있다면 파일명이나 경로가 잘못됨

2. **파일명 확인**
   \`\`\`bash
   # Windows
   dir public\audio

   # Mac/Linux
   ls -la public/audio
   \`\`\`

3. **파일 형식 확인**
   - MP3 파일이 손상되지 않았는지 확인
   - 다른 미디어 플레이어에서 재생되는지 테스트

4. **브라우저 권한 확인**
   - 일부 브라우저는 자동 재생을 차단할 수 있음
   - 사용자 인터랙션 후 재생되는지 확인

5. **캐시 삭제**
   \`\`\`bash
   # Next.js 캐시 삭제
   npm run clean
   rm -rf .next
   npm run build
   \`\`\`

## 🎤 오디오 파일 제작 가이드

### TTS (Text-to-Speech) 서비스 추천
- **ElevenLabs**: 고품질 한국어 음성 생성
- **Google Cloud TTS**: 다양한 한국어 음성 지원
- **Naver Clova Voice**: 자연스러운 한국어 음성

### 녹음 가이드
1. **조용한 환경**에서 녹음
2. **명확한 발음**으로 천천히 읽기
3. **적절한 볼륨** 유지 (너무 크거나 작지 않게)
4. **배경 소음 제거** (Audacity 등 사용)

### 편집 도구
- **Audacity** (무료): 기본적인 편집 및 노이즈 제거
- **Adobe Audition**: 전문적인 오디오 편집
- **Online Audio Converter**: 형식 변환

## 📝 커스터마이징

### 새로운 오디오 추가하기

1. **오디오 파일 추가**
   \`\`\`
   public/audio/custom-audio.mp3
   \`\`\`

2. **lib/audio-utils.ts 수정**
   \`\`\`typescript
   const AUDIO_FILES = {
     CUSTOM_AUDIO: "/audio/custom-audio.mp3",
   }
   \`\`\`

3. **컴포넌트에서 사용**
   \`\`\`typescript
   import { playAudio } from "@/lib/audio-utils"
   
   playAudio("CUSTOM_AUDIO")
   \`\`\`

## ✅ 체크리스트

설정 완료 후 다음 항목들을 확인하세요:

- [ ] `/public/audio/` 폴더가 존재함
- [ ] 11개의 오디오 파일이 모두 복사됨
- [ ] 파일명이 정확히 일치함
- [ ] 파일 형식이 MP3임
- [ ] 브라우저 콘솔에 오류가 없음
- [ ] 대기 화면에서 환영 멘트가 재생됨
- [ ] BGM이 루프로 재생됨
- [ ] 예약 확인 시 음성 안내가 재생됨
- [ ] 체크인 완료 시 건물 안내가 재생됨

## 🚀 배포 시 주의사항

### Vercel 배포
- `/public/` 폴더의 모든 파일은 자동으로 배포됨
- 오디오 파일이 Git에 커밋되어 있는지 확인
- `.gitignore`에 `public/audio/`가 포함되지 않았는지 확인

### Git 커밋
\`\`\`bash
git add public/audio/*.mp3
git commit -m "Add audio files for kiosk"
git push
\`\`\`

### 파일 크기 제한
- Vercel 무료 플랜: 100MB 제한
- 오디오 파일 총 크기가 제한을 초과하지 않도록 주의

## 📞 지원

오디오 설정에 문제가 있다면:
1. 브라우저 콘솔 (F12) 확인
2. `lib/audio-utils.ts` 파일 확인
3. 파일 경로 및 파일명 재확인
