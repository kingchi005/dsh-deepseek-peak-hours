import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

/**
 * Load the shipped Client module the way the browser loader does, then run its
 * `apply` against stub services. This catches a broken module id, a missing
 * export, a misplaced slot registration or a hard-coded color without needing a
 * browser or a React renderer.
 */
const clientPath = new URL('../client.js', import.meta.url)
const source = fs.readFileSync(clientPath, 'utf8')

let captured
const appended = []
const fakeDocument = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: (node) => appended.push(node) },
}
globalThis.document = fakeDocument
const sandbox = { window: { __ModuleLoader__: { load(spec) { captured = spec } } }, document: fakeDocument, console }
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

assert.ok(captured !== undefined, 'client.js registers through window.__ModuleLoader__')
assert.equal(captured.id, 'dsh-deepseek-peak-hours', 'module id equals the package name')

const fakeReact = {
  createElement: () => ({}),
  Fragment: Symbol('Fragment'),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
}
const fakeReactDom = { createPortal: () => ({}) }
const plugin = captured.factory((name) => {
  if (name === 'react') return fakeReact
  if (name === 'react-dom') return fakeReactDom
  throw new Error(`unexpected module request: ${name}`)
})

assert.equal(plugin.inject.join(','), 'slots,locale', 'client injects the slot and locale services')
assert.equal(typeof plugin.apply, 'function', 'client exports apply')

const registration = {}
const dictionaries = {}
const effects = []
const ctx = {
  effect(fn, label) {
    effects.push(label)
    return fn()
  },
  locale: {
    register(namespace, dicts) {
      dictionaries.namespace = namespace
      Object.assign(dictionaries, dicts)
      return () => {}
    },
  },
  slots: {
    inject(name, register) {
      registration.injectedSlot = name
      register()
    },
    register(definition, component) {
      registration.definition = definition
      registration.component = component
      return () => {}
    },
  },
}

plugin.apply(ctx)

assert.equal(registration.injectedSlot, 'conversation.composer.dock', 'registers into the composer dock slot')
assert.equal(JSON.stringify(registration.definition), JSON.stringify({ name: 'conversation.composer.dock', id: 'deepseek-peak-hours', order: 5 }), 'slot definition carries name, id and order')
assert.equal(typeof registration.component, 'function', 'slot entry is a component factory')
assert.deepEqual(effects, ['deepseek-peak-hours: styles', 'deepseek-peak-hours: dictionaries'], 'styles and dictionaries are owned effects')

assert.equal(appended.length, 1, 'one style element is appended')
assert.equal(appended[0].dataset.plugin, 'dsh-deepseek-peak-hours', 'style element is scoped to the plugin')
assert.ok(appended[0].textContent.includes('.dsph-pill'), 'style sheet carries the pill rules')
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(appended[0].textContent), 'styles use theme tokens, not literal hex colors')
assert.ok(!/rgba?\(/i.test(appended[0].textContent), 'styles use theme tokens, not literal rgb colors')

assert.equal(dictionaries.namespace, 'deepseek-peak-hours', 'dictionary namespace matches the plugin')
for (const language of ['en', 'zh']) {
  assert.ok(dictionaries[language] !== undefined, `${language} dictionary is registered`)
  for (const key of ['statusPeak', 'statusOffPeak', 'peakIn', 'offPeakIn', 'localSchedule', 'holidayUnknown', 'perMillion']) {
    assert.equal(typeof dictionaries[language][key], 'string', `${language}.${key} is a string`)
  }
  assert.equal(Object.keys(dictionaries[language]).sort().join(','), Object.keys(dictionaries.en).sort().join(','), `${language} dictionary covers every English key`)
}

console.log('ok - client module loads, registers and styles correctly')
