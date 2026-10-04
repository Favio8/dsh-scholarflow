import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const source = readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8')

// Browser globals deliberately have no CommonJS module/exports. DSH supplies
// only require to the registered factory, then uses its return value.
function loadClient() {
  let handoff
  const errors = []
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { handoff = value } } },
    console: { log() {}, error(...args) { errors.push(args) } },
  }, { filename: 'dist/client.js' })
  assert.equal(handoff.id, 'dsh-scholarflow')
  const plugin = handoff.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })
  return { plugin, errors }
}

test('browser factory materializes without Node module or exports globals', () => {
  const { plugin } = loadClient()
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'layout'])
})

test('slot registrations use the DSH options/component contract and React output', () => {
  const { plugin, errors } = loadClient()
  const cells = []
  const disposers = []
  plugin.apply({
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    effect(setup) {
      const dispose = setup()
      assert.equal(typeof dispose, 'function')
      disposers.push(dispose)
    },
    slots: {
      inject(name, setup) {
        const result = setup()
        if (typeof result === 'function') return result
        const nested = Array.from(result)
        return () => nested.reverse().forEach(dispose => dispose())
      },
      register(options, component) {
        assert.equal(typeof component, 'function', 'component must be the second argument')
        assert.equal('component' in options, false)
        const html = renderToStaticMarkup(React.createElement(component, {
          renderSlot: () => null, renderFactorySlot: () => null, useSession: () => undefined,
          useWorkspaces: () => ({ items: [] }).items,
        }))
        assert.equal(typeof html, 'string')
        const cell = { options, disposed: false }
        cells.push(cell)
        return () => { cell.disposed = true }
      },
    },
  })
  assert.equal(errors.length, 0, 'slot errors must not be hidden by guards')
  assert.deepEqual(cells.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['main', 'scholarflow'],
    ['scholarflow.agent', undefined],
    ['scholarflow.project', undefined],
    ['sidebar.panellist', 'scholarflow'],
    ['settings.section', 'scholarflow-settings'],
  ])
  for (const dispose of disposers.reverse()) dispose()
  assert.ok(cells.every((cell) => cell.disposed), 'disabling the plugin removes all three cells')
})
