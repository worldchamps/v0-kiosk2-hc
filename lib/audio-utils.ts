// 음성 파일 URL 정의
const AUDIO_FILES = {
  RESERVATION_PROMPT: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/mZHweH32-TqyfNVT_a9Z6C/public/audio/reservation-prompt.mp3",
  RESERVATION_FOUND: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/KZ4LgKUHDIO8rZ845xzfor/public/audio/reservation-found.mp3",
  RESERVATION_NOT_FOUND: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/CLCXgY19xdzysGAprC0hKc/public/audio/reservation-not-found.mp3",
  MULTIPLE_RESERVATIONS: "/audio/multiple-reservations.mp3",
  BUILDING_A_GUIDE: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/LNrgY62XtffvLFvKevce1A/public/audio/building-a-guide.mp3",
  BUILDING_B_GUIDE: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/FHSsTLB9J7i_etpWSNfONg/public/audio/building-b-guide.mp3",
  BUILDING_C_GUIDE: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/a1MxnOhjSIdmxW17kXakxv/public/audio/building-c-guide.mp3",
  BUILDING_D_GUIDE: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/bJqLHSgZQOvgyGuw6xEcz2/public/audio/building-d-guide.mp3",
  BUILDING_CAMP_GUIDE: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/7x-Q7CDb_yuX0tut1Ibkh1/public/audio/building-camp-guide.mp3",
  IDLE_WELCOME: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/mNdMrZbzz-4gTjlwKQv-HA/public/audio/idle-welcome.mp3",
  BGM: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/git-blob/prj_ycpKc0d769SzX9dR9f94nLLIDhme/nDdjE6zkx427zPIWVDKHi8/public/audio/bgm.mp3",
}

// 오디오 객체 캐시
const audioCache: { [key: string]: HTMLAudioElement } = {}

// BGM 관련 변수
let bgmPlaying = false
let bgmAudio: HTMLAudioElement | null = null

let idleWelcomePlayed = false

/**
 * 음성 파일 재생 함수
 * @param audioKey 재생할 음성 파일 키
 */
export function playAudio(audioKey: keyof typeof AUDIO_FILES): void {
  try {
    // 이미 재생 중인 모든 오디오 중지 (BGM 제외)
    stopAllAudio(false)

    // 캐시에 없으면 새로 생성
    if (!audioCache[audioKey]) {
      audioCache[audioKey] = new Audio(AUDIO_FILES[audioKey])
      // 오디오 파일 로드 오류 핸들러 추가
      audioCache[audioKey].addEventListener("error", (e) => {
        console.error(`오디오 파일 로드 오류 (${audioKey}):`, AUDIO_FILES[audioKey], e)
      })
    }

    // 오디오 재생
    const audio = audioCache[audioKey]
    audio.currentTime = 0 // 처음부터 재생

    // 볼륨 설정 (0.0 ~ 1.0)
    audio.volume = 0.8

    // 재생 시작
    audio.play().catch((error) => {
      console.error(`오디오 재생 오류 (${audioKey}):`, error)
    })
  } catch (error) {
    console.error(`오디오 재생 중 오류 발생 (${audioKey}):`, error)
  }
}

/**
 * 건물 타입에 따른 안내 음성 재생 함수
 * @param buildingType 건물 타입 (A, B, C, D, CAMP)
 */
export function playBuildingGuide(buildingType: string): void {
  // 건물 타입에 따라 다른 음성 재생
  switch (buildingType.toUpperCase()) {
    case "A":
      playAudio("BUILDING_A_GUIDE")
      break
    case "B":
      playAudio("BUILDING_B_GUIDE")
      break
    case "C":
      playAudio("BUILDING_C_GUIDE")
      break
    case "D":
      playAudio("BUILDING_D_GUIDE")
      break
    case "CAMP":
      playAudio("BUILDING_CAMP_GUIDE")
      break
    default:
      console.error(`알 수 없는 건물 타입: ${buildingType}`)
      break
  }
}

/**
 * BGM 재생 시작 함수
 * @param volume 볼륨 (0.0 ~ 1.0)
 */
export function startBGM(volume = 0.3): void {
  try {
    // 이미 재생 중이면 중복 실행 방지
    if (bgmPlaying && bgmAudio) {
      return
    }

    // BGM 오디오 객체 생성 또는 가져오기
    if (!bgmAudio) {
      bgmAudio = new Audio(AUDIO_FILES.BGM)

      // 루프 설정
      bgmAudio.loop = true

      // 볼륨 설정
      bgmAudio.volume = volume

      // 오디오 끝났을 때 이벤트 처리 (루프 백업)
      bgmAudio.addEventListener("ended", () => {
        console.log("BGM ended, restarting...")
        if (bgmAudio) {
          bgmAudio.currentTime = 0
          bgmAudio.play().catch((err) => console.error("Error restarting BGM:", err))
        }
      })
    } else {
      // 기존 오디오 객체 재사용 시 볼륨 업데이트
      bgmAudio.volume = volume
    }

    // 재생 시작
    bgmAudio
      .play()
      .then(() => {
        console.log("BGM started successfully")
        bgmPlaying = true
      })
      .catch((error) => {
        console.error("BGM 재생 오류:", error)
        bgmPlaying = false
      })
  } catch (error) {
    console.error("BGM 시작 중 오류 발생:", error)
    bgmPlaying = false
  }
}

/**
 * BGM 일시 중지 함수
 */
export function pauseBGM(): void {
  try {
    if (bgmAudio && bgmPlaying) {
      bgmAudio.pause()
      bgmPlaying = false
      console.log("BGM paused")
    }
  } catch (error) {
    console.error("BGM 일시 중지 중 오류 발생:", error)
  }
}

/**
 * BGM 재개 함수
 */
export function resumeBGM(): void {
  try {
    if (bgmAudio && !bgmPlaying) {
      bgmAudio
        .play()
        .then(() => {
          bgmPlaying = true
          console.log("BGM resumed")
        })
        .catch((error) => {
          console.error("BGM 재개 오류:", error)
        })
    }
  } catch (error) {
    console.error("BGM 재개 중 오류 발생:", error)
  }
}

/**
 * BGM 중지 함수
 */
export function stopBGM(): void {
  try {
    if (bgmAudio) {
      bgmAudio.pause()
      bgmAudio.currentTime = 0
      bgmPlaying = false
      console.log("BGM stopped")
    }
  } catch (error) {
    console.error("BGM 중지 중 오류 발생:", error)
  }
}

/**
 * BGM 볼륨 설정 함수
 * @param volume 볼륨 (0.0 ~ 1.0)
 */
export function setBGMVolume(volume: number): void {
  try {
    if (bgmAudio) {
      bgmAudio.volume = Math.max(0, Math.min(1, volume))
      console.log(`BGM volume set to ${bgmAudio.volume}`)
    }
  } catch (error) {
    console.error("BGM 볼륨 설정 중 오류 발생:", error)
  }
}

/**
 * BGM 상태 확인 함수
 * @returns BGM 재생 중 여부
 */
export function isBGMPlaying(): boolean {
  return bgmPlaying
}

/**
 * 대기 화면 환영 음성 재생 함수 (최초 1회만)
 */
export function playIdleWelcome(): void {
  if (idleWelcomePlayed) {
    console.log("Idle welcome already played, skipping")
    return
  }

  try {
    // 캐시에 없으면 새로 생성
    if (!audioCache["IDLE_WELCOME"]) {
      audioCache["IDLE_WELCOME"] = new Audio(AUDIO_FILES.IDLE_WELCOME)
    }

    const audio = audioCache["IDLE_WELCOME"]
    audio.currentTime = 0
    audio.volume = 0.8

    // 재생 완료 후 BGM 시작
    audio.onended = () => {
      console.log("Idle welcome audio ended, starting BGM")
      startBGM(0.3)
    }

    audio
      .play()
      .then(() => {
        console.log("Idle welcome audio started")
        idleWelcomePlayed = true
      })
      .catch((error) => {
        console.error("Idle welcome audio playback error:", error)
        // 재생 실패 시 바로 BGM 시작
        startBGM(0.3)
      })
  } catch (error) {
    console.error("Error playing idle welcome audio:", error)
    // 오류 발생 시 바로 BGM 시작
    startBGM(0.3)
  }
}

/**
 * 대기 화면 환영 음성 재생 상태 초기화 (앱 재시작 시)
 */
export function resetIdleWelcome(): void {
  idleWelcomePlayed = false
  console.log("Idle welcome state reset")
}

/**
 * 모든 오디오 중지 함수
 * @param includeBGM BGM도 중지할지 여부 (기본값: true)
 */
export function stopAllAudio(includeBGM = true): void {
  // BGM 제외한 모든 오디오 중지
  Object.entries(audioCache).forEach(([key, audio]) => {
    try {
      if (key !== "BGM") {
        audio.pause()
        audio.currentTime = 0
      }
    } catch (error) {
      console.error(`오디오 중지 중 오류 발생 (${key}):`, error)
    }
  })

  // BGM 중지 여부에 따라 처리
  if (includeBGM) {
    stopBGM()
  }
}
