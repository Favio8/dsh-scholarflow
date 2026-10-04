/**
 * dsh-scholarflow - client (browser) half, G0 verification stage.
 *
 * SHAPE: a bundled DSH client half is loaded through `window.__ModuleLoader__.load`,
 * not as a plain ES module. This exact wrapper is copied from a working third-party
 * client half on this machine (`@dsh-external/dsh-super-injector`'s
 * `lib/client.js`), because the wrapper format is only observable by example here.
 *
 * SCOPE: this file proves the G0-04 and G0-05 extension points:
 *   - `main` (keyed)            -> the ScholarFlow workspace panel
 *   - `sidebar.panellist`       -> its sidebar entry
 *   - `settings.section`        -> the ScholarFlow settings page
 *
 * It deliberately uses plain DOM inside its OWN slot cells. It does not query the
 * host's private DOM, does not read or reorder host components, and its CSS is
 * scoped under `.sf-` prefixes. No product feature is implemented here: the panel
 * shows an honest "skeleton only" state.
 *
 * Every registration is individually guarded so one wrong assumption cannot take
 * the whole client half down silently.
 */

window.__ModuleLoader__.load({
  id: 'dsh-scholarflow',
  factory: (require) => {
    const inject = ['slots']

    const PANEL_KEY = 'scholarflow'
    const SETTINGS_ID = 'scholarflow-settings'
    const SIDEBAR_ID = 'scholarflow'

    // Scoped to our own classes only; no host selector is touched.
    const CSS = `
.sf-panel{font-family:inherit;padding:18px 20px;max-width:760px;color:var(--theme-text,inherit)}
.sf-panel h2{margin:0 0 6px;font-size:16px;font-weight:650}
.sf-panel h3{margin:18px 0 6px;font-size:13px;font-weight:600;opacity:.85}
.sf-panel p{margin:0 0 10px;font-size:12px;line-height:1.65;opacity:.8}
.sf-badge{display:inline-block;font-size:10px;padding:2px 7px;border-radius:10px;
  border:1px solid var(--theme-border,#555);opacity:.8;margin-bottom:12px}
.sf-list{margin:0;padding-left:18px;font-size:12px;line-height:1.7;opacity:.85}
.sf-row{display:flex;gap:8px;align-items:center;margin:6px 0;font-size:12px}
.sf-row input{flex:1;max-width:260px;padding:4px 7px;font-size:12px;border-radius:6px;
  border:1px solid var(--theme-border,#555);background:var(--theme-input-bg,transparent);
  color:var(--theme-text,inherit)}
.sf-side{display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 6px}
`
    const STYLE_ID = 'dsh-scholarflow-style'

    function ensureStyle(doc) {
      if (doc.getElementById(STYLE_ID)) return
      const style = doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      doc.head.append(style)
    }

    function el(doc, tag, cls, text) {
      const node = doc.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined) node.textContent = text
      return node
    }

    /** The 'skeleton only' statement is deliberate: nothing here is a product claim. */
    function workspacePanel(doc) {
      return {
        render() {
          ensureStyle(doc)
          const root = el(doc, 'div', 'sf-panel')
          root.append(el(doc, 'span', 'sf-badge', 'G0 骨架 · 非产品功能'))
          root.append(el(doc, 'h2', null, 'ScholarFlow 工作台'))
          root.append(
            el(
              doc,
              'p',
              null,
              '此面板仅用于验证「专属工作台 + Agent 面板可同时存在，且原侧栏不受影响」。' +
                '论文项目、资料、证据、大纲、初稿、Review 与导出均尚未实现。',
            ),
          )
          const checks = el(doc, 'ul', 'sf-list')
          for (const line of [
            '工作台占用 main 座位的一个自有 key，不使用 DOM 劫持。',
            '右侧 Agent 面板仍是宿主原有的会话表面。',
            '左侧栏由 DSH 继续拥有。',
          ]) {
            checks.append(el(doc, 'li', null, line))
          }
          root.append(checks)
          return { dispose() {} }
        },
      }
    }

    function sidebarEntry(doc) {
      return {
        render() {
          const root = el(doc, 'span', 'sf-side')
          root.append(el(doc, 'span', null, 'ScholarFlow'))
          return { dispose() {} }
        },
      }
    }

    /**
     * G0-05 path B: a plugin-owned settings page reachable from Settings even when
     * no Config-derived namespace is projected. It edits nothing yet.
     */
    function settingsPage(doc) {
      return {
        render() {
          ensureStyle(doc)
          const root = el(doc, 'div', 'sf-panel')
          root.append(el(doc, 'h2', null, 'ScholarFlow 设置'))
          root.append(
            el(
              doc,
              'p',
              null,
              'G0 验证页：用于确认「设置页可显示本插件自有内容」。真实设置项（默认项目类型、' +
                '学术 Skill 库、Writing Profile、检索来源、存储与诊断）尚未实现。',
            ),
          )
          const row = el(doc, 'div', 'sf-row')
          const input = el(doc, 'input')
          input.setAttribute('disabled', 'disabled')
          input.placeholder = 'M1 才提供可编辑设置项'
          row.append(el(doc, 'span', null, '新建项目默认类型'), input)
          root.append(row)
          return { dispose() {} }
        },
      }
    }

    function guard(label, register) {
      try {
        register()
        console.log(`[scholarflow] registered ${label}`)
      } catch (error) {
        console.error(`[scholarflow] failed to register ${label}`, error)
      }
    }

    function apply(ctx) {
      const doc = document

      guard('main panel', () => {
        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register({
                name: 'main',
                key: PANEL_KEY,
                component: () => workspacePanel(doc),
              }),
            ),
          'scholarflow: main panel',
        )
      })

      guard('sidebar entry', () => {
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({
                name: 'sidebar.panellist',
                id: SIDEBAR_ID,
                order: 50,
                label: () => 'ScholarFlow',
                component: () => sidebarEntry(doc),
              }),
            ),
          'scholarflow: sidebar entry',
        )
      })

      guard('settings page', () => {
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register({
                name: 'settings.section',
                id: SETTINGS_ID,
                order: 50,
                label: () => 'ScholarFlow',
                component: () => settingsPage(doc),
              }),
            ),
          'scholarflow: settings page',
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
