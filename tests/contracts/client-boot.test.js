import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../../src/client/index.js', import.meta.url), 'utf8')

// Browser globals deliberately have no CommonJS module/exports. DSH supplies
// only require to the registered factory, then uses its return value.
function loadClient() {
  let handoff
  const errors = []
  const react = {
    createElement(type, props, ...children) {
      return { $$typeof: Symbol.for('react.transitional.element'), type, props: { ...props, children } }
    },
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console: { log() {}, error(...args) { errors.push(args) } },
  }, { filename: 'src/client/index.js' })
  assert.equal(handoff.id, 'dsh-scholarflow')
  const plugin = handoff.factory((specifier) => {
    assert.equal(specifier, 'react')
    return react
  })
  return { plugin, errors }
}

test('browser factory materializes without Node module or exports globals', () => {
  const { plugin } = loadClient()
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
})

test('slot registrations use the DSH options/component contract and React output', () => {
  const { plugin, errors } = loadClient()
  const cells = []
  const disposers = []
  plugin.apply({
    effect(setup) {
      const dispose = setup()
      assert.equal(typeof dispose, 'function')
      disposers.push(dispose)
    },
    slots: {
      inject(name, setup) {
        return setup()
      },
      register(options, component) {
        assert.equal(typeof component, 'function', 'component must be the second argument')
        assert.equal('component' in options, false)
        const tree = component()
        assert.equal(tree.$$typeof, Symbol.for('react.transitional.element'))
        assert.equal(typeof tree.type, 'string')
        const cell = { options, disposed: false }
        cells.push(cell)
        return () => { cell.disposed = true }
      },
    },
  })
  assert.equal(errors.length, 0, 'slot errors must not be hidden by guards')
  assert.deepEqual(cells.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['main', 'scholarflow'],
    ['sidebar.panellist', 'scholarflow'],
    ['settings.section', 'scholarflow-settings'],
  ])
  for (const dispose of disposers.reverse()) dispose()
  assert.ok(cells.every((cell) => cell.disposed), 'disabling the plugin removes all three cells')
})
