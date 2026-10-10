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
.sf-caption-entry button{display:flex;align-items:center;gap:var(--sf-space-2);height:28px;padding:0 var(--sf-space-2);border:0;border-radius:var(--sf-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--sf-font-lg);cursor:pointer}
.sf-caption-entry button:hover,.sf-caption-entry button[aria-pressed=true],.sf-caption-entry button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sf-caption-entry button:focus-visible{outline:var(--sf-focus-width) solid var(--sf-focus-color);outline-offset:-2px}
`

export const CHAT_CSS = `
.sf-agent{background:var(--dsw-alias-bg-base);font-size:var(--sf-font-md);line-height:var(--sf-leading-tight)}
.sf-chat-toolbar{display:flex;align-items:center;gap:var(--sf-space-2);min-height:40px;padding:0 var(--sf-space-3);border-bottom:1px solid var(--dsw-alias-border-l3);flex-shrink:0}
.sf-chat-toolbar strong{font-size:var(--sf-font-sm);font-weight:600;letter-spacing:.04em}
.sf-chat-actions{margin-left:auto;display:flex;align-items:center;gap:var(--sf-space-hair)}
.sf-chat-toolbar .sf-chat-icon,.sf-header .sf-chat-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--sf-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sf-chat-icon:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sf-chat-icon:focus-visible{outline:var(--sf-focus-width) solid var(--sf-focus-color);outline-offset:-2px}
.sf-chat-scope{display:flex;align-items:center;gap:var(--sf-space-2);padding:var(--sf-space-2) var(--sf-space-3);font-size:var(--sf-font-xs);color:var(--dsw-alias-label-tertiary);flex-shrink:0}
.sf-chat-scope span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-chat-scope .sf-chat-mode{margin-left:auto;flex-shrink:0;padding:0 var(--sf-space-2);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--sf-radius-sm);color:var(--dsw-alias-label-secondary)}
.sf-chat-content{display:flex;position:relative;flex:1;min-height:0;overflow:hidden}
.sf-chat-content [data-conversation-content]{width:100%;--dsh-chat-content-width:calc(100% - 24px);--dsh-composer-card-max-width:100%;--dsh-composer-side-clearance:8px;--dsh-composer-dock-inset:4px}
.sf-chat-content [data-composer-seat]{margin-top:auto;flex-shrink:0}
.sf-chat-content [data-composer-card]{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--sf-radius-lg);box-shadow:none}
.sf-chat-content [data-composer-input]{font-size:var(--sf-font-md);line-height:var(--sf-leading-body)}
.sf-chat-empty{position:absolute;top:20%;left:var(--sf-space-5);right:var(--sf-space-5);z-index:1;color:var(--dsw-alias-label-secondary)}
.sf-chat-empty h3{margin:var(--sf-space-3) 0 var(--sf-space-2);font-size:var(--sf-font-lg);font-weight:600;color:var(--dsw-alias-label-primary)}
.sf-chat-empty p{margin:0 0 var(--sf-space-4);font-size:var(--sf-font-sm);line-height:var(--sf-leading-prose)}
.sf-chat-empty button{display:block;width:100%;margin:var(--sf-space-2) 0;padding:var(--sf-space-2);text-align:left;font:inherit;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--sf-radius-md);cursor:pointer}
.sf-chat-empty button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sf-chat-error{margin:0;padding:var(--sf-space-1) var(--sf-space-3);color:var(--dsw-alias-state-error-primary,var(--sf-danger));font-size:var(--sf-font-sm)}
@media(max-height:620px){.sf-chat-empty{top:8%;left:var(--sf-space-4);right:var(--sf-space-4)}.sf-chat-empty button{display:inline-block;width:auto;margin-right:var(--sf-space-1);padding:var(--sf-space-2)}.sf-chat-empty p{margin-bottom:var(--sf-space-2)}}
`
