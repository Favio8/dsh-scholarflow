import React from 'react'

/**
 * Keeps one failing surface from blanking the whole pane.
 *
 * The project surface replaces the Host's conversation slot, so an exception anywhere inside it
 * used to unmount the subtree and leave an empty main area: no message, no way back, and nothing
 * in the console the user could report. This renders the failure instead, names it, and offers a
 * retry that remounts the children.
 */
export class SurfaceBoundary extends React.Component<{ label: string; children: React.ReactNode; onEscape?: () => void },
  { error?: Error; attempt: number }> {
  state: { error?: Error; attempt: number } = { attempt: 0 }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // The console line is the reportable artifact: it names the component stack, which the
    // rendered message cannot carry.
    console.error(`ScholarFlow ${this.props.label} 渲染失败：`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="sf-boundary" role="alert">
      <h3>ScholarFlow 界面出错了</h3>
      <p>这一部分没能渲染。可以重试；如果一直失败，用下面的按钮交还给普通对话，输入框和模型都能照常用。</p>
      <pre>{this.state.error.message || String(this.state.error)}</pre>
      <div className="sf-boundary-actions">
        <button onClick={() => this.setState(state => ({ error: undefined, attempt: state.attempt + 1 }))}>重试</button>
        {this.props.onEscape && <button className="sf-boundary-escape" onClick={() => { this.setState({ error: undefined }); this.props.onEscape!() }}>返回普通对话</button>}
      </div>
    </div>
  }
}

export const SURFACE_BOUNDARY_CSS = `
.sf-boundary{max-width:640px;margin:var(--sf-space-8) auto;padding:var(--sf-space-5);border:1px solid var(--sf-danger-border);border-radius:var(--sf-radius-xl);background:var(--dsw-alias-bg-base,var(--sf-surface));font-size:var(--sf-font-lg);line-height:var(--sf-leading-prose)}
.sf-boundary h3{margin:0 0 var(--sf-space-2);font-size:var(--sf-font-xl)}
.sf-boundary p{margin:0 0 var(--sf-space-3);color:var(--dsw-alias-label-secondary,var(--sf-muted))}
.sf-boundary pre{margin:0 0 var(--sf-space-4);padding:var(--sf-space-3);border-radius:var(--sf-radius-lg);background:var(--sf-fill);font-size:var(--sf-font-sm);white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
.sf-boundary-actions{display:flex;gap:var(--sf-space-3);flex-wrap:wrap}
.sf-boundary button{height:32px;padding:0 var(--sf-space-4);border:1px solid var(--sf-accent);border-radius:var(--sf-radius-lg);background:var(--sf-accent);color:var(--sf-on-accent);font:inherit;cursor:pointer}
.sf-boundary button.sf-boundary-escape{background:transparent;color:inherit;border-color:var(--sf-border-strong)}
`
