import React from 'react'

export function WorkbenchIcon({ kind = 'book' }: { kind?: 'book' | 'chat' | 'close' | 'plus' | 'panel' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'book' ? <><path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z" /></>
      : kind === 'chat' ? <path d="M4 4h16v12H9l-5 4Z" />
        : kind === 'close' ? <path d="m6 6 12 12M18 6 6 18" />
          : kind === 'plus' ? <path d="M12 5v14M5 12h14" />
            : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>}
  </svg>
}

// The caption menu belongs to Desktop preload. Anchor an independently owned
// shell.overlay control to its measured box; never move or edit native menu DOM.
export const CAPTION_CSS = `
.sf-caption-entry{position:fixed;left:var(--sf-caption-left,150px);top:0;height:var(--dsh-windows-titlebar-height);z-index:1100;display:flex;align-items:center;-webkit-app-region:no-drag}
.sf-caption-entry button{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;cursor:pointer}
.sf-caption-entry button:hover,.sf-caption-entry button[aria-pressed=true],.sf-caption-entry button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sf-caption-entry button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
`

export const CHAT_CSS = `
.sf-agent{background:var(--dsw-alias-bg-base);font-size:13px;line-height:1.5}
.sf-chat-toolbar{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l3);flex-shrink:0}
.sf-chat-toolbar strong{font-size:12px;font-weight:600;letter-spacing:.04em}
.sf-chat-actions{margin-left:auto;display:flex;align-items:center;gap:2px}
.sf-chat-toolbar .sf-chat-icon,.sf-header .sf-chat-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sf-chat-icon:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sf-chat-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.sf-chat-scope{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-shrink:0}
.sf-chat-scope span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-chat-scope .sf-chat-mode{margin-left:auto;flex-shrink:0;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;color:var(--dsw-alias-label-secondary)}
.sf-chat-content{display:flex;position:relative;flex:1;min-height:0;overflow:hidden}
.sf-chat-content [data-conversation-content]{width:100%;--dsh-chat-content-width:calc(100% - 24px);--dsh-composer-card-max-width:100%;--dsh-composer-side-clearance:8px;--dsh-composer-dock-inset:4px}
.sf-chat-content [data-composer-seat]{margin-top:auto;flex-shrink:0}
.sf-chat-content [data-composer-card]{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:none}
.sf-chat-content [data-composer-input]{font-size:13px;line-height:1.6}
.sf-chat-empty{position:absolute;top:20%;left:24px;right:24px;z-index:1;color:var(--dsw-alias-label-secondary)}
.sf-chat-empty h3{margin:12px 0 6px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sf-chat-empty p{margin:0 0 16px;font-size:12px;line-height:1.7}
.sf-chat-empty button{display:block;width:100%;margin:6px 0;padding:9px 10px;text-align:left;font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;cursor:pointer}
.sf-chat-empty button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sf-chat-error{margin:0;padding:4px 12px;color:var(--dsw-alias-state-error-primary,#d45151);font-size:12px}
@media(max-height:620px){.sf-chat-empty{top:8%;left:16px;right:16px}.sf-chat-empty button{display:inline-block;width:auto;margin-right:4px;padding:6px}.sf-chat-empty p{margin-bottom:6px}}
`
