/**
 * ONEPLUS 지폐방출기 연결 및 제어를 위한 유틸리티 함수
 * RS-232C 통신을 통한 지폐 방출 및 처리
 * 강화된 비동기 통신 및 스트림 파싱 지원
 */

// 지폐방출기 연결 상태
let billDispenserPort: SerialPort | null = null
let billDispenserWriter: WritableStreamDefaultWriter | null = null
let billDispenserReader: ReadableStreamDefaultReader | null = null
let lastConnectedPortInfo: any = null

// 스트림 버퍼링 및 파싱
let streamBuffer: Uint8Array = new Uint8Array(0)
let isReading = false
const pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map()

// 지폐 방출 상태
let currentStatus = 0 // 대기 상태
let lastErrorCode = 0 // 마지막 에러 코드
let dispensedCount = 0 // 방출된 지폐 수
let totalDispensedCount = 0 // 누적 방출 수량
let isOldProtocol = true // DIP SW3 설정 (기본: OFF - 구 프로토콜)

// Debug logging
const ENABLE_DEBUG_LOGGING = true
const commandLog: Array<{ command: string; bytes: number[]; response?: number[]; timestamp: string; error?: string }> =
  []
const connectionLog: Array<{ event: string; details: string; timestamp: string }> = []

/**
 * 디버그 로그 함수
 */
function logDebug(message: string): void {
  if (ENABLE_DEBUG_LOGGING) {
    console.log(`[BILL_DISPENSER] ${message}`)
  }
}

/**
 * 연결 로그 함수
 */
function logConnection(event: string, details: string): void {
  const timestamp = new Date().toISOString()
  connectionLog.push({ event, details, timestamp })
  logDebug(`[CONNECTION] ${event}: ${details}`)
}

/**
 * 명령어 로그 함수
 */
function logCommand(
  command: string,
  bytes: Uint8Array | number[],
  response?: Uint8Array | number[],
  error?: string,
): void {
  if (ENABLE_DEBUG_LOGGING) {
    const hexBytes = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
    const responseHex = response
      ? Array.from(response)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")
      : "N/A"
    const timestamp = new Date().toISOString()
    console.log(`[BILL_DISPENSER CMD] ${command}: ${hexBytes} -> ${responseHex}${error ? ` ERROR: ${error}` : ""}`)
    commandLog.push({
      command,
      bytes: Array.from(bytes),
      response: response ? Array.from(response) : undefined,
      timestamp,
      error,
    })
  }
}

/**
 * 체크섬 계산 함수
 */
function calculateChecksum(byte2: number, byte3: number, byte4: number): number {
  return (byte2 + byte3 + byte4) & 0xff
}

/**
 * 5바이트 패킷 생성 함수
 */
function createPacket(cmd1: number, cmd2: number, data: number): Uint8Array {
  const checksum = calculateChecksum(cmd1, cmd2, data)
  return new Uint8Array([0x24, cmd1, cmd2, data, checksum]) // $ + CMD1 + CMD2 + DATA + CHK
}

/**
 * 패킷 유효성 검증 함수
 */
function validatePacket(packet: Uint8Array): boolean {
  if (packet.length !== 5) return false
  if (packet[0] !== 0x24) return false // STX must be $

  const expectedChecksum = calculateChecksum(packet[1], packet[2], packet[3])
  return packet[4] === expectedChecksum
}

/**
 * 강화된 스트림 파서 - 버퍼링 및 패킷 추출
 */
function parseStreamBuffer(): Uint8Array[] {
  const packets: Uint8Array[] = []
  let searchIndex = 0

  while (searchIndex < streamBuffer.length) {
    // $ (0x24) 시작 바이트 찾기
    const startIndex = streamBuffer.indexOf(0x24, searchIndex)
    if (startIndex === -1) {
      // 시작 바이트가 없으면 버퍼 정리
      streamBuffer = new Uint8Array(0)
      break
    }

    // 완전한 5바이트 패킷이 있는지 확인
    if (startIndex + 5 > streamBuffer.length) {
      // 불완전한 패킷 - 시작 바이트부터 보존
      streamBuffer = streamBuffer.slice(startIndex)
      break
    }

    // 5바이트 패킷 추출
    const candidatePacket = streamBuffer.slice(startIndex, startIndex + 5)

    // 패킷 유효성 검증
    if (validatePacket(candidatePacket)) {
      packets.push(candidatePacket)
      logDebug(
        `유효한 패킷 추출: ${Array.from(candidatePacket)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")}`,
      )
      searchIndex = startIndex + 5
    } else {
      logDebug(
        `유효하지 않은 패킷: ${Array.from(candidatePacket)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")}`,
      )
      searchIndex = startIndex + 1
    }
  }

  // 처리된 데이터 제거
  if (searchIndex > 0) {
    streamBuffer = streamBuffer.slice(searchIndex)
  }

  return packets
}

/**
 * 연속 스트림 읽기 함수
 */
async function startStreamReading(): Promise<void> {
  if (!billDispenserReader || isReading) return

  isReading = true
  logDebug("스트림 읽기 시작")

  try {
    while (isReading && billDispenserReader) {
      const { value, done } = await billDispenserReader.read()

      if (done) {
        logDebug("스트림 읽기 완료")
        break
      }

      if (value && value.length > 0) {
        // 새 데이터를 버퍼에 추가
        const newBuffer = new Uint8Array(streamBuffer.length + value.length)
        newBuffer.set(streamBuffer)
        newBuffer.set(value, streamBuffer.length)
        streamBuffer = newBuffer

        logDebug(
          `스트림 데이터 수신: ${Array.from(value)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ")}`,
        )

        // 패킷 파싱 및 처리
        const packets = parseStreamBuffer()
        for (const packet of packets) {
          await processReceivedPacket(packet)
        }
      }
    }
  } catch (error) {
    logDebug(`스트림 읽기 오류: ${error}`)
  } finally {
    isReading = false
  }
}

/**
 * 수신된 패킷 처리 함수
 */
async function processReceivedPacket(packet: Uint8Array): Promise<void> {
  const cmd1 = packet[1]
  const cmd2 = packet[2]
  const data = packet[3]

  // 명령 응답 매칭
  const responseKey = getResponseKey(cmd1, cmd2)
  const pendingCommand = pendingCommands.get(responseKey)

  if (pendingCommand) {
    clearTimeout(pendingCommand.timeout)
    pendingCommands.delete(responseKey)
    pendingCommand.resolve(packet)
    logDebug(`명령 응답 매칭 성공: ${responseKey}`)
  } else {
    logDebug(
      `매칭되지 않은 응답: ${Array.from(packet)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")}`,
    )
  }

  // 상태 업데이트 - 실제 응답 패턴에 맞춰 수정
  if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x74 && data === 0x62) {
    // 대기 상태 ('s' 't' 'b')
    currentStatus = 0
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x6f && data === 0x6e) {
    // 배출 동작 중 ('s' 'o' 'n')
    currentStatus = 1
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x68 && data === 0x21) {
    // 방출기 동작 금지 상태 ('s' 'h' '!')
    currentStatus = 2
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x6f) {
    // 정상 종료 상태 ('s' 'o' + count)
    currentStatus = 3
    dispensedCount = data
  } else if ((cmd1 === 0x73 || cmd1 === 0x53) && cmd2 === 0x65) {
    // 에러 상태 ('s' 'e' + error_code)
    lastErrorCode = data
  }
}

/**
 * 응답 키 생성 함수
 */
function getResponseKey(cmd1: number, cmd2: number): string {
  return `${cmd1.toString(16).padStart(2, "0")}-${cmd2.toString(16).padStart(2, "0")}`
}

/**
 * 명령 전송 및 응답 대기 함수 (개선된 버전)
 */
async function sendCommandAndWaitResponse(
  packet: Uint8Array,
  expectedCmd1: number,
  expectedCmd2: number,
  timeoutMs = 1000,
  retries = 3,
): Promise<Uint8Array | null> {
  if (!billDispenserWriter) {
    logCommand("SEND_COMMAND", packet, undefined, "지폐방출기가 연결되지 않음")
    return null
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logDebug(`명령 전송 시도 ${attempt}/${retries}`)

      // 응답 대기 설정
      const responseKey = getResponseKey(expectedCmd1, expectedCmd2)
      const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingCommands.delete(responseKey)
          reject(new Error(`명령 타임아웃: ${responseKey}`))
        }, timeoutMs)

        pendingCommands.set(responseKey, { resolve, reject, timeout })
      })

      // 명령 전송
      await billDispenserWriter.write(packet)
      logDebug("명령 전송 완료")

      // 응답 대기
      try {
        const response = await responsePromise
        logDebug("유효한 응답 수신")
        return response
      } catch (timeoutError) {
        logDebug(`명령 타임아웃 (시도 ${attempt}/${retries}): ${timeoutError}`)
        if (attempt === retries) {
          logCommand("SEND_COMMAND", packet, undefined, "최종 타임아웃")
          return null
        }
        // 재시도 전 잠시 대기
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch (error) {
      const errorMsg = `명령 전송 오류 (시도 ${attempt}/${retries}): ${error}`
      logDebug(errorMsg)
      if (attempt === retries) {
        logCommand("SEND_COMMAND", packet, undefined, errorMsg)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  return null
}

/**
 * 스트림 읽기 중지 함수
 */
function stopStreamReading(): void {
  isReading = false

  // 대기 중인 모든 명령 취소
  for (const [key, command] of pendingCommands.entries()) {
    clearTimeout(command.timeout)
    command.reject(new Error("연결 해제됨"))
  }
  pendingCommands.clear()

  // 버퍼 초기화
  streamBuffer = new Uint8Array(0)
}

/**
 * 포트 진단 함수
 */
async function diagnosePort(): Promise<{
  available: boolean
  inUse: boolean
  permissions: boolean
  details: string[]
}> {
  const details: string[] = []
  let available = false
  let inUse = false
  let permissions = true

  try {
    logConnection("PORT_DIAGNOSIS", "포트 진단 시작")

    // Check if Web Serial API is available
    if (!("serial" in navigator)) {
      details.push("❌ Web Serial API가 지원되지 않습니다")
      details.push("💡 Chrome 89+ 또는 Edge 89+를 사용해주세요")
      return { available: false, inUse: false, permissions: false, details }
    }

    details.push("✅ Web Serial API 지원됨")

    // Get available ports
    const ports = await (navigator as any).serial.getPorts()
    details.push(`📋 사용 가능한 포트 수: ${ports.length}`)

    if (ports.length === 0) {
      details.push("⚠️ 사용 가능한 포트가 없습니다")
      details.push("💡 포트 권한을 부여하려면 '연결' 버튼을 클릭하세요")
    } else {
      available = true
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i]
        const info = port.getInfo ? await port.getInfo() : {}
        details.push(`📍 포트 ${i + 1}: VID=${info.usbVendorId || "N/A"}, PID=${info.usbProductId || "N/A"}`)

        // Check if port is already open
        try {
          if (port.readable || port.writable) {
            details.push(`⚠️ 포트 ${i + 1}이 이미 사용 중입니다`)
            inUse = true
          }
        } catch (e) {
          details.push(`❓ 포트 ${i + 1} 상태 확인 불가: ${e}`)
        }
      }
    }

    logConnection("PORT_DIAGNOSIS", `완료 - Available: ${available}, InUse: ${inUse}`)
  } catch (error) {
    details.push(`❌ 포트 진단 오류: ${error}`)
    permissions = false
    logConnection("PORT_DIAGNOSIS", `오류: ${error}`)
  }

  return { available, inUse, permissions, details }
}

/**
 * 연결 설정 검증 함수
 */
function validateConnectionSettings(): { valid: boolean; details: string[] } {
  const details: string[] = []
  const valid = true

  // ONEPLUS 지폐방출기 표준 설정
  const expectedSettings = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  }

  details.push("📋 ONEPLUS 지폐방출기 표준 설정:")
  details.push(`   • Baud Rate: ${expectedSettings.baudRate} bps`)
  details.push(`   • Data Bits: ${expectedSettings.dataBits}`)
  details.push(`   • Stop Bits: ${expectedSettings.stopBits}`)
  details.push(`   • Parity: ${expectedSettings.parity}`)
  details.push(`   • Flow Control: ${expectedSettings.flowControl}`)

  details.push("")
  details.push("💡 Windows 장치 관리자에서 COM5 설정 확인:")
  details.push("   1. 장치 관리자 → 포트(COM & LPT) → COM5")
  details.push("   2. 속성 → 포트 설정 탭")
  details.push("   3. 위 설정과 일치하는지 확인")

  return { valid, details }
}

/**
 * 지폐방출기 연결 함수 (향상된 진단 기능 포함)
 */
export async function connectBillDispenser(): Promise<boolean> {
  try {
    logConnection("CONNECT_START", "지폐방출기 연결 시도 시작")

    // Clear previous logs
    connectionLog.length = 0
    commandLog.length = 0

    // Step 1: Diagnose port availability
    const portDiagnosis = await diagnosePort()
    if (!portDiagnosis.available && !portDiagnosis.permissions) {
      throw new Error("포트 진단 실패: " + portDiagnosis.details.join(", "))
    }

    // Step 2: If already connected, test the connection first
    if (billDispenserPort && billDispenserWriter && billDispenserReader) {
      logConnection("EXISTING_CONNECTION", "기존 연결 테스트 중")
      const connectionTest = await checkConnection()
      if (connectionTest) {
        logConnection("EXISTING_CONNECTION", "기존 연결이 유효함")
        return true
      } else {
        logConnection("EXISTING_CONNECTION", "기존 연결이 무효함, 재연결 시도")
        await disconnectBillDispenser()
      }
    }

    // Step 3: Request port from user
    logConnection("PORT_REQUEST", "사용자에게 포트 선택 요청")
    try {
      billDispenserPort = await (navigator as any).serial.requestPort({
        // No filters for native COM ports - let user select any available port
      })
      logConnection("PORT_REQUEST", "포트가 선택됨")
    } catch (err) {
      logConnection("PORT_REQUEST", `사용자가 포트 선택을 취소: ${err}`)
      throw new Error("포트 선택이 취소되었습니다.")
    }

    // Step 4: Get port information
    try {
      lastConnectedPortInfo = billDispenserPort.getInfo ? await billDispenserPort.getInfo() : {}
      logConnection("PORT_INFO", `포트 정보: ${JSON.stringify(lastConnectedPortInfo)}`)
    } catch (err) {
      logConnection("PORT_INFO", `포트 정보 가져오기 실패: ${err}`)
    }

    // Step 5: Open the port with ONEPLUS specifications
    logConnection("PORT_OPEN", "포트 열기 시도")
    try {
      await billDispenserPort.open({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
        bufferSize: 255,
      })
      logConnection("PORT_OPEN", "포트가 성공적으로 열림")
    } catch (err) {
      logConnection("PORT_OPEN", `포트 열기 실패: ${err}`)

      // Provide specific guidance for common errors
      let errorMessage = `포트 열기 실패: ${err}`
      if (err.toString().includes("Access denied")) {
        errorMessage +=
          "\n\n해결 방법:\n1. 다른 프로그램이 COM 포트를 사용 중인지 확인\n2. 장치 관리자에서 COM 포트 상태 확인\n3. 브라우저를 관리자 권한으로 실행"
      } else if (err.toString().includes("Network error")) {
        errorMessage +=
          "\n\n해결 방법:\n1. COM 포트 물리적 연결 확인\n2. 지폐방출기 전원 확인 (DC 12V/24V)\n3. RS-232 케이블 연결 확인"
      }

      throw new Error(errorMessage)
    }

    // Step 6: Set up the streams
    logConnection("STREAM_SETUP", "스트림 설정 중")
    try {
      const writableStream = billDispenserPort.writable
      const readableStream = billDispenserPort.readable

      if (!writableStream || !readableStream) {
        throw new Error("스트림을 가져올 수 없습니다")
      }

      billDispenserWriter = writableStream.getWriter()
      billDispenserReader = readableStream.getReader()
      logConnection("STREAM_SETUP", "스트림 설정 완료")
    } catch (err) {
      logConnection("STREAM_SETUP", `스트림 설정 실패: ${err}`)
      throw new Error(`스트림 설정 실패: ${err}`)
    }

    // Step 7: Start continuous stream reading
    logConnection("STREAM_START", "연속 스트림 읽기 시작")
    startStreamReading()

    // Step 8: Wait for device initialization
    logConnection("DEVICE_INIT", "디바이스 초기화 대기 (1초)")
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Step 9: Test communication
    logConnection("COMM_TEST", "통신 테스트 시작")
    const connectionTest = await checkConnection()
    if (!connectionTest) {
      logConnection("COMM_TEST", "통신 테스트 실패")
      await disconnectBillDispenser()

      throw new Error(
        "지폐방출기와 통신할 수 없습니다.\n\n확인사항:\n" +
          "1. 지폐방출기 전원 상태 (DC 12V/24V)\n" +
          "2. RS-232 케이블 연결 (Pin 1: RX, Pin 2: TX, Pin 3: GND)\n" +
          "3. COM 포트 설정 (9600-8-N-1)\n" +
          "4. 다른 프로그램의 COM 포트 사용 여부",
      )
    }

    // Step 10: 초기화 명령 실행 후 상태 확인
    logConnection("DEVICE_INIT", "지폐방출기 초기화 명령 실행")
    const resetResult = await resetDispenser()
    if (!resetResult) {
      logConnection("DEVICE_INIT", "지폐방출기 초기화 실패")
      await disconnectBillDispenser()
      throw new Error(
        "지폐방출기 초기화에 실패했습니다.\n\n확인사항:\n" +
          "1. 지폐방출기 전원 상태 (DC 12V/24V)\n" +
          "2. RS-232 케이블 연결 (Pin 1: RX, Pin 2: TX, Pin 3: GND)\n" +
          "3. COM 포트 설정 (9600-8-N-1)",
      )
    }

    logConnection("DEVICE_INIT", "지폐방출기 초기화 성공")

    // 초기화 후 잠시 대기
    await new Promise((resolve) => setTimeout(resolve, 500))

    // 상태 확인
    logConnection("STATUS_CHECK", "초기 상태 확인")
    await getStatus()

    logConnection("CONNECT_SUCCESS", "지폐방출기 연결 성공")
    return true
  } catch (error) {
    logConnection("CONNECT_ERROR", `연결 오류: ${error}`)
    await disconnectBillDispenser()
    throw error
  }
}

/**
 * 지폐방출기 연결 해제 함수
 */
export async function disconnectBillDispenser(): Promise<void> {
  try {
    logConnection("DISCONNECT_START", "지폐방출기 연결 해제 시작")

    // Stop stream reading first
    stopStreamReading()

    if (billDispenserReader) {
      try {
        await billDispenserReader.cancel()
        logConnection("DISCONNECT", "Reader 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Reader 해제 오류: ${err}`)
      }
      billDispenserReader = null
    }

    if (billDispenserWriter) {
      try {
        await billDispenserWriter.close()
        logConnection("DISCONNECT", "Writer 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Writer 해제 오류: ${err}`)
      }
      billDispenserWriter = null
    }

    if (billDispenserPort) {
      try {
        await billDispenserPort.close()
        logConnection("DISCONNECT", "Port 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Port 해제 오류: ${err}`)
      }
      billDispenserPort = null
    }

    logConnection("DISCONNECT_SUCCESS", "지폐방출기 연결 해제 완료")
  } catch (error) {
    logConnection("DISCONNECT_ERROR", `연결 해제 중 오류: ${error}`)
  }
}

/**
 * 연결 확인 함수
 */
export async function checkConnection(): Promise<boolean> {
  try {
    // 프로토콜 버전 확인 (DIP SW3 설정에 따라 다름)
    const cmd1 = isOldProtocol ? 0x48 : 0x68 // 'H' or 'h'
    const cmd2 = isOldProtocol ? 0x49 : 0x69 // 'I' or 'i'
    const data = 0x3f // '?'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값 (DIP SW3 설정에 따라 다름)
    const expectedCmd1 = isOldProtocol ? 0x6d : 0x4d // 'm' or 'M'
    const expectedCmd2 = isOldProtocol ? 0x65 : 0x45 // 'e' or 'E'

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2, 2000)

    if (response && response.length === 5) {
      if (
        (response[1] === 0x6d && response[2] === 0x65 && response[3] === 0x21) || // 'm' 'e' '!'
        (response[1] === 0x4d && response[2] === 0x45 && response[3] === 0x21) // 'M' 'E' '!'
      ) {
        logCommand("Check Connection", packet, response)
        return true
      }
    }

    logCommand("Check Connection", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Check Connection", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 프로토콜 설정 함수 (DIP SW3 설정)
 */
export function setProtocolVersion(isOld: boolean): void {
  isOldProtocol = isOld
  logConnection("PROTOCOL_SET", isOld ? "구 프로토콜 설정 (DIP SW3 OFF)" : "신 프로토콜 설정 (DIP SW3 ON)")
}

/**
 * 초기화 명령 (Reset)
 */
export async function resetDispenser(): Promise<boolean> {
  try {
    // 초기화 전 잠시 대기
    await new Promise((resolve) => setTimeout(resolve, 300))

    const cmd1 = isOldProtocol ? 0x49 : 0x69 // 'I' or 'i'
    const cmd2 = 0x00
    const data = 0x00

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x69 : 0x49 // 'i' or 'I'
    const expectedCmd2 = 0x00

    // 명령 전송 전 대기 중인 모든 명령 취소
    pendingCommands.forEach((command, key) => {
      clearTimeout(command.timeout)
      command.reject(new Error("초기화 명령으로 취소됨"))
    })
    pendingCommands.clear()

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2, 2000)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x69 && response[2] === 0x00 && response[3] === 0x61) || // 'i' + '0x00' + 'a'
        (!isOldProtocol && response[1] === 0x49 && response[2] === 0x00 && response[3] === 0x41) // 'I' + '0x00' + 'A'
      ) {
        logCommand("Reset Dispenser", packet, response)
        return true
      }
    }

    logCommand("Reset Dispenser", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Reset Dispenser", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 지폐 방출 명령
 */
export async function dispenseBills(count: number): Promise<boolean> {
  if (count < 1 || count > 250) {
    logCommand("Dispense Bills", [], undefined, `유효하지 않은 지폐 수량: ${count}`)
    return false
  }

  try {
    // 방출 전 상태 확인
    const status = await getStatus()
    logDebug(`방출 전 상태: ${status}`)

    // 이미 방출 중이면 중복 방출 방지
    if (currentStatus === 1) {
      logCommand("Dispense Bills", [], undefined, "이미 방출 중입니다. 중복 방출 방지")
      return false
    }

    const cmd1 = isOldProtocol ? 0x44 : 0x64 // 'D' or 'd'
    const cmd2 = count // 방출할 지폐 수
    const data = isOldProtocol ? 0x53 : 0x73 // 'S' or 's'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x64 : 0x44 // 'd' or 'D'
    const expectedCmd2 = count

    // 명령 전송 전 대기 중인 모든 명령 취소
    pendingCommands.forEach((command, key) => {
      clearTimeout(command.timeout)
      command.reject(new Error("새 명령 시작으로 취소됨"))
    })
    pendingCommands.clear()

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x64 && response[2] === count && response[3] === 0x61) || // 'd' + count + 'a'
        (!isOldProtocol && response[1] === 0x44 && response[2] === count && response[3] === 0x41) // 'D' + count + 'A'
      ) {
        logCommand("Dispense Bills", packet, response)
        return true
      }
    }

    logCommand("Dispense Bills", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Dispense Bills", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 동작 금지 설정 명령
 */
export async function disableDispenser(): Promise<boolean> {
  try {
    const cmd1 = isOldProtocol ? 0x48 : 0x68 // 'H' or 'h'
    const cmd2 = 0x00
    const data = 0x00

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x68 : 0x48 // 'h' or 'H'
    const expectedCmd2 = 0x00

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x68 && response[3] === 0x61) || // 'h' + 'a'
        (!isOldProtocol && response[1] === 0x48 && response[3] === 0x41) // 'H' + 'A'
      ) {
        logCommand("Disable Dispenser", packet, response)
        return true
      }
    }

    logCommand("Disable Dispenser", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Disable Dispenser", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 동작 금지 해제 명령
 */
export async function enableDispenser(): Promise<boolean> {
  try {
    const cmd1 = isOldProtocol ? 0x48 : 0x68 // 'H' or 'h'
    const cmd2 = isOldProtocol ? 0x43 : 0x63 // 'C' or 'c'
    const data = 0x3f // '?'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x68 : 0x48 // 'h' or 'H'
    const expectedCmd2 = isOldProtocol ? 0x63 : 0x43 // 'c' or 'C'

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x68 && response[2] === 0x63 && response[3] === 0x21) || // 'h' 'c' '!'
        (!isOldProtocol && response[1] === 0x48 && response[2] === 0x43 && response[3] === 0x21) // 'H' 'C' '!'
      ) {
        logCommand("Enable Dispenser", packet, response)
        return true
      }
    }

    logCommand("Enable Dispenser", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Enable Dispenser", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 배출된 지폐 수 삭제 명령
 */
export async function clearDispensedCount(): Promise<boolean> {
  try {
    const cmd1 = isOldProtocol ? 0x52 : 0x72 // 'R' or 'r'
    const cmd2 = isOldProtocol ? 0x45 : 0x65 // 'E' or 'e'
    const data = isOldProtocol ? 0x4d : 0x6d // 'M' or 'm'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x72 : 0x52 // 'r' or 'R'
    const expectedCmd2 = isOldProtocol ? 0x00 : 0x00

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x72 && response[3] === 0x6f) || // 'r' + 'o'
        (!isOldProtocol && response[1] === 0x52 && response[3] === 0x4f) // 'R' + 'O'
      ) {
        logCommand("Clear Dispensed Count", packet, response)
        dispensedCount = 0
        return true
      }
    }

    logCommand("Clear Dispensed Count", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Clear Dispensed Count", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 총 배출 수량 확인 명령
 */
export async function getTotalDispensedCount(): Promise<number | null> {
  try {
    const cmd1 = isOldProtocol ? 0x47 : 0x67 // 'G' or 'g'
    const cmd2 = isOldProtocol ? 0x54 : 0x74 // 'T' or 't'
    const data = 0x3f // '?'

    const packet = createPacket(cmd1, cmd2, data)

    // 명령 전송
    if (!billDispenserWriter) {
      logCommand("Get Total Dispensed Count", packet, undefined, "지폐방출기가 연결되지 않음")
      return null
    }

    await billDispenserWriter.write(packet)
    logDebug("총 배출 수량 확인 명령 전송 완료")

    // 첫 번째 패킷 응답 대기 ('t'로 시작하는 패킷)
    let firstPacket: Uint8Array | null = null
    let secondPacket: Uint8Array | null = null

    // 최대 2초 동안 응답 대기
    const startTime = Date.now()
    while (Date.now() - startTime < 2000) {
      // 스트림에서 패킷 확인
      const packets = parseStreamBuffer()

      for (const packet of packets) {
        if (packet.length === 5 && packet[0] === 0x24) {
          // '$'
          if (packet[1] === 0x74) {
            // 't' - 첫 번째 패킷
            firstPacket = packet
            logDebug("첫 번째 패킷(t) 수신 완료")
          } else if (packet[1] === 0x67) {
            // 'g' - 두 번째 패킷
            secondPacket = packet
            logDebug("두 번째 패킷(g) 수신 완료")
          }
        }
      }

      // 두 패킷 모두 수신했으면 종료
      if (firstPacket && secondPacket) {
        break
      }

      // 잠시 대기
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // 두 패킷 모두 수신했는지 확인
    if (firstPacket && secondPacket) {
      // 32비트 숫자 계산
      const msb = firstPacket[2]
      const secondByte = firstPacket[3]
      const thirdByte = secondPacket[2]
      const lsb = secondPacket[3]

      const total = msb * 16777216 + secondByte * 65536 + thirdByte * 256 + lsb

      logCommand("Get Total Dispensed Count", packet, [...Array.from(firstPacket), ...Array.from(secondPacket)], "성공")

      totalDispensedCount = total
      return total
    }

    // 패킷을 모두 수신하지 못한 경우
    const receivedPackets = []
    if (firstPacket) receivedPackets.push(...Array.from(firstPacket))
    if (secondPacket) receivedPackets.push(...Array.from(secondPacket))

    logCommand(
      "Get Total Dispensed Count",
      packet,
      receivedPackets.length > 0 ? receivedPackets : undefined,
      firstPacket ? "두 번째 패킷 수신 실패" : "응답 패킷 수신 실패",
    )

    return null
  } catch (error) {
    logCommand("Get Total Dispensed Count", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 누적 배출 수량 초기화 명령
 */
export async function clearTotalDispensedCount(): Promise<boolean> {
  try {
    const cmd1 = isOldProtocol ? 0x43 : 0x63 // 'C' or 'c'
    const cmd2 = isOldProtocol ? 0x54 : 0x74 // 'T' or 't'
    const data = isOldProtocol ? 0x43 : 0x63 // 'C' or 'c'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x63 : 0x43 // 'c' or 'C'
    const expectedCmd2 = isOldProtocol ? 0x74 : 0x54 // 't' or 'T'

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      if (
        (isOldProtocol && response[1] === 0x63 && response[2] === 0x74 && response[3] === 0x21) || // 'c' 't' '!'
        (!isOldProtocol && response[1] === 0x43 && response[2] === 0x54 && response[3] === 0x21) // 'C' 'T' '!'
      ) {
        logCommand("Clear Total Dispensed Count", packet, response)
        totalDispensedCount = 0
        return true
      }
    }

    logCommand("Clear Total Dispensed Count", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Clear Total Dispensed Count", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 상태 확인 명령
 */
export async function getStatus(): Promise<string | null> {
  try {
    const cmd1 = 0x53 // 'S'
    const cmd2 = 0x00
    const data = 0x00

    const packet = createPacket(cmd1, cmd2, data)

    // 명령 전송
    if (!billDispenserWriter) {
      logCommand("Get Status", packet, undefined, "지폐방출기가 연결되지 않음")
      return null
    }

    await billDispenserWriter.write(packet)
    logDebug("상태 확인 명령 전송 완료")

    // 응답 대기 (더 유연한 방식)
    await new Promise((resolve) => setTimeout(resolve, 200)) // 200ms 대기

    // 스트림에서 응답 찾기
    const packets = parseStreamBuffer()
    for (const response of packets) {
      if (response[1] === 0x73) {
        // 's' 응답
        const statusCode = response[2]
        const statusData = response[3]

        let statusText = ""

        if (statusCode === 0x74 && statusData === 0x62) {
          // 't' 'b'
          statusText = "대기 상태"
          currentStatus = 0
        } else if (statusCode === 0x6f && statusData === 0x6e) {
          // 'o' 'n'
          statusText = "배출 동작 중"
          currentStatus = 1
        } else if (statusCode === 0x68 && statusData === 0x21) {
          // 'h' '!'
          statusText = "방출기 동작 금지 상태"
          currentStatus = 2
        } else if (statusCode === 0x6f) {
          // 'o' + count
          statusText = `${statusData}장 배출 후 정상 종료 상태`
          currentStatus = 3
          dispensedCount = statusData
        } else if (statusCode === 0x6e) {
          // 'n' + count
          statusText = `${statusData}장 배출 후 비정상 종료 상태`
          currentStatus = 4
          dispensedCount = statusData
        } else {
          statusText = `알 수 없는 상태 (CMD2: 0x${statusCode.toString(16)}, DATA: 0x${statusData.toString(16)})`
        }

        logCommand("Get Status", packet, response)
        return statusText
      }
    }

    logCommand("Get Status", packet, [], "응답 없음")
    return null
  } catch (error) {
    logCommand("Get Status", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 에러 코드 확인 명령
 */
export async function getErrorCode(): Promise<{ code: number; description: string } | null> {
  try {
    const cmd1 = isOldProtocol ? 0x53 : 0x73 // 'S' or 's'
    const cmd2 = isOldProtocol ? 0x45 : 0x65 // 'E' or 'e'
    const data = isOldProtocol ? 0x52 : 0x72 // 'R' or 'r'

    const packet = createPacket(cmd1, cmd2, data)

    // 응답 예상 값
    const expectedCmd1 = isOldProtocol ? 0x73 : 0x53 // 's' or 'S'
    const expectedCmd2 = isOldProtocol ? 0x65 : 0x45 // 'e' or 'E'

    const response = await sendCommandAndWaitResponse(packet, expectedCmd1, expectedCmd2)

    if (response && response.length === 5) {
      const errorCode = response[3]
      lastErrorCode = errorCode

      const errorDescription = getErrorDescription(errorCode)

      logCommand("Get Error Code", packet, response)
      return { code: errorCode, description: errorDescription }
    }

    logCommand("Get Error Code", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Error Code", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 에러 코드에 대한 설명 반환
 */
function getErrorDescription(errorCode: number): string {
  switch (errorCode) {
    case 0x81:
      return "Empty - 지폐 부족"
    case 0x82:
      return "JAM - 지폐 걸림"
    case 0x83:
      return "Bill DOUBLE - 지폐 겹침"
    case 0x84:
      return "Shutter Error - 지폐 미방출"
    case 0x85:
      return "LENGTH LONG - 지폐 길이 불량 (긴 것)"
    case 0x86:
      return "LENGTH SHORT - 지폐 길이 불량 (짧은 것)"
    case 0x87:
      return "REJ_OVER - 센서 불량"
    case 0x8a:
      return "TAKEOUT - 셋팅값 불량"
    case 0x8c:
      return "MOTOR - 모터 불량"
    case 0x8e:
      return "LENGTH DIFFERENTIAL - 지폐 접히거나 배출 시 틀어져서 방출"
    default:
      return `알 수 없는 에러 코드: 0x${errorCode.toString(16)}`
  }
}

/**
 * 연결 상태 확인 함수
 */
export function isBillDispenserConnected(): boolean {
  return billDispenserPort !== null && billDispenserWriter !== null && billDispenserReader !== null
}

/**
 * 현재 상태 정보 가져오기
 */
export function getBillDispenserStatus(): {
  connected: boolean
  currentStatus: number
  dispensedCount: number
  totalDispensedCount: number
  lastErrorCode: number
  isOldProtocol: boolean
} {
  return {
    connected: isBillDispenserConnected(),
    currentStatus,
    dispensedCount,
    totalDispensedCount,
    lastErrorCode,
    isOldProtocol,
  }
}

/**
 * 명령어 로그 가져오기
 */
export function getBillDispenserCommandLog(): Array<{
  command: string
  bytes: number[]
  response?: number[]
  timestamp: string
  error?: string
}> {
  return [...commandLog]
}

/**
 * 연결 로그 가져오기
 */
export function getBillDispenserConnectionLog(): Array<{
  event: string
  details: string
  timestamp: string
}> {
  return [...connectionLog]
}

/**
 * 명령어 로그 지우기
 */
export function clearBillDispenserCommandLog(): void {
  commandLog.length = 0
}

/**
 * 연결 로그 지우기
 */
export function clearBillDispenserConnectionLog(): void {
  connectionLog.length = 0
}

/**
 * 포트 진단 정보 가져오기
 */
export async function getBillDispenserDiagnostics(): Promise<{
  portDiagnosis: any
  connectionSettings: any
  connectionLog: any[]
  commandLog: any[]
}> {
  const portDiagnosis = await diagnosePort()
  const connectionSettings = validateConnectionSettings()

  return {
    portDiagnosis,
    connectionSettings,
    connectionLog: getBillDispenserConnectionLog(),
    commandLog: getBillDispenserCommandLog(),
  }
}

/**
 * 상태 코드를 문자열로 변환
 */
export function getStatusString(status: number): string {
  switch (status) {
    case 0:
      return "대기 상태"
    case 1:
      return "배출 동작 중"
    case 2:
      return "방출기 동작 금지 상태"
    case 3:
      return `${dispensedCount}장 배출 후 정상 종료 상태`
    case 4:
      return `${dispensedCount}장 배출 후 비정상 종료 상태`
    default:
      return `알 수 없는 상태 (${status})`
  }
}

async function sendCommandWithFlexibleResponse(
  packet: Uint8Array,
  expectedCmd1: number,
  timeoutMs = 1000,
  retries = 3,
): Promise<Uint8Array | null> {
  if (!billDispenserWriter) {
    logCommand("SEND_COMMAND", packet, undefined, "지폐방출기가 연결되지 않음")
    return null
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logDebug(`명령 전송 시도 ${attempt}/${retries}`)

      // 응답 대기 설정 - CMD1만 매칭
      const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`명령 타임아웃: ${expectedCmd1.toString(16)}`))
        }, timeoutMs)

        // 임시 리스너 설정
        const checkResponse = () => {
          // 스트림에서 패킷 확인
          const packets = parseStreamBuffer()
          for (const responsePacket of packets) {
            if (responsePacket[1] === expectedCmd1) {
              clearTimeout(timeout)
              resolve(responsePacket)
              return
            }
          }
          // 응답이 없으면 다시 확인
          setTimeout(checkResponse, 50)
        }

        setTimeout(checkResponse, 50)
      })

      // 명령 전송
      await billDispenserWriter.write(packet)
      logDebug("명령 전송 완료")

      // 응답 대기
      try {
        const response = await responsePromise
        logDebug("유효한 응답 수신")
        return response
      } catch (timeoutError) {
        logDebug(`명령 타임아웃 (시도 ${attempt}/${retries}): ${timeoutError}`)
        if (attempt === retries) {
          logCommand("SEND_COMMAND", packet, undefined, "최종 타임아웃")
          return null
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch (error) {
      const errorMsg = `명령 전송 오류 (시도 ${attempt}/${retries}): ${error}`
      logDebug(errorMsg)
      if (attempt === retries) {
        logCommand("SEND_COMMAND", packet, undefined, errorMsg)
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  return null
}
