import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const source = readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8')

// Browser globals deliberately have no CommonJS module/exports. DSH supplies
// only require to the registered factory, then uses its return value.
function loadClient(platform) {
  let handoff
  const errors = []
  runInNewContext(source, {
    // micromark's browser entity decoder creates its DOM helper during import.
    // This contract checks factory/Slot boot only; actual decoding/selection is
    // exercised in real Chromium, rather than emulated by this VM stub.
    document: { documentElement: { dataset: { platform } }, createElement(tag) { assert.equal(tag, 'i'); return { get textContent() { throw new Error('Entity decoding requires the real Chromium test') } } } },
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
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'layout', 'sidebarRight', 'sidebarRightTabs'])
})

for (const platform of [undefined, 'win32']) test(`slot registrations use the DSH options/component contract (${platform ?? 'web'})`, () => {
  const { plugin, errors } = loadClient(platform)
  const cells = []
  const factories = [], types = []
  const disposers = []
  const observable = value => ({ getSnapshot: () => value, subscribe: () => () => {} })
  const render = component => renderToStaticMarkup(React.createElement(component, {
    renderSlot: () => null, renderFactorySlot: () => null, useSession: () => undefined,
    useWorkspaces: () => [], usePanelInfo: () => false, useTabInfo: () => ({ tab: { id: 'TEST_ONLY' } }),
  }))
  plugin.apply({
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    uiSession: { adapter: { current: observable({ key: undefined }) } },
    layout: { panelInfo: observable({ activePanelId: null }) },
    sidebarRight: { mounted: observable(undefined), openTabs: observable([]) },
    sidebarRightTabs: { guide: () => [], subscribe: () => () => {}, register(definition) {
      types.push(definition); return () => { types.splice(types.indexOf(definition), 1) }
    } },
    effect(setup) {
      const dispose = setup()
      assert.equal(typeof dispose, 'function')
      disposers.push(dispose)
    },
    slots: {
      entriesOfSlot: () => [],
      subscribe: () => () => {},
      registerFactory(definition, component) {
        assert.equal(definition.name, 'scholarflow.workspace')
        assert.equal(definition.scope, 'session-maybe')
        assert.equal(definition.children['scholarflow.project'].scope, 'session-maybe')
        assert.equal(typeof render(component), 'string')
        factories.push(definition); return () => { factories.splice(factories.indexOf(definition), 1) }
      },
      inject(name, setup) {
        const result = setup()
        if (typeof result === 'function') return result
        const nested = Array.from(result)
        return () => nested.reverse().forEach(dispose => dispose())
      },
      register(options, component) {
        assert.equal(typeof component, 'function', 'component must be the second argument')
        assert.equal('component' in options, false)
        const html = render(component)
        assert.equal(typeof html, 'string')
        const cell = { options, disposed: false }
        cells.push(cell)
        return () => { cell.disposed = true }
      },
    },
  })
  assert.equal(errors.length, 0, 'slot errors must not be hidden by guards')
  assert.deepEqual(cells.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['scholarflow.project', undefined],
    ['main', 'scholarflow'],
    ['sidebar.right.pane.tab', 'dsh-scholarflow/chat'],
    ['sidebar.right.pane.tab.title', 'dsh-scholarflow/chat'],
    ['sidebar.right.tab.guide.entry', 'dsh-scholarflow/chat'],
    platform === 'win32' ? ['shell.overlay', 'scholarflow-caption'] : ['sidebar.panellist', 'scholarflow'],
    ['settings.section', 'scholarflow-settings'],
  ])
  assert.equal(factories.length, 1)
  assert.equal(types[0].kind, 'scholarflow-chat')
  assert.equal(types[0].keepMounted, true)
  assert.equal(types[0].guide[0].title(), 'AI Chat')
  for (const dispose of disposers.reverse()) dispose()
  assert.ok(cells.every((cell) => cell.disposed), 'disabling the plugin removes all owned cells')
  assert.equal(factories.length, 0)
  assert.equal(types.length, 0)
})
