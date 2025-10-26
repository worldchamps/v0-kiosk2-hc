/**
 * ONEPLUS 지폐인식기 연결 및 제어를 위한 유틸리티 함수
 * RS-232 통신을 통한 지폐 인식 및 처리
 * 강화된 비동기 통신 및 스트림 파싱 지원
 */

// 지폐인식기 연결 상태
let billAcceptorPort: SerialPort | null = null
let billAcceptorWriter: WritableStreamDefaultWriter | null = null
let billAcceptorReader: ReadableStreamDefaultReader | null = null
let lastConnectedPortInfo: any = null

// 스트림 버퍼링 및 파싱
let streamBuffer: Uint8Array = new Uint8Array(0)
let isReading = false
const pendingCommands: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map()

// 지폐 인식 상태
const currentBillValue = 0
let isAcceptingBills = false
let currentStatus = 0x01 // WAIT

// 이벤트 처리 상태
let eventProcessingEnabled = false
let lastEventMessage: { command: string; data: number; timestamp: string } | null = null

// 이벤트 콜백
let eventCallback: ((eventData: number) => void) | null = null

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
    console.log(`[BILL_ACCEPTOR] ${message}`)
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
    console.log(`[BILL_ACCEPTOR CMD] ${command}: ${hexBytes} -> ${responseHex}${error ? ` ERROR: ${error}` : ""}`)
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
  if (!billAcceptorReader || isReading) return

  isReading = true
  logDebug("스트림 읽기 시작")

  try {
    while (isReading && billAcceptorReader) {
      const { value, done } = await billAcceptorReader.read()

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

  // 이벤트 메시지 처리 ($ES)
  if (cmd1 === 0x45 && cmd2 === 0x53) {
    // 'E' 'S'
    await handleEventMessage(packet)
    return
  }

  // 명령 응답 매칭 - $OKx 또는 $NGx 응답 모두 처리
  const responseKey = getResponseKey(cmd1, cmd2)
  const pendingCommand = pendingCommands.get(responseKey)

  if (pendingCommand) {
    clearTimeout(pendingCommand.timeout)
    pendingCommands.delete(responseKey)
    pendingCommand.resolve(packet)
    logDebug(`명령 응답 매칭 성공: ${responseKey}`)
  } else {
    if (cmd1 === 0x4e && cmd2 === 0x47) {
      // 'N' 'G'
      const okKey = getResponseKey(0x4f, 0x4b) // 'O' 'K'
      const okCommand = pendingCommands.get(okKey)
      if (okCommand) {
        clearTimeout(okCommand.timeout)
        pendingCommands.delete(okKey)
        okCommand.resolve(packet)
        logDebug(`$NG 응답을 $OK 명령에 매칭: ${okKey}`)
        return
      }
    }

    logDebug(
      `매칭되지 않은 응답: ${Array.from(packet)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ")}`,
    )
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
  timeoutMs = 500, // 사양서 권장: 500ms
  retries = 5, // 사양서 권장: 초기 1회 + 재시도 4회 = 총 5회
): Promise<Uint8Array | null> {
  if (!billAcceptorWriter) {
    logCommand("SEND_COMMAND", packet, undefined, "지폐인식기가 연결되지 않음")
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
      await billAcceptorWriter.write(packet)
      logDebug(
        `명령 전송 완료 (${Array.from(packet)
          .map((b) => "0x" + b.toString(16).padStart(2, "0"))
          .join(" ")})`,
      )

      // 응답 대기
      try {
        const response = await responsePromise
        logDebug(
          `유효한 응답 수신 (${Array.from(response)
            .map((b) => "0x" + b.toString(16).padStart(2, "0"))
            .join(" ")})`,
        )
        return response
      } catch (timeoutError) {
        logDebug(`명령 타임아웃 (시도 ${attempt}/${retries})`)
        if (attempt === retries) {
          logCommand("SEND_COMMAND", packet, undefined, `최종 타임아웃 (${retries}회 시도 후)`)
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

/**
 * 이벤트 메시지 처리 함수
 */
async function handleEventMessage(packet: Uint8Array): Promise<void> {
  const eventData = packet[3]
  logConnection(
    "EVENT_RECEIVED",
    `이벤트 데이터: 0x${eventData.toString(16).padStart(2, "0")} (${getStatusString(eventData)})`,
  )

  // 이벤트 정보 저장
  lastEventMessage = {
    command: "Event Status",
    data: eventData,
    timestamp: new Date().toISOString(),
  }

  if (eventCallback) {
    eventCallback(eventData)
  }

  // 이벤트 확인 응답 전송 (항상 전송)
  try {
    const ackPacket = createPacket(0x65, 0x73, eventData) // 'e' 's' + eventData
    if (billAcceptorWriter) {
      await billAcceptorWriter.write(ackPacket)
      logCommand("Event Acknowledgment", ackPacket)
    }
  } catch (error) {
    logConnection("EVENT_ACK_ERROR", `이벤트 응답 전송 실패: ${error}`)
  }
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

  // ONEPLUS 지폐인식기 표준 설정
  const expectedSettings = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  }

  details.push("📋 ONEPLUS 지폐인식기 표준 설정:")
  details.push(`   • Baud Rate: ${expectedSettings.baudRate} bps`)
  details.push(`   • Data Bits: ${expectedSettings.dataBits}`)
  details.push(`   • Stop Bits: ${expectedSettings.stopBits}`)
  details.push(`   • Parity: ${expectedSettings.parity}`)
  details.push(`   • Flow Control: ${expectedSettings.flowControl}`)

  details.push("")
  details.push("💡 Windows 장치 관리자에서 COM4 설정 확인:")
  details.push("   1. 장치 관리자 → 포트(COM & LPT) → COM4")
  details.push("   2. 속성 → 포트 설정 탭")
  details.push("   3. 위 설정과 일치하는지 확인")

  return { valid, details }
}

/**
 * 지폐인식기 연결 함수 (향상된 진단 기능 포함)
 */
export async function connectBillAcceptor(): Promise<boolean> {
  try {
    logConnection("CONNECT_START", "지폐인식기 연결 시도 시작")

    // Clear previous logs
    connectionLog.length = 0
    commandLog.length = 0

    // Step 1: Diagnose port availability
    const portDiagnosis = await diagnosePort()
    if (!portDiagnosis.available && !portDiagnosis.permissions) {
      throw new Error("포트 진단 실패: " + portDiagnosis.details.join(", "))
    }

    // Step 2: If already connected, test the connection first
    if (billAcceptorPort && billAcceptorWriter && billAcceptorReader) {
      logConnection("EXISTING_CONNECTION", "기존 연결 테스트 중")
      const connectionTest = await checkConnection()
      if (connectionTest) {
        logConnection("EXISTING_CONNECTION", "기존 연결이 유효함")
        return true
      } else {
        logConnection("EXISTING_CONNECTION", "기존 연결이 무효함, 재연결 시도")
        await disconnectBillAcceptor()
      }
    }

    // Step 3: Request port from user
    logConnection("PORT_REQUEST", "사용자에게 포트 선택 요청")
    try {
      billAcceptorPort = await (navigator as any).serial.requestPort({
        // No filters for native COM ports - let user select any available port
      })
      logConnection("PORT_REQUEST", "포트가 선택됨")
    } catch (err) {
      logConnection("PORT_REQUEST", `사용자가 포트 선택을 취소: ${err}`)
      throw new Error("포트 선택이 취소되었습니다.")
    }

    // Step 4: Get port information
    try {
      lastConnectedPortInfo = billAcceptorPort.getInfo ? await billAcceptorPort.getInfo() : {}
      logConnection("PORT_INFO", `포트 정보: ${JSON.stringify(lastConnectedPortInfo)}`)
    } catch (err) {
      logConnection("PORT_INFO", `포트 정보 가져오기 실패: ${err}`)
    }

    // Step 5: Open the port with ONEPLUS specifications
    logConnection("PORT_OPEN", "포트 열기 시도")
    try {
      await billAcceptorPort.open({
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
          "\n\n해결 방법:\n1. 다른 프로그램이 COM4를 사용 중인지 확인\n2. 장치 관리자에서 COM4 상태 확인\n3. 브라우저를 관리자 권한으로 실행"
      } else if (err.toString().includes("Network error")) {
        errorMessage +=
          "\n\n해결 방법:\n1. COM4 포트 물리적 연결 확인\n2. 지폐인식기 전원 확인 (DC 12V/24V)\n3. RS-232 케이블 연결 확인"
      }

      throw new Error(errorMessage)
    }

    // Step 6: Set up the streams
    logConnection("STREAM_SETUP", "스트림 설정 중")
    try {
      const writableStream = billAcceptorPort.writable
      const readableStream = billAcceptorPort.readable

      if (!writableStream || !readableStream) {
        throw new Error("스트림을 가져올 수 없습니다")
      }

      billAcceptorWriter = writableStream.getWriter()
      billAcceptorReader = readableStream.getReader()
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
      await disconnectBillAcceptor()

      throw new Error(
        "지폐인식기와 통신할 수 없습니다.\n\n확인사항:\n" +
          "1. 지폐인식기 전원 상태 (DC 12V/24V)\n" +
          "2. RS-232 케이블 연결 (Pin 1: RX, Pin 2: TX, Pin 3: GND)\n" +
          "3. COM4 포트 설정 (9600-8-N-1)\n" +
          "4. 다른 프로그램의 COM4 사용 여부",
      )
    }

    // Step 10: 연결 성공 후 초기 설정 확인
    logConnection("CONFIG_CHECK", "초기 설정 확인")
    try {
      const config = await getConfig()
      if (config !== null) {
        const eventTxEnabled = (config & 0x20) !== 0
        logConnection("CONFIG_CHECK", `Event TX 모드: ${eventTxEnabled ? "활성화" : "비활성화"}`)

        // Event TX가 활성화되어 있으면 이벤트 처리 활성화
        if (eventTxEnabled) {
          setEventProcessing(true)
          logConnection("CONFIG_CHECK", "Event TX 모드 감지 - 이벤트 처리 활성화")
        }
      }
    } catch (error) {
      logConnection("CONFIG_CHECK", `설정 확인 실패: ${error}`)
    }

    logConnection("EVENT_SETUP", "이벤트 처리 활성화")
    setEventProcessing(true)

    logConnection("CONNECT_SUCCESS", "지폐인식기 연결 성공")
    return true
  } catch (error) {
    logConnection("CONNECT_ERROR", `연결 오류: ${error}`)
    await disconnectBillAcceptor()
    throw error
  }
}

/**
 * 지폐인식기 연결 해제 함수
 */
export async function disconnectBillAcceptor(): Promise<void> {
  try {
    logConnection("DISCONNECT_START", "지폐인식기 연결 해제 시작")

    // Stop stream reading first
    stopStreamReading()

    if (billAcceptorReader) {
      try {
        await billAcceptorReader.cancel()
        logConnection("DISCONNECT", "Reader 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Reader 해제 오류: ${err}`)
      }
      billAcceptorReader = null
    }

    if (billAcceptorWriter) {
      try {
        await billAcceptorWriter.close()
        logConnection("DISCONNECT", "Writer 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Writer 해제 오류: ${err}`)
      }
      billAcceptorWriter = null
    }

    if (billAcceptorPort) {
      try {
        await billAcceptorPort.close()
        logConnection("DISCONNECT", "Port 해제 완료")
      } catch (err) {
        logConnection("DISCONNECT", `Port 해제 오류: ${err}`)
      }
      billAcceptorPort = null
    }

    logConnection("DISCONNECT_SUCCESS", "지폐인식기 연결 해제 완료")
  } catch (error) {
    logConnection("DISCONNECT_ERROR", `연결 해제 중 오류: ${error}`)
  }
}

/**
 * 연결 확인 함수 (이벤트 메시지 기반 연결 확인 포함)
 */
export async function checkConnection(): Promise<boolean> {
  try {
    // 먼저 이벤트 메시지가 수신되고 있는지 확인
    if (lastEventMessage && Date.now() - new Date(lastEventMessage.timestamp).getTime() < 5000) {
      logDebug("최근 이벤트 메시지 수신으로 연결 확인됨")
      return true
    }

    const packet = createPacket(0x48, 0x69, 0x3f) // 'H' 'i' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x6d, 0x65, 500) // 'm' 'e' 응답 기대

    if (response && response.length === 5) {
      if (response[1] === 0x6d && response[2] === 0x65 && response[3] === 0x21) {
        // 'm' 'e' '!'
        logCommand("Check Connection", packet, response)
        return true
      }
    }

    // 일반 명령 응답이 없어도 이벤트 메시지가 계속 오면 연결된 것으로 판단
    if (lastEventMessage && Date.now() - new Date(lastEventMessage.timestamp).getTime() < 10000) {
      logDebug("이벤트 메시지 기반으로 연결 상태 확인")
      logCommand("Check Connection (Event Based)", packet, [], "이벤트 메시지로 연결 확인됨")
      return true
    }

    logCommand("Check Connection", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    // 오류가 발생해도 최근 이벤트 메시지가 있으면 연결된 것으로 판단
    if (lastEventMessage && Date.now() - new Date(lastEventMessage.timestamp).getTime() < 10000) {
      logDebug("오류 발생했지만 이벤트 메시지로 연결 확인됨")
      return true
    }

    logCommand("Check Connection", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 상태 확인 함수 (방어적 프로그래밍 적용)
 */
export async function getStatus(): Promise<number | null> {
  try {
    const packet = createPacket(0x47, 0x41, 0x3f) // 'G' 'A' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x67, 0x61) // 'g' 'a'

    if (response && response.length === 5) {
      if (response[1] === 0x67 && response[2] === 0x61) {
        // 'g' 'a'
        currentStatus = response[3]
        logCommand("Get Status", packet, response)
        return currentStatus
      }
    }

    logCommand("Get Status", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Status", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 지폐 데이터 확인 함수 (방어적 프로그래밍 적용)
 */
export async function getBillData(): Promise<number | null> {
  try {
    const packet = createPacket(0x47, 0x42, 0x3f) // 'G' 'B' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x67, 0x62) // 'g' 'b'

    if (response && response.length === 5) {
      if (response[1] === 0x67 && response[2] === 0x62) {
        // 'g' 'b'
        const billValue = response[3]
        logCommand("Get Bill Data", packet, response)
        return billValue
      }
    }

    logCommand("Get Bill Data", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Bill Data", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 설정 확인 함수 (방어적 프로그래밍 적용)
 */
export async function getConfig(): Promise<number | null> {
  try {
    const packet = createPacket(0x47, 0x43, 0x3f) // 'G' 'C' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x67, 0x63) // 'g' 'c'

    if (response && response.length === 5) {
      if (response[1] === 0x67 && response[2] === 0x63) {
        // 'g' 'c'
        logCommand("Get Config", packet, response)
        return response[3]
      }
    }

    logCommand("Get Config", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Config", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 에러 코드 확인 함수 (방어적 프로그래밍 적용)
 */
export async function getErrorCode(): Promise<number | null> {
  try {
    const packet = createPacket(0x47, 0x45, 0x3f) // 'G' 'E' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x67, 0x65) // 'g' 'e'

    if (response && response.length === 5) {
      if (response[1] === 0x67 && response[2] === 0x65) {
        // 'g' 'e'
        logCommand("Get Error Code", packet, response)
        return response[3]
      }
    }

    logCommand("Get Error Code", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Error Code", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 버전 확인 함수 (방어적 프로그래밍 적용)
 */
export async function getVersion(): Promise<{ major: number; minor: number } | null> {
  try {
    const packet = createPacket(0x47, 0x56, 0x3f) // 'G' 'V' '?'
    const response = await sendCommandAndWaitResponse(packet, 0x76, 0x00, 1000) // 'v' + any

    if (response && response.length === 5) {
      if (response[1] === 0x76) {
        // 'v'
        logCommand("Get Version", packet, response)
        return {
          major: response[2],
          minor: response[3],
        }
      }
    }

    logCommand("Get Version", packet, response || [], "예상되지 않은 응답")
    return null
  } catch (error) {
    logCommand("Get Version", [], undefined, `오류: ${error}`)
    return null
  }
}

/**
 * 지폐 수취 활성화 함수 (방어적 프로그래밍 적용)
 */
export async function enableAcceptance(): Promise<boolean> {
  try {
    const packet = createPacket(0x53, 0x41, 0x0d) // 'S' 'A' 0x0D
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b) // 'O' 'K'

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x61) {
        // 'O' 'K' 'a'
        isAcceptingBills = true
        logCommand("Enable Acceptance", packet, response)
        return true
      }
    }

    logCommand("Enable Acceptance", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Enable Acceptance", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 지폐 수취 비활성화 함수 (방어적 프로그래밍 적용)
 * $NGa 응답을 정상 거절로 처리
 */
export async function disableAcceptance(): Promise<boolean> {
  try {
    const packet = createPacket(0x53, 0x41, 0x0e) // 'S' 'A' 0x0E
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b) // 'O' 'K'

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x61) {
        // 'O' 'K' 'a'
        isAcceptingBills = false
        logCommand("Disable Acceptance", packet, response)
        return true
      }

      if (response[1] === 0x4e && response[2] === 0x47 && response[3] === 0x61) {
        // 'N' 'G' 'a'
        isAcceptingBills = false
        logCommand("Disable Acceptance", packet, response, "이미 입수금지 상태 (정상)")
        return true // 정상 거절도 성공으로 처리
      }
    }

    logCommand("Disable Acceptance", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Disable Acceptance", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 지폐 반환 함수 (방어적 프로그래밍 적용)
 */
export async function returnBill(): Promise<boolean> {
  try {
    const packet = createPacket(0x53, 0x41, 0x06) // 'S' 'A' 0x06
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b) // 'O' 'K'

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x61) {
        // 'O' 'K' 'a'
        logCommand("Return Bill", packet, response)
        return true
      }
    }

    logCommand("Return Bill", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Return Bill", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 지폐 적재 함수 (방어적 프로그래밍 적용)
 */
export async function stackBill(): Promise<boolean> {
  try {
    const packet = createPacket(0x53, 0x41, 0x09) // 'S' 'A' 0x09
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b) // 'O' 'K'

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x61) {
        // 'O' 'K' 'a'
        logCommand("Stack Bill", packet, response)
        return true
      }
    }

    logCommand("Stack Bill", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Stack Bill", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 설정 변경 함수 (방어적 프로그래밍 적용)
 */
export async function setConfig(config: number): Promise<boolean> {
  try {
    const packet = createPacket(0x53, 0x43, config) // 'S' 'C' CONFIG
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b) // 'O' 'K'

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x63) {
        // 'O' 'K' 'c'
        logCommand("Set Config", packet, response)
        return true
      }
    }

    logCommand("Set Config", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Set Config", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 디바이스 리셋 함수 (방어적 프로그래밍 적용)
 */
export async function resetDevice(): Promise<boolean> {
  try {
    const packet = createPacket(0x52, 0x53, 0x54) // 'R' 'S' 'T'
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b, 3000) // 'O' 'K', 3초 타임아웃

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b && response[3] === 0x61) {
        // 'O' 'K' 'a'
        logCommand("Reset Device", packet, response)
        return true
      }
    }

    logCommand("Reset Device", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Reset Device", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 디바이스 초기화 함수
 * 응답 수신 후 2500ms 대기하여 완전 초기화
 */
export async function initializeDevice(): Promise<boolean> {
  try {
    const packet = createPacket(0x52, 0x53, 0x54) // 'R' 'S' 'T'
    const response = await sendCommandAndWaitResponse(packet, 0x4f, 0x4b, 3000) // 'O' 'K', 3초 타임아웃

    if (response && response.length === 5) {
      if (response[1] === 0x4f && response[2] === 0x4b) {
        // 'O' 'K'
        logCommand("Initialize Device", packet, response)

        // 응답 수신 후 2500ms 대기 (완전 초기화 대기)
        logDebug("디바이스 완전 초기화 대기 중 (2500ms)...")
        await new Promise((resolve) => setTimeout(resolve, 2500))
        logDebug("디바이스 초기화 완료")

        return true
      }
    }

    logCommand("Initialize Device", packet, response || [], "예상되지 않은 응답")
    return false
  } catch (error) {
    logCommand("Initialize Device", [], undefined, `오류: ${error}`)
    return false
  }
}

/**
 * 지폐 수취 프로세스 함수 (방어적 프로그래밍 적용)
 */
export async function processBillAcceptance(): Promise<{ success: boolean; amount: number; error?: string }> {
  try {
    // 1. Enable acceptance
    const enabled = await enableAcceptance()
    if (!enabled) {
      return { success: false, amount: 0, error: "지폐 수취 활성화 실패" }
    }

    // 2. Wait for bill insertion and recognition
    let attempts = 0
    const maxAttempts = 60 // 30 seconds timeout (500ms intervals)

    while (attempts < maxAttempts) {
      const status = await getStatus()
      if (status === null) {
        return { success: false, amount: 0, error: "상태 확인 실패" }
      }

      // Check if bill is recognized and in escrow
      if (status === 0x05) {
        // RECOGNITION_END
        const billData = await getBillData()
        if (billData === null) {
          return { success: false, amount: 0, error: "지폐 데이터 확인 실패" }
        }

        // Convert bill data to amount
        let amount = 0
        switch (billData) {
          case 1:
            amount = 1000
            break
          case 5:
            amount = 5000
            break
          case 10:
            amount = 10000
            break
          case 50:
            amount = 50000
            break
          default:
            return { success: false, amount: 0, error: `알 수 없는 지폐 종류: ${billData}` }
        }

        // 3. Stack the bill
        const stacked = await stackBill()
        if (!stacked) {
          // Try to return the bill
          await returnBill()
          return { success: false, amount: 0, error: "지폐 적재 실패" }
        }

        // 4. Wait for stacking to complete
        let stackAttempts = 0
        while (stackAttempts < 20) {
          // 10 seconds timeout
          const stackStatus = await getStatus()
          if (stackStatus === 0x0b) {
            // STACK_END
            return { success: true, amount }
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
          stackAttempts++
        }

        return { success: false, amount: 0, error: "적재 완료 대기 타임아웃" }
      }

      // Check for errors
      if (status === 0x0c) {
        // ERROR_WAIT
        const errorCode = await getErrorCode()
        const errorMessage = errorCode !== null ? getErrorString(errorCode) : "알 수 없는 오류"
        return { success: false, amount: 0, error: `디바이스 오류: ${errorMessage}` }
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
      attempts++
    }

    // Timeout - disable acceptance
    await disableAcceptance()
    return { success: false, amount: 0, error: "지폐 수취 대기 타임아웃" }
  } catch (error) {
    await disableAcceptance()
    return { success: false, amount: 0, error: `프로세스 오류: ${error}` }
  }
}

/**
 * 이벤트 처리 활성화/비활성화
 */
export function setEventProcessing(enabled: boolean): void {
  eventProcessingEnabled = enabled
  logConnection("EVENT_PROCESSING", enabled ? "활성화됨" : "비활성화됨")
}

/**
 * 마지막 이벤트 메시지 가져오기
 */
export function getLastEventMessage(): { command: string; data: number; timestamp: string } | null {
  return lastEventMessage
}

/**
 * 연결 상태 확인 함수
 */
export function isBillAcceptorConnected(): boolean {
  return billAcceptorPort !== null && billAcceptorWriter !== null && billAcceptorReader !== null
}

/**
 * 현재 상태 정보 가져오기
 */
export function getBillAcceptorStatus(): {
  connected: boolean
  accepting: boolean
  currentStatus: number
  currentBillValue: number
} {
  return {
    connected: isBillAcceptorConnected(),
    accepting: isAcceptingBills,
    currentStatus,
    currentBillValue,
  }
}

/**
 * 명령어 로그 가져오기
 */
export function getBillAcceptorCommandLog(): Array<{
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
export function getBillAcceptorConnectionLog(): Array<{
  event: string
  details: string
  timestamp: string
}> {
  return [...connectionLog]
}

/**
 * 명령어 로그 지우기
 */
export function clearBillAcceptorCommandLog(): void {
  commandLog.length = 0
}

/**
 * 연결 로그 지우기
 */
export function clearBillAcceptorConnectionLog(): void {
  connectionLog.length = 0
}

/**
 * 포트 진단 정보 가져오기
 */
export async function getBillAcceptorDiagnostics(): Promise<{
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
    connectionLog: getBillAcceptorConnectionLog(),
    commandLog: getBillAcceptorCommandLog(),
  }
}

/**
 * 상태 코드를 문자열로 변환
 */
export function getStatusString(status: number): string {
  switch (status) {
    case 0x01:
      return "WAIT (대기)"
    case 0x02:
      return "START_WAIT (수취 준비)"
    case 0x05:
      return "RECOGNITION_END (인식 완료)"
    case 0x08:
      return "RETURN_END (반환 완료)"
    case 0x0b:
      return "STACK_END (적재 완료)"
    case 0x0c:
      return "ERROR_WAIT (오류 대기)"
    default:
      return `UNKNOWN (0x${status.toString(16)})`
  }
}

/**
 * 에러 코드를 문자열로 변환
 */
export function getErrorString(errorCode: number): string {
  switch (errorCode) {
    case 1:
      return "Start Sensor error"
    case 2:
      return "Shutter Sensor error"
    case 4:
      return "Transport Motor error"
    case 9:
      return "Suspected fraudulent activity"
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
      return `Main Sensor #${errorCode - 10} error`
    default:
      return `Unknown error (${errorCode})`
  }
}

/**
 * 이벤트 콜백 등록
 */
export function setEventCallback(callback: ((eventData: number) => void) | null): void {
  eventCallback = callback
  logDebug(`이벤트 콜백 ${callback ? "등록됨" : "해제됨"}`)
}
