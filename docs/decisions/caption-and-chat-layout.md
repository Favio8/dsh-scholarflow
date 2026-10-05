# Caption entry and embedded chat (2026-10-05)

User-authorized UI-01 / UI-02; center redesign UI-03 is explicitly deferred.

Installed Desktop 0.2.0-rc.2 defines root-scoped `shell.overlay` in
`@deepseek-ai/dsh-client-ui-layout/lib/client.js`. Windows preload renders its
menu in a separate `[data-windows-menu]` host and publishes
`--dsh-windows-titlebar-height`. ScholarFlow registers its own overlay control,
using read-only menu geometry and ResizeObserver / root-style notifications to
follow its actual size and the sidebar's caption offset. CSS anchor positioning
was rejected by the real Desktop test because the preload menu follows the
overlay in document order. The geometry adapter neither relocates native DOM nor changes the preload or DSH
core. This geometry adapter targets the inspected Desktop version; it is not a
native menu contribution API. Plain Web and other platforms retain one sidebar
entry with a book icon, fixing the previous duplicated text.

The installed Conversation Factory explicitly supports `variant: 'embedded'`.
`phase: 'active', hero: false` selects its native bottom composer and omits the
full-page hero / workspace picker. The original strict Session view, composer
chain, permissions, model picker, uploads, queue, Todo docks and draft mirroring
remain owned by DSH. A compact local header and workspace badge provide the
context previously supplied by the hero. Suggestions fill the native input draft
only; they never send a prompt. The new-chat action creates a ScholarFlow Session
in the current workspace using the same Host contract as the project button.

Conversation CSS uses stable `data-*` markers and is restricted to
`.sf-chat-content`. Form button styling is limited to ScholarFlow's forms and
header, preventing it from restyling native composer controls. The resident chat
remains mounted when collapsed, and the existing resize / focus behavior remains.

Layout inspiration: [Microsoft VS Code Chat](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/widget/media/chat.css).
No editor, provider, message store or Agent Loop dependency was added.

## Verification

After implementation: `pnpm typecheck`, `pnpm build` and the three
`tests/contracts/client-boot.test.js` contracts passed (factory, Web registration,
Windows registration / disposal). `tests/e2e/caption-chat-smoke.mjs` passed in
the installed Electron Desktop: one clickable caption entry, actual menu end
146 px / entry start 150 px, embedded composer at bottom (8 px lower clearance),
no hero logo, draft retained on collapse, keyboard resize, and 720 px narrow
chat / return. No page errors were observed. Native test input was cleared through
the Lexical keyboard path; `.fill('')` alone is not a reliable Lexical reset.

Evidence: `.dsh-tmp/ui-refinement/result.json`, `desktop.png`, `narrow.png`.
No prompts were submitted and no projects initialized during these checks.
This change did not rerun model workflows or the entire V1 suite.
