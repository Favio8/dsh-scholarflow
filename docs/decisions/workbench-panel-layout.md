# Resizable scoped conversation panel

Implemented 2026-10-05 for PRD §8.3 and SPEC §23.2–23.4.

The ScholarFlow surface owns only its inner columns. It reuses the registered
Host conversation Slot and does not manipulate the ordinary Chat or outer
sidebar. A focusable separator supports pointer capture and ArrowLeft/Right,
Home and End. Width is bounded to 280–700 px and further limited by the actual
workbench width to preserve room for the manuscript. ResizeObserver uses this
surface's width, including the space already occupied by the Host sidebar.

The conversation panel can be hidden while its scoped component remains mounted,
retaining native input and prepared selection cards. Escape returns focus to the
toggle when the native child has not handled that key. Narrow workbenches show
either the manuscript or the conversation, with an explicit return button and
focus restoration. Neither state covers content with an uncontrolled overlay.
Width and desktop collapse state are optional browser UI preferences only;
storage denial does not affect project data, buffered edits or run authorization.

The real installed-Host test verifies keyboard and pointer resize, hiding/showing
with existing native input and selection retained, Escape focus restoration and
narrow panel switching. The existing narrow manuscript overflow and unsubmitted
buffer recovery tests also pass. This is scoped UI behavior, not an assertion
that all accessibility or long-manuscript performance acceptance is complete.
