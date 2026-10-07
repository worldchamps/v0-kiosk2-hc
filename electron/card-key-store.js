const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// No plaintext files, export endpoint or renderer-facing card data.
function createCardKeyStore({ directory, safeStorage }) {
  function prepare() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('card_encryption_unavailable')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('card_store_invalid')
  }
  function filename(id) {
    if (!/^(?:profile|room-[ACD]\d{3}|operation-[a-f0-9]{64})$/.test(id)) throw new Error('card_record_invalid')
    return path.join(directory, id + '.bin')
  }
  function read(id) {
    prepare()
    const file = filename(id)
    let stat
    try { stat = fs.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error('card_store_invalid')
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))
  }
  function write(id, value) {
    prepare()
    const file = filename(id)
    const plain = JSON.stringify(value)
    if (Buffer.byteLength(plain) > 64 * 1024) throw new Error('card_record_invalid')
    const encrypted = safeStorage.encryptString(plain)
    const temporary = path.join(directory, randomUUID() + '.tmp')
    let fd
    try {
      fd = fs.openSync(temporary, 'wx', 0o600)
      fs.writeFileSync(fd, encrypted)
      fs.fsyncSync(fd)
      fs.closeSync(fd); fd = undefined
      if (safeStorage.decryptString(fs.readFileSync(temporary)) !== plain) throw new Error('card_store_verification_failed')
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('card_store_invalid')
      fs.renameSync(temporary, file)
      if (JSON.stringify(read(id)) !== plain) throw new Error('card_store_verification_failed')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  function list() {
    prepare()
    return fs.readdirSync(directory).filter(name => /^room-[ACD]\d{3}\.bin$/.test(name)).sort().map(name => {
      const record = read(name.slice(0, -4))
      if (record?.room !== name.slice(5, -4) || typeof record.registeredAt !== 'string') throw new Error('card_record_invalid')
      return { room: record.room, registeredAt: record.registeredAt }
    })
  }
  return { read, write, list }
}

module.exports = { createCardKeyStore }
