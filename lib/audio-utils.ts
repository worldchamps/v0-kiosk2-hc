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
  IDLE_WELCOME:
    "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/ElevenLabs_2025-10-11T06_11_56_JiYoung_pvc_sp103_s72_sb93_se0_b_m2-7MVHQLf0Vc79ckFUIUkJRHLdsBMe50.mp3",
  // BGM 추가
  BGM: "https://jdpd8txarrh2yidl.public.blob.vercel-storage.com/BGM-KxDaQotYetSNviIMu8k9fN0pnce4X3.mp3",
}

// 오디오 객체 캐시
const audioCache: { [key: string]: HTMLAudioElement } = {}

const audioPlayPromises: { [key: string]: Promise<void> | null } = {}

const audioReadyPromises: { [key: string]: Promise<void> } = {}

// 오디오 객체 생성 및 에러 핸들링 함수
function createAudioElement(key: string, url: string): HTMLAudioElement {
  const audio = new Audio(url)

  audio.addEventListener("loadstart", () => {
    console.log(`[v0] ${key}: loadstart`)
  })

  audio.addEventListener("loadeddata", () => {
    console.log(`[v0] ${key}: loadeddata - duration: ${audio.duration}s`)
  })

  audio.addEventListener("canplay", () => {
    console.log(`[v0] ${key}: canplay`)
  })

  audio.addEventListener("canplaythrough", () => {
    console.log(`[v0] ${key}: canplaythrough - ready to play`)
  })

  audio.addEventListener("playing", () => {
    console.log(`[v0] ${key}: PLAYING - currentTime: ${audio.currentTime}, volume: ${audio.volume}`)
  })

  audio.addEventListener("pause", () => {
    console.log(`[v0] ${key}: paused at ${audio.currentTime}s`)
  })

  audio.addEventListener("ended", () => {
    console.log(`[v0] ${key}: ended`)
  })

  audio.addEventListener("error", (e) => {
    console.error(`[v0] ${key}: ERROR`, {
      error: e,
      src: audio.src,
      networkState: audio.networkState,
      readyState: audio.readyState,
      errorCode: audio.error?.code,
      errorMessage: audio.error?.message,
    })
  })

  audio.addEventListener("stalled", () => {
    console.warn(`[v0] ${key}: stalled - network issue`)
  })

  audio.addEventListener("suspend", () => {
    console.log(`[v0] ${key}: suspend - loading paused`)
  })

  return audio
}

let audioUnlocked = false

let bgmPlaying = false
let bgmAudio: HTMLAudioElement | null = null
let bgmPlayPromise: Promise<void> | null = null
let idleWelcomePlayed = false

export async function unlockAudio(): Promise<void> {
  if (audioUnlocked) {
    console.log("[v0] Audio already unlocked")
    return
  }

  try {
    console.log("[v0] Unlocking audio context...")

    // Create a silent audio to unlock the audio context
    const silentAudio = new Audio()
    silentAudio.src =
      "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4T0mGEEAAAAAAAAAAAAAAAAAAAA//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQZDwP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV"
    silentAudio.volume = 0.01

    await silentAudio.play()
    silentAudio.pause()

    // Pre-create all audio elements to ensure they're ready
    console.log("[v0] Pre-loading audio elements...")
    Object.entries(AUDIO_FILES).forEach(([key, url]) => {
      if (!audioCache[key]) {
        audioCache[key] = createAudioElement(key, url)
        // Preload the audio
        audioCache[key].load()
      }
    })

    audioUnlocked = true
    console.log("[v0] Audio unlocked successfully")
  } catch (error) {
    console.error("[v0] Failed to unlock audio:", error)
  }
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked
}

function waitForAudioReady(audio: HTMLAudioElement, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // If already loaded enough to play
    if (audio.readyState >= 3) {
      // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
      console.log(`[v0] ${key}: Already ready (readyState=${audio.readyState})`)
      resolve()
      return
    }

    console.log(`[v0] ${key}: Waiting for audio to be ready... (readyState=${audio.readyState})`)

    const onCanPlayThrough = () => {
      console.log(`[v0] ${key}: canplaythrough event - audio is ready`)
      cleanup()
      resolve()
    }

    const onError = (e: Event) => {
      console.error(`[v0] ${key}: Error while waiting for ready:`, e)
      cleanup()
      reject(new Error(`Failed to load audio: ${key}`))
    }

    const onLoadedData = () => {
      console.log(`[v0] ${key}: loadeddata event (readyState=${audio.readyState})`)
      // If we have enough data, resolve immediately
      if (audio.readyState >= 3) {
        cleanup()
        resolve()
      }
    }

    const cleanup = () => {
      audio.removeEventListener("canplaythrough", onCanPlayThrough)
      audio.removeEventListener("error", onError)
      audio.removeEventListener("loadeddata", onLoadedData)
    }

    audio.addEventListener("canplaythrough", onCanPlayThrough, { once: true })
    audio.addEventListener("error", onError, { once: true })
    audio.addEventListener("loadeddata", onLoadedData)

    // Trigger loading if not already started
    if (audio.readyState === 0) {
      console.log(`[v0] ${key}: Calling load() to start loading`)
      audio.load()
    }

    // Timeout after 10 seconds
    setTimeout(() => {
      cleanup()
      reject(new Error(`Timeout waiting for audio to load: ${key}`))
    }, 10000)
  })
}

/**
 * 음성 파일 재생 함수
 * @param audioKey 재생할 음성 파일 키
 */
export async function playAudio(audioKey: keyof typeof AUDIO_FILES): Promise<void> {
  try {
    console.log(`[v0] ========== playAudio(${audioKey}) called ==========`)

    // 이미 재생 중인 모든 오디오 중지 (BGM 제외)
    stopAllAudio(false)

    // 캐시에 없으면 새로 생성
    if (!audioCache[audioKey]) {
      console.log(`[v0] Creating new audio element for: ${audioKey}`)
      audioCache[audioKey] = createAudioElement(audioKey, AUDIO_FILES[audioKey])
    }

    // 오디오 재생
    const audio = audioCache[audioKey]

    console.log(`[v0] Audio state before play:`, {
      paused: audio.paused,
      currentTime: audio.currentTime,
      duration: audio.duration,
      volume: audio.volume,
      muted: audio.muted,
      readyState: audio.readyState,
      networkState: audio.networkState,
      src: audio.src,
    })

    try {
      await waitForAudioReady(audio, audioKey)
    } catch (error) {
      console.error(`[v0] Failed to load audio ${audioKey}:`, error)
      return
    }

    audio.currentTime = 0 // 처음부터 재생
    audio.volume = 0.8

    console.log(`[v0] Calling play() for: ${audioKey}`)

    audioPlayPromises[audioKey] = audio
      .play()
      .then(() => {
        console.log(`[v0] ✓ play() promise resolved for ${audioKey}`)
        console.log(`[v0] Audio state after play:`, {
          paused: audio.paused,
          currentTime: audio.currentTime,
          duration: audio.duration,
          volume: audio.volume,
        })

        setTimeout(() => {
          console.log(`[v0] Audio progress check (1s later):`, {
            key: audioKey,
            paused: audio.paused,
            currentTime: audio.currentTime,
            isPlaying: !audio.paused && audio.currentTime > 0,
          })
        }, 1000)
      })
      .catch((error) => {
        // Ignore AbortError which happens when play is interrupted
        if (error.name !== "AbortError") {
          console.error(`[v0] ✗ play() promise rejected for ${audioKey}:`, error)
        } else {
          console.log(`[v0] play() aborted for ${audioKey} (normal if interrupted)`)
        }
      })
  } catch (error) {
    console.error(`[v0] Exception in playAudio(${audioKey}):`, error)
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
export async function startBGM(volume = 0.3): Promise<void> {
  try {
    console.log(`[v0] ========== startBGM() called ==========`)
    console.log(`[v0] BGM current state: playing=${bgmPlaying}, audio exists=${!!bgmAudio}`)

    // 이미 재생 중이면 중복 실행 방지
    if (bgmPlaying && bgmAudio) {
      console.log(`[v0] BGM already playing, skipping`)
      return
    }

    // BGM 오디오 객체 생성 또는 가져오기
    if (!bgmAudio) {
      console.log(`[v0] Creating new BGM audio element`)
      bgmAudio = createAudioElement("BGM", AUDIO_FILES.BGM)
      bgmAudio.loop = true
      bgmAudio.volume = volume

      bgmAudio.addEventListener("ended", () => {
        console.log("[v0] BGM ended, restarting...")
        if (bgmAudio) {
          bgmAudio.currentTime = 0
          bgmPlayPromise = bgmAudio.play().catch((err) => {
            if (err.name !== "AbortError") {
              console.error("[v0] Error restarting BGM:", err)
            }
          })
        }
      })
    } else {
      bgmAudio.volume = volume
    }

    console.log(`[v0] BGM state before play:`, {
      paused: bgmAudio.paused,
      currentTime: bgmAudio.currentTime,
      duration: bgmAudio.duration,
      volume: bgmAudio.volume,
      loop: bgmAudio.loop,
      readyState: bgmAudio.readyState,
    })

    try {
      await waitForAudioReady(bgmAudio, "BGM")
    } catch (error) {
      console.error(`[v0] Failed to load BGM:`, error)
      bgmPlaying = false
      return
    }

    bgmPlayPromise = bgmAudio
      .play()
      .then(() => {
        console.log("[v0] ✓ BGM play() promise resolved")
        bgmPlaying = true

        setTimeout(() => {
          if (bgmAudio) {
            console.log(`[v0] BGM progress check:`, {
              paused: bgmAudio.paused,
              currentTime: bgmAudio.currentTime,
              isPlaying: !bgmAudio.paused && bgmAudio.currentTime > 0,
            })
          }
        }, 1000)
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("[v0] ✗ BGM play() promise rejected:", error)
        }
        bgmPlaying = false
      })
  } catch (error) {
    console.error("[v0] Exception in startBGM():", error)
    bgmPlaying = false
  }
}

/**
 * BGM 일시 중지 함수
 */
export function pauseBGM(): void {
  try {
    if (bgmAudio && bgmPlaying) {
      if (bgmPlayPromise) {
        bgmPlayPromise
          .then(() => {
            if (bgmAudio) {
              bgmAudio.pause()
              bgmPlaying = false
              console.log("BGM paused")
            }
          })
          .catch(() => {
            // Play was already interrupted, just update state
            bgmPlaying = false
          })
      } else {
        bgmAudio.pause()
        bgmPlaying = false
        console.log("BGM paused")
      }
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
      bgmPlayPromise = bgmAudio
        .play()
        .then(() => {
          bgmPlaying = true
          console.log("BGM resumed")
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            console.error("BGM 재개 오류:", error)
          }
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
      if (bgmPlayPromise) {
        bgmPlayPromise
          .then(() => {
            if (bgmAudio) {
              bgmAudio.pause()
              bgmAudio.currentTime = 0
              bgmPlaying = false
              console.log("BGM stopped")
            }
          })
          .catch(() => {
            // Play was already interrupted, just reset
            if (bgmAudio) {
              bgmAudio.currentTime = 0
            }
            bgmPlaying = false
          })
      } else {
        bgmAudio.pause()
        bgmAudio.currentTime = 0
        bgmPlaying = false
        console.log("BGM stopped")
      }
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
export async function playIdleWelcome(): Promise<void> {
  if (idleWelcomePlayed) {
    console.log("[v0] Idle welcome already played, skipping")
    return
  }

  try {
    console.log("[v0] Playing idle welcome audio")

    // 캐시에 없으면 새로 생성
    if (!audioCache["IDLE_WELCOME"]) {
      console.log("[v0] Creating new idle welcome audio element")
      audioCache["IDLE_WELCOME"] = createAudioElement("IDLE_WELCOME", AUDIO_FILES.IDLE_WELCOME)
    }

    const audio = audioCache["IDLE_WELCOME"]

    try {
      await waitForAudioReady(audio, "IDLE_WELCOME")
    } catch (error) {
      console.error("[v0] Failed to load idle welcome audio:", error)
      startBGM(0.3)
      return
    }

    audio.currentTime = 0
    audio.volume = 0.8

    // 재생 완료 후 BGM 시작
    audio.onended = () => {
      console.log("[v0] Idle welcome audio ended, starting BGM")
      startBGM(0.3)
    }

    audioPlayPromises["IDLE_WELCOME"] = audio
      .play()
      .then(() => {
        console.log("[v0] Idle welcome audio started")
        idleWelcomePlayed = true
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.error("[v0] Idle welcome audio playback error:", error)
        }
        // 재생 실패 시 바로 BGM 시작
        startBGM(0.3)
      })
  } catch (error) {
    console.error("[v0] Error playing idle welcome audio:", error)
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
  Object.entries(audioCache).forEach(([key, audio]) => {
    try {
      if (key !== "BGM") {
        const playPromise = audioPlayPromises[key]
        if (playPromise) {
          playPromise
            .then(() => {
              audio.pause()
              audio.currentTime = 0
            })
            .catch(() => {
              // Play was already interrupted, just reset
              audio.currentTime = 0
            })
          audioPlayPromises[key] = null
        } else {
          audio.pause()
          audio.currentTime = 0
        }
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
