const PORT = /^COM[1-9]\d{0,2}$/i
const FIELDS = [
  'tossTransport', 'tossSerialPath', 'tossSerialBaudRate', 'tossWsUrl', 'tossPairingKey',
  'printerPort', 'acceptorPort', 'dispenserPort', 'bac2400Port', 'sam4sPrinterName', 'woosimPrinterName',
]

function view(config) {
  const env = config.env || {}
  return {
    property: config.property,
    building: config.property === 'property3' ? env.KIOSK_BUILDING || '' : '',
    pairingKeySet: Boolean(env.TOSS_FRONT_PAIRING_KEY),
    values: {
      tossTransport: env.TOSS_FRONT_TRANSPORT || 'auto',
      tossSerialPath: env.TOSS_FRONT_SERIAL_PATH || '',
      tossSerialBaudRate: env.TOSS_FRONT_SERIAL_BAUD_RATE || '115200',
      tossWsUrl: env.TOSS_FRONT_WS_URL || '',
      tossPairingKey: '',
      printerPort: env.PRINTER_PORT || env.PRINTER_PATH || 'COM2',
      acceptorPort: env.ACCEPTOR_PORT || 'COM4',
      dispenserPort: env.DISPENSER_PORT || 'COM5',
      bac2400Port: env.BAC2400_PORT || env.BOARD3400_PORT || 'COM5',
      sam4sPrinterName: env.SAM4S_PRINTER_NAME || '',
      woosimPrinterName: env.WOOSIM_PRINTER_NAME || '',
    },
  }
}

function updatedConfig(config, input) {
  if (!config?.registered || !/^property[1-4]$/.test(config.property || '')) throw new Error('등록된 키오스크 설정을 확인할 수 없습니다.')
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !FIELDS.includes(key)) || FIELDS.some(key => typeof input[key] !== 'string')) {
    throw new Error('장비 설정 형식이 올바르지 않습니다.')
  }
  const values = Object.fromEntries(FIELDS.map(key => [key, input[key].trim()]))
  if (FIELDS.some(key => values[key].length > 256 || /[\r\n\0]/.test(values[key]))) throw new Error('장비 설정 값이 너무 길거나 올바르지 않습니다.')
  if (!['auto', 'serial', 'websocket'].includes(values.tossTransport)) throw new Error('토스 프론트 연결 방식을 확인해주세요.')
  const portKeys = config.property === 'property4' ? ['bac2400Port']
    : config.property === 'property2' ? []
    : config.property === 'property3' && config.env?.KIOSK_BUILDING === 'B' ? ['acceptorPort', 'dispenserPort']
    : ['printerPort', 'acceptorPort', 'dispenserPort']
  for (const key of [...portKeys, ...(values.tossSerialPath ? ['tossSerialPath'] : [])]) {
    if (!PORT.test(values[key])) throw new Error('COM 포트는 COM1부터 COM999까지 입력해주세요.')
    values[key] = values[key].toUpperCase()
  }
  const ports = [...portKeys.map(key => values[key]), ...(values.tossSerialPath ? [values.tossSerialPath] : [])]
  if (new Set(ports).size !== ports.length) throw new Error('서로 다른 장비에 동일한 COM 포트를 지정할 수 없습니다.')
  if (!/^\d{1,6}$/.test(values.tossSerialBaudRate) || !Number.isInteger(Number(values.tossSerialBaudRate)) ||
    Number(values.tossSerialBaudRate) < 1200 || Number(values.tossSerialBaudRate) > 921600) {
    throw new Error('토스 프론트 통신 속도를 확인해주세요.')
  }
  if (values.tossWsUrl) {
    let address
    try { address = new URL(values.tossWsUrl) } catch { throw new Error('토스 프론트 주소는 ws:// 또는 wss:// 형식으로 입력해주세요.') }
    if (!['ws:', 'wss:'].includes(address.protocol) || address.username || address.password) {
      throw new Error('토스 프론트 주소는 ws:// 또는 wss:// 형식으로 입력해주세요.')
    }
  }
  if (values.tossTransport === 'serial' && !values.tossSerialPath) throw new Error('토스 프론트 시리얼 COM 포트를 선택해주세요.')
  if (values.tossTransport === 'websocket' && !values.tossWsUrl) throw new Error('토스 프론트 WebSocket 주소를 입력해주세요.')
  if (values.tossPairingKey && (values.tossPairingKey.length < 16 || values.tossPairingKey.length > 128)) {
    throw new Error('새 페어링 키는 16~128자로 입력해주세요.')
  }
  const pairingKey = values.tossPairingKey || config.env?.TOSS_FRONT_PAIRING_KEY || ''
  if ((values.tossTransport === 'serial' || values.tossTransport === 'websocket' ||
    values.tossSerialPath || values.tossWsUrl) && !pairingKey) {
    throw new Error('토스 프론트 페어링 키를 입력해주세요.')
  }
  const env = { ...config.env,
    TOSS_FRONT_TRANSPORT: values.tossTransport,
    TOSS_FRONT_SERIAL_PATH: values.tossSerialPath,
    TOSS_FRONT_SERIAL_BAUD_RATE: String(Number(values.tossSerialBaudRate)),
    TOSS_FRONT_WS_URL: values.tossWsUrl,
  }
  if (values.tossPairingKey) env.TOSS_FRONT_PAIRING_KEY = values.tossPairingKey
  if (config.property === 'property4') {
    env.BAC2400_PORT = values.bac2400Port
    env.SAM4S_PRINTER_NAME = values.sam4sPrinterName
  } else if (config.property !== 'property2') {
    if (config.property === 'property3' && config.env?.KIOSK_BUILDING === 'B') env.WOOSIM_PRINTER_NAME = values.woosimPrinterName
    else { env.PRINTER_PORT = values.printerPort; env.PRINTER_PATH = values.printerPort }
    env.ACCEPTOR_PORT = values.acceptorPort
    env.DISPENSER_PORT = values.dispenserPort
  }
  return { ...config, env }
}

function createDeviceSettings({ enabled, authorize, readConfig, writeConfig, listPorts, listPrinters }) {
  const access = (event, password) => {
    if (!enabled()) throw new Error('설치형 키오스크에서만 장비를 등록할 수 있습니다.')
    const result = authorize(event, password)
    if (!result.success) throw new Error(result.error || '관리자 인증이 필요합니다.')
  }
  const failed = error => ({ success: false, error: error instanceof Error ? error.message : '장비 설정을 저장하지 못했습니다.' })
  return {
    async read(event, password) {
      try {
        access(event, password)
        const config = readConfig()
        if (!config?.registered) throw new Error('등록된 키오스크 설정을 확인할 수 없습니다.')
        const [ports, printers] = await Promise.all([
          listPorts().catch(() => []), listPrinters(event).catch(() => []),
        ])
        return { success: true, ...view(config),
          serialPorts: ports.map(port => ({ path: port.path, manufacturer: port.manufacturer || '' })),
          printers: printers.map(printer => ({ name: printer.name, displayName: printer.displayName || printer.name })),
        }
      } catch (error) { return failed(error) }
    },
    save(event, input) {
      try {
        access(event, input?.password)
        const config = readConfig()
        const next = updatedConfig(config, input?.values)
        writeConfig(next)
        return { success: true, restartRequired: true }
      } catch (error) { return failed(error) }
    },
  }
}

module.exports = { view, updatedConfig, createDeviceSettings }
