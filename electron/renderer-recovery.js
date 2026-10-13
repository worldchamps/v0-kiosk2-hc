function attachRendererRecovery(window, { startUrl, onFault = code => console.error(`[UI_RECOVERY] ${code}`),
  setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout } = {}) {
  const contents = window.webContents
  let retryTimer = null, hangTimer = null, stableTimer = null, attempts = 0, retryReason = null, forcedCrash = false
  const alive = () => !window.isDestroyed() && !contents.isDestroyed()
  const retry = code => {
    if (!alive() || retryTimer !== null) return
    if (stableTimer !== null) { cancel(stableTimer); stableTimer = null }
    onFault(code)
    retryReason = code
    const delay = [1000, 5000, 15000, 30000, 60000][Math.min(attempts++, 4)]
    retryTimer = schedule(() => {
      retryTimer = null
      if (!alive()) return
      if (code === 'ui_unresponsive') {
        forcedCrash = true
        contents.forcefullyCrashRenderer()
      }
      // Loading the entry URL preserves the payment journal and leaves failed admin screens.
      window.loadURL(startUrl).catch(() => retry('ui_load_failed'))
    }, delay)
    retryTimer?.unref?.()
  }
  contents.on('render-process-gone', () => {
    if (forcedCrash) { forcedCrash = false; return }
    retry('ui_renderer_gone')
  })
  window.on('unresponsive', () => {
    if (hangTimer !== null) return
    hangTimer = schedule(() => { hangTimer = null; retry('ui_unresponsive') }, 10000)
    hangTimer?.unref?.()
  })
  window.on('responsive', () => {
    if (hangTimer !== null) { cancel(hangTimer); hangTimer = null }
    if (retryReason === 'ui_unresponsive' && retryTimer !== null) { cancel(retryTimer); retryTimer = null }
  })
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) retry('ui_load_failed')
  })
  contents.on('did-finish-load', () => {
    forcedCrash = false
    if (retryTimer !== null) { cancel(retryTimer); retryTimer = null }
    if (hangTimer !== null) { cancel(hangTimer); hangTimer = null }
    if (stableTimer !== null) cancel(stableTimer)
    stableTimer = schedule(() => { attempts = 0; stableTimer = null }, 60000)
    stableTimer?.unref?.()
  })
  window.once('closed', () => {
    for (const timer of [retryTimer, hangTimer, stableTimer]) if (timer !== null) cancel(timer)
    retryTimer = hangTimer = stableTimer = null
  })
}

module.exports = { attachRendererRecovery }
