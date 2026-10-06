# Wizard steps 1 and 2: independent requirement sources (2026-10-06)

Requirement: SF-038/SF-039/SF-040, design 02 §4–§5. The first two steps stop treating a
requirement file as a material and stop hiding unreadable files in a separate block.

## Step 1

- **Requirement sources are chosen on their own.** The picker adds a file or a folder;
  a folder expands, at pick time, into the members that exist then, and the list shows
  them as one group whose individual files can be removed. Nothing is merged into the
  materials list any more, so clearing materials cannot remove a requirement source and
  a requirement file no longer needs to appear in materials to be readable.
- **Every source shows what it is**: a badge for readable / image / unreadable, the file
  name with its folder, and a remove action. Images carry an explicit
  `识别文字` action; while V4 is unverified the action reports why it cannot run yet and
  keeps the registration, rather than failing silently or disappearing.
- **Format is split.** Submission format stays a real choice; citation style is shown as
  the one style that actually exists, with a line stating that author–year and school
  standards are not implemented and are recorded as requirements only.
- The external-workspace entry is stated as unavailable in the picker itself, because the
  host picker capability has not passed G0 (see `g0-entry-presets-verification.md` V3a).

## Step 2

- **One list.** Unreadable files appear as disabled rows with a reason — an image says it
  is registered but not parsed, anything else says the format is unsupported. The
  separate block and its arrow are gone.
- **Counts and bulk actions**: selected / readable / attachments, with select-all-readable
  and a clear that only touches materials. A search box keeps a long list usable.
- **Dual use is visible**: a file that is also a requirement source is marked
  `也用作要求来源` while remaining the user's choice as a reference.

## Verification

Typecheck, build and the full suite (386 tests) pass. The client bundle no longer
references `assignmentPath` at all. AT-31/AT-32/AT-33 need a real Desktop session, which
is still outstanding.
