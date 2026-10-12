import React from 'react'
import type { FlowNode, FlowNodeId } from './flow-status.ts'

export function FlowNavigation({ nodes, current, onNavigate }: { nodes: FlowNode[]; current?: FlowNodeId; onNavigate: (id: FlowNodeId) => void }) {
  return <nav className="sf-flow-nav" aria-label="论文流程"><ol>{nodes.map(node => <li key={node.id} data-state={node.state}>
    <button className="sf-ghost sf-flow-node" data-node={node.id} aria-current={current === node.id ? 'page' : undefined}
      aria-label={`${node.title}，${node.label}`} title={`${node.title} · ${node.label}：${node.detail}`} onClick={() => onNavigate(node.id)}>
      <span className="sf-flow-mark" aria-hidden="true">{node.state === 'completed' ? '✓' : ['attention', 'stale'].includes(node.state) ? '!' : node.state === 'paused' ? 'Ⅱ' : ''}</span>
      <span className="sf-flow-text"><span className="sf-flow-title">{node.title}</span><small>{node.label}</small></span>
    </button>
  </li>)}</ol></nav>
}

export const FLOW_CSS = `
.sf-paper-project{container-name:sf-workbench}
.sf-paper-project .sf-paper-toolbar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;height:auto;min-height:48px;gap:var(--sf-space-2);padding-block:var(--sf-space-1)}
.sf-paper-project .sf-paper-actions{margin-left:0}
.sf-flow-nav{min-width:0;width:100%;max-width:720px;justify-self:center;padding-inline:var(--sf-space-3);box-sizing:border-box}
.sf-flow-nav ol{display:flex;align-items:center;list-style:none;margin:0;padding:0}
.sf-flow-nav li{display:flex;align-items:center;flex:1;min-width:0}
.sf-flow-nav li:last-child{flex:none}
.sf-flow-nav li:not(:last-child)::after{content:'';height:1px;min-width:8px;flex:1;margin-inline:var(--sf-space-2);background:var(--sf-border-strong)}
body .sf-app .sf-flow-node{display:flex;align-items:center;gap:6px;padding:5px 4px;min-height:36px;flex:none;white-space:nowrap;border:0;background:transparent;font-size:var(--sf-font-sm);color:var(--sf-text);position:relative}
body .sf-app .sf-flow-node:hover{background:var(--sf-fill)}
.sf-flow-text{display:flex;flex-direction:column;align-items:flex-start;gap:2px;line-height:1.2}
.sf-flow-text small{font-size:10px;color:var(--sf-muted);font-weight:400}
.sf-flow-mark{display:grid;place-items:center;box-sizing:border-box;flex:none;width:15px;height:15px;border:1px solid var(--sf-border-strong);border-radius:50%;font-size:10px;color:var(--sf-muted)}
.sf-flow-nav [data-state=completed] .sf-flow-mark{border-color:var(--sf-ok-border);background:var(--sf-ok-soft);color:var(--sf-ok)}
.sf-flow-nav [data-state=running] .sf-flow-mark{background:var(--sf-accent);border-color:var(--sf-accent);box-shadow:0 0 0 3px var(--sf-accent-soft)}
.sf-flow-nav :is([data-state=attention],[data-state=stale],[data-state=paused]) .sf-flow-mark{background:var(--sf-warn-soft);border-color:var(--sf-warn-border);color:var(--sf-warn-text)}
.sf-flow-nav :is([data-state=attention],[data-state=stale],[data-state=paused]) small{color:var(--sf-warn-text)}
.sf-flow-node[aria-current=page] .sf-flow-title{color:var(--sf-accent-text);font-weight:600;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
@container sf-workbench (max-width:850px){.sf-paper-project .sf-paper-toolbar{grid-template-columns:1fr auto}.sf-flow-nav{grid-column:1/-1;grid-row:2;padding:var(--sf-space-1) 0;max-width:640px}.sf-paper-views{justify-self:start}}
@container sf-workbench (max-width:440px){body .sf-app .sf-flow-node{gap:3px;padding-inline:0;font-size:11px}.sf-flow-nav li:not(:last-child)::after{min-width:3px;margin-inline:3px}.sf-flow-mark{width:12px;height:12px;font-size:9px}.sf-flow-text small{font-size:9px}}
`
