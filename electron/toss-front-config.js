function enabled(env) {
  if (env.TOSS_FRONT_ENABLED) return env.TOSS_FRONT_ENABLED === 'true'
  // Existing kiosks predate the explicit switch and use pairing plus transport.
  return Boolean(env.TOSS_FRONT_PAIRING_KEY?.trim() &&
    (env.TOSS_FRONT_SERIAL_PATH?.trim() || env.TOSS_FRONT_WS_URL?.trim()))
}

module.exports = { enabled }
