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
.sf-boundary{max-width:640px;margin:48px auto;padding:20px 22px;border:1px solid #d4515155;border-radius:12px;background:var(--dsw-alias-bg-base,#fff);font-size:14px;line-height:1.7}
.sf-boundary h3{margin:0 0 8px;font-size:16px}
.sf-boundary p{margin:0 0 12px;color:var(--dsw-alias-label-secondary,#697080)}
.sf-boundary pre{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#8881;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
.sf-boundary-actions{display:flex;gap:10px;flex-wrap:wrap}
.sf-boundary button{height:34px;padding:0 14px;border:1px solid var(--sf-accent);border-radius:8px;background:var(--sf-accent);color:#fff;font:inherit;cursor:pointer}
.sf-boundary button.sf-boundary-escape{background:transparent;color:inherit;border-color:#8884}
`
