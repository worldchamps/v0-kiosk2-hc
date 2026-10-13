const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')

test('B selects the Woosim image-and-cut script; Camp retains its GDI script; failure is never auto-retried', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8')
  const block = source.slice(source.indexOf('function printSam4sWithWindows'), source.indexOf('const usesWoosim ='))
  const calls = []; let exitCode = 0
  const context = { path, __dirname: path.join(__dirname, '../electron'), process: { env: {} }, Buffer, setTimeout, clearTimeout,
    spawn(_command, args, options) {
      calls.push({ args, options })
      const child = new EventEmitter()
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
      child.stdin.end = () => setImmediate(() => child.emit('close', exitCode))
      return child
    },
  }
  vm.runInNewContext(block, context)
  await context.printSam4sWithWindows('selected-Windows-queue', [{ text: 'TEST' }], 'woosim')
  await context.printSam4sWithWindows('selected-Windows-queue', [{ text: 'TEST' }])
  assert(calls[0].args.includes(path.join(context.__dirname, 'woosim-print.ps1')))
  assert(calls[1].args.includes(path.join(context.__dirname, 'sam4s-print.ps1')))
  assert(calls.every(c => c.options.windowsHide && c.args.at(-1) === 'selected-Windows-queue'))
  exitCode = 1
  await assert.rejects(context.printSam4sWithWindows('selected-Windows-queue', [], 'woosim'), /코드로 종료/)
  assert.equal(calls.length, 3)
})

test('Woosim GDI Korean rendering, bit order, 24-dot bands and a single cut validate without opening a printer', { skip: process.platform !== 'win32' }, () => {
  for (const system of ['System32', 'SysWOW64']) {
    const powershell = path.join(process.env.SystemRoot, system, 'WindowsPowerShell/v1.0/powershell.exe')
    if (!fs.existsSync(powershell)) continue
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, '../electron/woosim-print.ps1'), '-CheckOnly'], {
      encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, WOOSIM_CUT_FEED_MM: '12' },
    })
    assert.equal(result.status, 0, `${system}: ${result.stderr || result.error}`)
    assert.match(result.stdout, /WOOSIM RAW self-check passed:.*cut=1 \(no printer opened\)/)
  }
})
