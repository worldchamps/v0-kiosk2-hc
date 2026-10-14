const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { view } = require('../electron/device-settings')

function screen(config) {
  const states = [], saved = []
  let cursor = 0
  const jsx = (type, props) => ({ type, props })
  const dependencies = {
    react: { useState: initial => {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/contexts/admin-context': { useAdmin: () => ({ password: 'synthetic-admin' }) },
    '@/components/ui/button': { Button: 'Button' }, '@/components/ui/input': { Input: 'Input' },
  }
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/device-settings.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: module.exports, require: name => { assert(name in dependencies); return dependencies[name] },
    window: { electronAPI: { deviceSettings: {
      read: async password => { assert.equal(password, 'synthetic-admin'); return { success: true, ...view(config), serialPorts: [], printers: [] } },
      save: async input => { saved.push(input); return { success: true, restartRequired: true } },
    } } } })
  const render = () => { cursor = 0; return module.exports.default() }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return []
    const children = node.props?.children
    return [...(predicate(node) ? [node] : []), ...(Array.isArray(children) ? children : [children]).flatMap(child => find(child, predicate))]
  }
  return { render, saved, find }
}

test('administrator sees only same-property building choices and changing B to A retains Woosim fields', async () => {
  for (const [property, building, options] of [
    ['property3', 'B', ['A', 'B']], ['property1', '', ['', 'C', 'D']],
    ['property4', '', null], ['property2', '', null],
  ]) {
    const h = screen({ property, env: { KIOSK_BUILDING: building } })
    await h.find(h.render(), node => node.type === 'Button')[0].props.onClick()
    const select = h.find(h.render(), node => node.type === 'select' && node.props.value === building)[0]
    if (!options) { assert.equal(select, undefined); continue }
    assert.deepEqual(h.find(select, node => node.type === 'option').map(node => node.props.value), options)
    const next = property === 'property3' ? 'A' : 'C'
    select.props.onChange({ target: { value: next } })
    const rendered = h.render()
    assert.match(JSON.stringify(rendered), /변경하면 키오스크가 다시 시작됩니다/)
    if (property === 'property3') {
      assert.match(JSON.stringify(rendered), /WOOSIM/)
      assert.doesNotMatch(JSON.stringify(rendered), /SNR-K750L|Bixolon 프린터/)
    }
    await h.find(rendered, node => node.type === 'Button' && node.props.children === '장비 설정 저장')[0].props.onClick()
    assert.equal(h.saved[0].values.building, next)
    assert.equal(h.saved[0].password, 'synthetic-admin')
    assert.equal('property' in h.saved[0].values, false)
    assert.match(JSON.stringify(h.render()), /키오스크가 다시 시작됩니다/)
  }
})
