// 음성 파일 URL 정의
const AUDIO_FILES = {
  RESERVATION_PROMPT:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/reservation-name-prompt-zcaqHjGBPyJZKNZgnVApwZ7cukEdsl.mp3",
  RESERVATION_FOUND:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/reservation-found-oTy6pTQIOIfKoNpx2wV1OqyYQJF2du.mp3",
  RESERVATION_NOT_FOUND:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/reservation-not-found-J8rDxth77zZYtrjy4l48njNLsKby6F.mp3",
  // 건물별 안내 음성 추가
  BUILDING_A_GUIDE:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/ABuilding%20Guide-AJMNdkfrBlHQLsxTDV3VupIqSlwBQu.mp3",
  BUILDING_B_GUIDE:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/BBuilding%20Guide-s0cl1NrNbJshr89OuAVo4ZPRTaQKGA.mp3",
  BUILDING_C_GUIDE:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/CBuilding%20Guide-aLyl8nvSxR4nNxBHZ7PTRQVsBtjYJl.mp3",
  BUILDING_D_GUIDE:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/DBuilding%20Guide-i4zaRn19m3BbOUWUQLUgF1k9EhcQAq.mp3",
  BUILDING_CAMP_GUIDE:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/CampBuilding%20Guide-gvNhIVPE0CyFXD9mfRCq81J5ENz0bu.mp3",
  // BGM 추가
  BGM: "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/BGM-KxDaQotYetSNviIMu8k9fN0pnce4X3.mp3",
}

// 오디오 객체 캐시
const audioCache: { [key: string]: HTMLAudioElement } = {}

// BGM 관련 변수
let bgmPlaying = false
let bgmAudio: HTMLAudioElement | null = null

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
    }

    // 오디오 재생
    const audio = audioCache[audioKey]
    audio.currentTime = 0 // 처음부터 재생

    // 볼륨 설정 (0.0 ~ 1.0)
    audio.volume = 0.8

    // ���생 시작
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
      console.warn(`알 수 없는 건물 타입: ${buildingType}`)
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
