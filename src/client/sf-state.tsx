import React from 'react'
import { WorkbenchIcon } from './workbench-chrome.tsx'

export function SfState({ kind, title, description, action, children, compact = false }: {
  kind: 'empty' | 'loading' | 'error'; title: string; description: string;
  action?: { label: string; onClick: () => void }; children?: React.ReactNode; compact?: boolean
}) {
  return <section className={`sf-state sf-state-${kind}${compact ? ' sf-state-compact' : ''}`}
    role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading' || undefined}>
    <span className="sf-state-icon" data-animated={kind === 'loading' || undefined}>
      <WorkbenchIcon kind={kind === 'error' ? 'warning' : kind === 'loading' ? 'loading' : 'book'} size={20} />
    </span>
    <div className="sf-state-body"><h3>{title}</h3><p>{description}</p>{children}</div>
    {action && <button type="button" className="sf-primary" onClick={action.onClick}>{action.label}</button>}
  </section>
}
