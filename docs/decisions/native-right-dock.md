# Native right Dock integration (2026-10-05)

UI-04 reuses the existing ScholarFlow chat. The independent inner right column
suppressed DSH's native sidebar because its main panel ID was `scholarflow`.
The installed rc.2 `ui-sidebar-right` exposes a Session only while the active
main panel ID is null. This change keeps that native Conversation layout and
registers a scoped `main/conversation` cell at public Slot priority -50, only
for Sessions explicitly opened in ScholarFlow. Disposing this contribution
restores the original cell on return to ordinary Conversation or another
Session. The project surface uses an owned `scholarflow.workspace` Factory;
its existing forms and six project pages are unchanged.

The native `sidebarRightTabs` registry owns the added `scholarflow-chat` type.
Its body/title/guide entry use public Slots. Existing Agent content still uses
the native `conversation.content` embedded Factory, with the native chat view,
input, permissions and model controls. There is no new chat store or Agent Loop.
Native `sidebarRight.openTabs` metadata plus `focus` reuse the one existing chat
across panes. Only the selected ScholarFlow Session's first chat occurrence can
mount its native composer, preventing competing roots of the Session's Lexical
editor. `keepMounted` retains chat and selection cards during tool tab switches.

DSH continues to own the complete outer Dock: start cards, file/provider tabs,
terminal, browser, shortcuts, split, fullscreen, floating, width and collapse.
The workbench header directly reuses the installed native `open-in-app`,
`session-log-download` and rightbar expand components. Public Slot inspection
identifies the active registrations; owned Session Factories instantiate the
same component functions with their original locale, inject and shared store.
The folder control retains its real application icon, dropdown and launch
behavior, and More retains native export/feedback. No emoji substitute, custom
tool menu or additional top-level AI Chat button remains after UI-05.
It does not copy or relocate the ordinary Conversation header. No core files,
native DOM, native styles or private layout stores are modified. The old inner
column width preference is superseded by the native per-Session Dock state.

Version-pinned sources: installed `@deepseek-ai/dsh-client-ui-slots/lib/index.js`
(public priority shadowing), `dsh-client-ui-sidebar-right/lib/client.js`
(controller, registry, guide and native panel), and
`dsh-client-ui-conversation/lib/client.js` (embedded Factory). Reference upstream:
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Before UI-05, typecheck/build and 344 non-model tests passed. Actual Desktop
confirmed the four native guide entries, file/browser navigation, shared draft,
collapse/fullscreen/split and responsive layout. This evidence describes the
earlier header only; it does not verify the final native-header reuse. Following
the user's explicit instruction, UI-05 is built without further tests. Model
workflows are outside this UI correction. The existing layout smoke scripts
require adapting their obsolete custom-header selectors before a future run.
