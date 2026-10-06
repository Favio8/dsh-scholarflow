import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'

const source = readFileSync(new URL('../../dist/client.js', import.meta.url), 'utf8')

// The bundle is built with react, react-dom and @deepseek-ai/* external. This stub
// supplies exactly the host-provided React pair in CommonJS form, so any other
// specifier (a Node builtin, or a dependency that should have been bundled) fails
// the contract instead of silently resolving.
const require = createRequire(import.meta.url)
const externals = { react: require('react'), 'react-dom': require('react-dom') }

// Browser globals deliberately have no CommonJS module/exports. DSH supplies
// only require to the registered factory, then uses its return value.
function loadClient(platform) {
  let handoff
  const errors = []
  runInNewContext(source, {
    // micromark's browser entity decoder creates its DOM helper during import.
    // This contract checks factory/Slot boot only; actual decoding/selection is
    // exercised in real Chromium, rather than emulated by this VM stub.
    // KaTeX (bundled for the paper preview) reads compatMode at import time and
    // warns through console.warn in quirks mode, so the stub states standards mode
    // and carries the console methods a browser always provides.
    document: { compatMode: 'CSS1Compat', documentElement: { dataset: { platform } }, createElement(tag) { assert.equal(tag, 'i'); return { get textContent() { throw new Error('Entity decoding requires the real Chromium test') } } } },
    window: { __ModuleLoader__: { load(value) { handoff = value } }, addEventListener() {}, removeEventListener() {} },
    console: { log() {}, info() {}, debug() {}, warn() {}, error(...args) { errors.push(args) } },
  }, { filename: 'dist/client.js' })
  assert.equal(handoff.id, 'dsh-scholarflow')
  const plugin = handoff.factory((specifier) => {
    assert.ok(Object.hasOwn(externals, specifier), `client bundle requested an unexpected external module: ${specifier}`)
    return externals[specifier]
  })
  return { plugin, errors }
}

// The client declares every host service it needs up front; the wizard, preset list
// and scoped chat/selections added inputTriggers and conversation.
const EXPECTED_INJECT = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'layout',
  'sidebarRight', 'sidebarRightTabs', 'inputTriggers', 'conversation']

test('browser factory materializes without Node module or exports globals', () => {
  const { plugin } = loadClient()
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), EXPECTED_INJECT)
})

for (const platform of [undefined, 'win32']) test(`slot registrations use the DSH options/component contract (${platform ?? 'web'})`, () => {
  const { plugin, errors } = loadClient(platform)
  const cells = []
  const factories = [], types = []
  const disposers = []
  const observable = value => {
    const listeners = new Set()
    return { getSnapshot: () => value, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      set(next) { value = next; for (const listener of [...listeners]) listener() } }
  }
  const render = component => renderToStaticMarkup(externals.react.createElement(component, {
    renderSlot: () => null, renderFactorySlot: () => null, useSession: () => undefined,
    useWorkspaces: () => [], usePanelInfo: () => false, useTabInfo: () => ({ tab: { id: 'TEST_ONLY' } }),
  }))
  const host = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    uiSession: { adapter: { current: observable({ key: undefined }) } },
    uiWorkspace: { selection: { subscribe: () => () => {} }, openSession: async () => undefined },
    sessions: { list: observable({ byId: {} }), refresh: async () => undefined },
    layout: { panelInfo: observable({ activePanelId: null }), selectPanel: () => undefined },
    inputTriggers: { registerSource: () => () => undefined },
    conversation: { input: { for: () => ({ focus: () => undefined }) } },
    sidebarRight: { mounted: observable(undefined), openTabs: observable([]), closeIn: () => undefined, focus: () => undefined,
      openTab: () => undefined, isExpanded: () => false, toggleExpanded: () => undefined },
    sidebarRightTabs: { guide: () => [], subscribe: () => () => {}, register(definition) {
      types.push(definition); return () => { types.splice(types.indexOf(definition), 1) }
    } },
    effect(setup) {
      const dispose = setup()
      assert.equal(typeof dispose, 'function')
      disposers.push(dispose)
    },
    slots: {
      entries: () => [],
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
        if (options.name === 'scholarflow.project') {
          const entry = component({ useWorkspaces: () => [] })
          assert.equal(typeof entry.type.getDerivedStateFromError, 'function', 'project errors must be caught inside the Host Slot entry')
          assert.equal(entry.props.label, '项目面')
          assert.equal(typeof entry.props.onEscape, 'function')
        }
        const html = render(component)
        assert.equal(typeof html, 'string')
        const cell = { options, disposed: false }
        cells.push(cell)
        return () => { cell.disposed = true }
      },
    },
  }
  plugin.apply(host)
  assert.equal(errors.length, 0, 'slot errors must not be hidden by guards')
  // The top entry opens settings on every platform: a caption button on Windows, a
  // sidebar row plus its panel elsewhere. No cell registers the removed workbench entry.
  const platformCells = platform === 'win32'
    ? [['shell.overlay', 'scholarflow-caption']]
    : [['main', 'scholarflow-settings'], ['sidebar.panellist', 'scholarflow-settings']]
  assert.deepEqual(cells.map(({ options }) => [options.name, options.key ?? options.id]), [
    ['shell.overlay', 'scholarflow-new-session-notice'],
    ['scholarflow.project', undefined],
    ['sidebar.right.pane.tab', 'dsh-scholarflow/chat'],
    ['sidebar.right.pane.tab.title', 'dsh-scholarflow/chat'],
    ['sidebar.right.tab.guide.entry', 'dsh-scholarflow/chat'],
    ...platformCells,
    ['settings.section', 'scholarflow-settings'],
  ])
  assert.equal(factories.length, 1)
  // The scoped chat tab exists only while a ScholarFlow surface is active, so an
  // ordinary conversation never gains the entry (client-boot has no session yet).
  assert.deepEqual(types, [])
  const cellsBeforeActivation = cells.length
  host.uiSession.adapter.current.set({ key: 'ses_TEST_ONLY' })
  host.sessions.list.set({ byId: { ses_TEST_ONLY: { projectionValues: { agentPreset: 'scholarflow' } } } })
  assert.equal(types.length, 1, '进入 ScholarFlow 会话后必须注册聊天标签类型')
  assert.equal(types[0].kind, 'scholarflow-chat')
  assert.equal(types[0].keepMounted, true)
  assert.equal(types[0].guide[0].title(), 'AI Chat')
  assert.deepEqual(cells.slice(cellsBeforeActivation).map(({ options }) => [options.name, options.key, options.priority]),
    [['main', 'conversation', -50]], '只有显式打开的 ScholarFlow 会话才遮蔽 Conversation 主面板')
  for (const dispose of disposers.reverse()) dispose()
  assert.ok(cells.every((cell) => cell.disposed), 'disabling the plugin removes all owned cells')
  assert.equal(factories.length, 0)
  assert.equal(types.length, 0)
})
