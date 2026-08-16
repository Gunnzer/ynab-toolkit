# YNAB Toolkit — codebase map

**Check this file first** for "where is X" / "how does X work" questions on
this project, before grepping around cold. If the answer isn't here, find it
the normal way (Grep/Read/Explore) — then add what you learned back into this
doc (the right table row, the gotchas list, or a new note) so the next
session doesn't have to re-derive it. Keep entries factual and specific
(file:line, not vague description); if something here turns out to be wrong
or stale, fix it in place rather than leaving it to mislead later.

`web/` is the app. Plain HTML/CSS/ES modules, zero dependencies, no build
step, no server. This is what gets worked on. (An earlier Python/PySide6
desktop version, `desktop-archive/`, was superseded by `web/` and has been
removed entirely — if you find a stray reference to it, it's stale.)

Everything below is about `web/`.

## Where to look first

| I need to... | Go to |
| --- | --- |
| Change a page's UI/behavior | `web/js/pages/<name>.js` |
| Change a tool's actual logic (splitting math, matching rules, CSV parsing) | `web/js/tools/<name>.js` — pure functions, no DOM, fully unit tested |
| Add/change a DOM widget (button, table, dialog, category picker) | `web/js/ui.js` |
| Change styling | `web/css/app.css` — CSS custom properties at the top (`--accent`, `--border`, `--faint`, etc.), grouped sections below with `/* ---------- name ---------- */` headers |
| Change nav, routing, sidebar, or which tools are toggle-able | `web/js/main.js` (`PAGES` array, `App` class) |
| Change what's fetched/cached from YNAB, or session/local storage behavior | `web/js/state.js` (`AppState`) and `web/js/store.js` (`Store`) |
| Change a raw YNAB API call | `web/js/api.js` (`YnabClient`) |
| Money/milliunit math | `web/js/money.js` |

## Page ↔ tool map

| Page (`js/pages/`) | Tool logic (`js/tools/`) | What it does |
| --- | --- | --- |
| `home.js` | — | Landing page, links into each tool |
| `setup.js` | — | Token, budget picker, the two people + their split share, tool on/off switches, backup/restore/reset. Also owns Bill Splitting's rarely-touched file-reading settings (date order, split memo pattern, Excel serial) - see below |
| `shared.js` | `shared_expenses.js` | Converts transactions in shared categories into native YNAB splits; undo via delete+recreate |

`shared_expenses.js`'s `scan()` returns a `skipped` array (`{ transaction, rule, reason }`, `reason` is `"transfer"` or `"already split"`) alongside the existing `skippedTransfers`/`skippedAlreadySplit` counts - the counts stayed for backward compatibility, `skipped` is what a UI actually shows. `shared.js`'s "Skipped" button (`section-head` row next to the "Preview" title, hidden when nothing was skipped, labelled `Skipped (N)`) opens a wide `customDialog` listing exactly which transactions were left out and why, populated fresh each `preview()` run - same "counts alone don't say which ones" reasoning as `applySplits()`'s `applied` array/the "Last applied" table.

**Splitting one leg of an already-split transaction:** the real-world case this exists for - person 1 pays a full restaurant bill, friends transfer back their share, and the transaction is already split into "what came back from friends" + "the genuinely shared portion" that still needs dividing between the two people. With the "Skip transactions that are already split" checkbox unchecked, `scan()` no longer just skips these outright - for each subtransaction leg that sits in a mapped shared category, it pushes its own planned item (`{ transaction, rule, person1Amount, person2Amount, legIndex }`), computed from *that leg's own amount*, not the transaction's total. A transaction with several matching legs (rare, but possible) gets one planned item per leg, previewed and selectable independently. Everything downstream keys off `legIndex` (present only for these items) to branch its behaviour:
  - **`splitLegPayload(transaction, legItems)`** builds the full replacement `subtransactions` array: any leg not selected for conversion (the friends' leg, or a shared leg you left unticked) is copied through byte-for-byte; each selected leg is replaced with two new legs, one per person. This is a *create* body, not an update one - see the next point.
  - **`applySplits()`** groups `planned` by `transaction.id` first (since several items can share one transaction) and writes once per group. A group containing any `legIndex` items goes through delete + `createTransactions([splitLegPayload(...)])`, exactly like `undoFromBackup` already does - YNAB's update endpoint will not let a split transaction's subtransactions be patched once it already has any, full stop, not just "won't remove them" (the narrower claim the codebase used to make here). A group with no `legIndex` items still takes the old, simpler `updateTransaction` path. (Confirms and extends the `api.js` gotcha below - it's not just that an update can't un-split or re-category a split transaction, it can't add/replace subtransactions on one either.)
  - **Gotcha (caught by live testing against a mocked write, not by the unit tests alone):** delete + recreate gives the transaction a *new id*. The backup pushed for Undo must be recorded under that new id, not the original - `backupRecord()` is called before the write only to capture the *content*, but its `.id` is overwritten with the real `createTransactions()` result before being pushed to the backup list. Get this wrong and a later Undo tries to delete an id that was already deleted, which would 404 against a real budget. The dedup check (`backups.some(record => record.id === transaction.id)`) also had to move to capture `alreadyBackedUp` *before* the id changes, for the same reason.
  - **`backupRecord()`/`restoreCreatePayload()`** now round-trip a full split, not just a single category: when the source transaction was already split, the backup carries a `subtransactions` array (each leg's amount/category_id/memo, deleted legs dropped) instead of a bare `categoryId`, and `restoreCreatePayload()` branches on whether that array is present to build either a single-category or a full split create body. This is what lets Undo put back the *exact* original split - friends' leg included - not a lossy single-category approximation.
  - **`driftCheck()`** had to stop keying its "is this still the same thing" map by `transaction.id` alone, since several planned items can now share one id - it keys by `` `${id}:${legIndex}` `` when `legIndex` is set, and compares the specific leg's amount (not the whole transaction's) for drift.
  - **`shared.js`'s preview/applied tables** show the *leg's* amount (`rowAmount()`), not the transaction's total, and append "(one leg)" to the category/payee label (`rowLabel()`) - showing the $150 total next to a $75/$75 split would look like a bug, not a feature. Post-apply, `applySelected()` calls `state.invalidate()` instead of `state.patchTransactions()` whenever any applied item has a `legIndex`, since a patch can't express "new id, and legs that weren't touched stayed as they were."

`shared_expenses.js`'s `scan()` matches each transaction to a rule by category id. **Gotcha (real production bug, fixed):** YNAB gives a split transaction's parent record `category_id: null` - the category lives on each subtransaction instead, same as `reports.js`/`split_sheet.js` already assumed (both flatten to subtransaction parts whenever they exist, ignoring the parent's own `category_id`). `scan()` used to check only `transaction.category_id`, so an already-split transaction with one leg in a shared category never matched any rule - not even the `skippedAlreadySplit` counter caught it, since the "already split" check runs only after a rule is found. It was completely invisible, not just skipped. Fixed by falling back to a match against any (non-deleted) subtransaction's `category_id` when the parent's own `category_id` doesn't match. This only makes such a transaction *visible* (found, then correctly skipped and logged as "already split") - it still cannot be converted further, per the existing `updateTransaction` limitation noted below.
| `splitsheet.js` ("Bill Splitting") | `split_sheet.js` | Exports shared expenses to a tracker spreadsheet (CSV/clipboard); each transaction is classified as P1, P2, Shared (the split from Setup), or Custom. Its own page keeps only the payee filter (behind a small "Filters" popup button) and the source/convert/preview flow - everything configured once and rarely touched lives on Setup instead, so there's no "Tool setup" disclosure here |

`split_sheet.js`'s `personCode(which, settings)` is what actually decides the P1/P2 Owner-column letter: it prefers that person's account tag (`person{N}AccountTag`, set on Setup) over the literal "P1"/"P2" fallback, since the tag is already the one-letter identifier the user set up for exactly this purpose. Only "S" (shared) and "C" (custom) are ever fixed, unconditional codes. The Filters popup's info icon uses the new `.tooltip`/`data-tooltip` pattern in `app.css` (instant-appear, app-styled, instead of the browser's native `title` tooltip) - reuse that pattern rather than `title` for any future inline help text, but remember to also set `overflow: visible` on whatever popup contains it, since the default `.picker-popup` clips overflow and a tooltip needs to escape that. **Refund/income handling:** `fromExport`/`fromApi` no longer try to guess whether an inflow is income or a refund (an earlier category-presence heuristic was tried and replaced) - every inflow is kept and turned into a negative-amount row through the normal P1/P2/Shared/Custom classification, same as any expense. `splitsheet.js` sets `row.included = row.Amount >= 0` once per conversion (every negative row - income or refund alike - defaults to excluded, since most inflows are income and refunds are rare). Inflows are reviewed in their own dialog, not inline in the Preview table (two earlier designs were tried and replaced per explicit user feedback: first a single Preview table with a checkbox on every row - confusing, mixed income/refund review in with ordinary expenses; then two always-visible tables, Preview plus a separate always-open Inflows table below it - still too much always-on screen space for something rarely used). The current design: `preview` shows `previewRows()` - every ordinary expense (`Amount >= 0`) plus any inflow that has been ticked in - with no checkbox column of its own (`drawPreview()`). An `inflowsButton` next to the "Preview" heading (`Inflows (N)`, hidden when there are no inflows, count painted by `paintInflowsButton()`) opens `openInflowsDialog()`, a wide (`customDialog(..., { wide: true })`, see the `.dialog.is-wide` CSS gotcha below) modal built fresh on each open from the current `rows`, listing only inflow rows (`Amount < 0`) each with its own include checkbox bound to `row.included`. Ticking a box inside the dialog calls both `drawPreview()` and `showSummary()` immediately (not just `showSummary()`) - the whole point of "moves into preview but stays in inflows so I can uncheck if it was a mistake" (the user's own words) is that the row visibly jumps into the Preview table and the totals update live while the dialog is still open, and unticking pulls it back out just as live. Preview and the dialog share row-rendering via `rowCells(row, codes, { withCheckbox })` and pill-colouring via `ownerCodes()`/`pillClassFor()`, and both read from `previewRows()`/an inline `Amount < 0` filter over the same `rows` array - there's only ever one array, the two views just filter it differently. Column filtering (the funnel icons) only exists on the expense table - inflows are expected to be few enough not to need it, and the funnel's own distinct-values list is drawn from `previewRows()` too, so it only ever offers values actually visible in Preview. `saveCsv()`/`copyRows()`/`monthlySummary()` all still filter the full `rows` array on `row.included` before writing anything out (expense rows pass through unconditionally since they default to `true`). This applies per-leg for split transactions too (every leg is kept, expense and credited-back alike, netted together into one row). `classifySplit()` only special-cases `total === 0`, not `total <= 0` - a negative total (a refund-heavy or all-refund split) classifies the same way a positive one does, just with negative shares; re-introducing a `<= 0` guard would silently zero out real refund amounts. **Owner column styling:** the Owner cell renders as a colored `.pill` badge instead of plain grey `.mono` text - P1 is `pill-blue`, P2 is `pill-purple`, Custom is `pill-warn` (amber - reused as-is since it already read as "orange"), Shared is plain uncoloured `pill` (grey) *unless* it has drifted from the ratio (see the variance-tint note below), in which case it's `pill-caution` (a yellow distinct from `pill-warn`'s amber, so "a bit off" and "genuinely Custom" don't share a colour). `pill-blue`/`pill-purple`/`pill-caution` and their `--blue`/`--purple`/`--caution` (+ `-soft`) root vars were added specifically for this column - `pill-info`/`pill-ok` (the app's general-purpose teal/green) used to be reused for P1/P2 but were swapped out at explicit user request for colours with no other meaning attached elsewhere in the app. **Gotcha:** the Preview table's header row is repainted by index (`paintPreviewHeadings()` swaps the "Person 1"/"Person 2" column headers for the actual names) - it must look up each index via `preview.columns.findIndex(c => c.key === "Share1"/"Share2")` rather than a hardcoded number, since a hardcoded index here previously (when the checkbox column was inline) silently overwrote the wrong header; the dialog's own table is rebuilt fresh on every open with the person names baked straight into the column labels, so it needs no repaint mechanism at all. **`ui.js`'s dialog width:** `customDialog(title, build, options)` accepts `wide: true`, which toggles `.is-wide` on the shared `#dialog` element (`app.css`, `min(920px, 95vw)` instead of the default `min(560px, 92vw)`) - use it for any future dialog that manages a whole table rather than a form's worth of fields, so it isn't squeezed into form-dialog width. (A "skip a whole person's own rows" toggle - two checkboxes in the Filters popup, filtering inside `buildRows()` - was tried and then removed at explicit user request; if something like it comes back, the Owner column's funnel-icon filter in the Preview header is the closer fit, since it's already there and view-only filters are cheaper to reason about than ones that change what Save/Copy/Monthly Summary include.) **No pagination:** the Preview table used to cap itself at 60 rows with a "Show all"/"Show first 60" toggle - removed entirely at explicit user request (expected volume is at most a few hundred rows, and the table is already its own bounded/scrolling panel via `.scroll-table`, so a page-level cap was solving a problem the panel already handles). `drawPreview()` now always renders every row in `filtered`. **Totals row:** appended as the last `<tr class="total-row">` in `drawPreview()`, summing `Amount`/`Share1`/`Share2` over `filtered` (the post-column-filter set) - not over all of `previewRows()` - so narrowing the table with a funnel filter also narrows the total; recomputed on every `drawPreview()` call, so it stays live with everything else (column filters, ticking an inflow in, etc). **Split % tooltip:** hovering the Owner pill shows each person's actual share as a percentage of that row's Amount (`splitPercentInfo()`, using the `.tooltip`/`data-tooltip` pattern, wrapping the pill span rather than a separate info-button) - this is the row's *real* worked-out percentage, not the shared-ratio preset, so a Custom row correctly shows its own uneven split and a Shared row confirms the preset was actually applied. Guards `Amount === 0` explicitly (a split whose two legs fully cancel out, e.g. a purchase and its same-cycle refund/adjustment landing in one grouped row) with a "No split % - amount is $0." message rather than computing a divide-by-zero - both shares are `0` in that case too, so there is no meaningful percentage to show, not even 0%/100%. **`SPLIT_TOLERANCE` (`split_sheet.js`):** `classifySplit()` used to require an exact cent-for-cent match against the shared ratio to classify as "S", which is stricter than it sounds - a real, human-entered split that misses the ratio by even a single cent falls to "C" even though it was clearly meant as the shared split (confirmed against real production data: a $22.50 transaction split $14.63/$7.88 read as Custom because the two legs, whose *unrounded* values were exactly $14.625/$7.875 - a precise 65/35 - each independently round the "wrong way" relative to the transaction's own $22.50 total). Replaced with a tolerance check on person 1's actual percentage of the total (`paid1 / total`, not rounded dollar amounts): within `SPLIT_TOLERANCE` (0.005, i.e. half a percentage point) of the configured ratio either way still counts as "S" - 65% stays a match from 64.50% through 65.50% inclusive. **Gotcha:** the inclusive-edge comparison needs a small epsilon (`SPLIT_TOLERANCE + 1e-9`) beyond the tolerance itself - plain float division (e.g. `64.5/100`) can land a hair on the wrong side of an exact boundary (`0.0050000000000000044` instead of `0.005`), which would otherwise reject a case that is supposed to be an inclusive match; confirmed live, this is not a hypothetical. When the tolerance match succeeds, the output `share1`/`share2` are the row's own actual amounts rounded to the cent (`round2(paid1)`/`round2(paid2)`), not a "clean" ratio-computed pair - showing what was really paid rather than silently substituting idealized numbers. **`VARIANCE_TINT_THRESHOLD` (`splitsheet.js`, the page, not the tool):** a second, much finer threshold (0.0005, i.e. 0.05 percentage points) than `SPLIT_TOLERANCE` (0.5 points) - it never changes whether a row classifies as Shared vs Custom, only whether an already-Shared row's pill tints `pill-caution` (yellow) instead of staying plain grey. `pillClassFor(row, codes)` computes this itself from `row.Share1 / row.Amount` vs `codes.ratio` (added to `ownerCodes()`'s return value alongside the existing code lookups) - it does not read anything off `classifySplit()`'s output beyond the amounts already on the row, since the tool layer has no notion of a "tint," only a code. Guarded on `row.Amount` truthy first, same reasoning as `splitPercentInfo()`'s zero-amount guard. **The "!" overshoot flag:** `splitPercentInfo()` also returns `exceeds100` - the two displayed percentages, each independently rounded to 2 decimals, can add up to just over 100% even for a mathematically exact split (this is exactly the $22.50 example above: 65.02% + 35.02% = 100.04%, a display-rounding artifact, not a data problem). When that happens, `rowCells()` appends a small `.pill-flag` "!" span after the Owner code inside the pill (e.g. "S!"), styled in `var(--error)` regardless of which pill variant it's attached to, with its own `title` explaining why. Both the tolerance and the flag apply everywhere `rowCells()` renders a row - the Inflows dialog included, not just the main Preview table.
| `budget.js` ("YNAB Budget") | — | Read-only look at one month, YNAB's own numbers |
| `classicbudget.js` | — | Same idea, but against your own planned amount per category instead of YNAB's Assigned |
| `reports.js` | `reports.js` | Monthly spending by category/payee, filterable, savable filters |
| `autoassign.js` | `autoassign.js` | Drains a holding category into targeted categories in priority order |
| `duplicates.js` | `duplicates.js` | Flags likely-duplicate transactions; never deletes |
| `bank.js` ("Bank Import") | `bank_convert.js` | Bank export → YNAB's 4-column import CSV, with payee rewrite rules |

Every `pages/*.js` exports one `xPage(app)` function that builds and returns
the page's root DOM node. Every `tools/*.js` file is DOM-free and has its own
test file in `web/tests/`.

## Core infrastructure

- **`main.js`** — `PAGES` array (id, title, icon, optional `key` for the
  Setup tool-toggle and optional `group`/`groupLabel` for a pop-out sidebar
  section), the `App` class (routing via `go`/`show`, `buildNav`,
  `visiblePages`/`toolEnabled`, and `run(job, {log, buttons})` — the
  standard wrapper every page uses for an async action: sets busy state,
  disables the passed buttons, logs errors, always re-enables in `finally`).
- **`state.js`** (`AppState`) — the connected client, the loaded budget
  (groups/accounts/transactions), and helpers like `personName(which)`,
  `categoryName(id)`, `withPeople(settings)`. `withPeople()` is the one place
  that folds cross-tool shared config (the two people's names/prefixes/tags,
  *and* their shared-cost split ratio from `sharedExpenses.person1Ratio`)
  into a tool's own settings object — any tool needing "who they are" or
  "how they split" should go through this rather than reading another
  tool's settings section directly. Fetched YNAB data is cached in
  **`sessionStorage`** (`persistSession()`/`restoreSession()`/`invalidate()`)
  so a plain reload is free but nothing survives closing the tab.
  `patchTransactions(updates)` mutates specific cached transactions in place
  after a write, instead of invalidating and re-fetching — use this after any
  action whose result you already know (see `shared.js`'s Apply flow); use
  `invalidate()` when the transaction's *id* changed (delete+recreate, e.g.
  Undo) since a patch can't target an id that no longer exists.
- **`store.js`** (`Store`) — settings persistence in **`localStorage`**
  (`ynab-toolkit.settings`), separate from the token
  (`ynab-toolkit.token`, only written if "Remember on this device" is
  checked). `DEFAULTS` + `deepMerge` gives forward/backward-compatible
  import/export: unknown old keys are harmlessly kept, new keys not in an
  old export just fall back to default. `SCHEMA_VERSION` only gates
  *future* schema rejection, not every shape change — bump it only for a
  genuinely breaking change, not routine new settings.
- **`api.js`** (`YnabClient`) — thin wrapper over YNAB API v1. Notable gotcha
  (confirmed by live testing, not just docs): **you cannot un-split a
  transaction, or change its category while it's split, via `updateTransaction`.**
  The only way to revert a split back to a single category is
  `deleteTransaction` + `createTransactions` with the original details. See
  `shared_expenses.js`'s `undoFromBackup`.
- **`ui.js`** — `el(tag, attrs, ...children)` is the DOM builder every page
  uses (`onClick`/`onInput`/etc. map to `addEventListener`; `class`/`text`
  are shorthands). `pageHeading(title, intro)` no longer prints `intro`
  visibly on the page (every page open with a paragraph of explanation was
  noise once you already knew the tool) — it stashes it in a module
  variable instead, read back by `getPageIntro()`. `main.js`'s `showHelp()`
  calls that to prepend the *current* page's title and description to the
  Help dialog, so the explanation still exists, just behind Help instead of
  always on screen. `table(columns)` builds a `<table>` wrapped in
  `.table-wrap`, returns the wrapper with `.tbody` and `.columns` attached;
  to customize a header cell after creation (e.g. adding a filter icon),
  index into `wrap.querySelectorAll("th")` by
  `wrap.columns.findIndex(c => c.key === ...)`. `categoryPicker(state)` is
  the reusable searchable-dropdown pattern (`.picker`/`.picker-popup`,
  outside-click-to-close via a `pointerdown` listener on `document`) — reuse
  this pattern (see the Bill Splitting column-filter popovers) rather than
  inventing a new popover mechanism. It's the same component everywhere a
  category is picked (Shared Expenses' mapping included), so a fix here
  fixes every caller at once — don't special-case one page's pickers.
  **Gotcha:** `.picker-popup` opens anchored to the field's left edge and
  can size up to 460px wide; a field sitting in the right portion of a row
  (e.g. the last of several columns) can push the popup, search box
  included, off the right edge of the viewport. `open()` in `ui.js` checks
  `popup.getBoundingClientRect().right > window.innerWidth` *after*
  `render()` (not right after the popup is appended — it's empty then, so
  `width: max-content` hasn't accounted for the list content yet) and flips
  to `right: 0` when it would overflow. If a similar popup is added
  elsewhere, remember the same width-depends-on-content-after-render trap.
- **Per-column table filtering** (Bill Splitting's `splitsheet.js`,
  `addColumnFilter()`) — the Excel/LibreOffice AutoFilter pattern: a funnel
  icon in a filterable `<th>` (`.filterable-th`, label + `.th-filter-btn`
  wrapped in an inner `.th-filter-row` div — see the sticky-header gotcha
  below for why it's not flex on the `<th>` itself) opens a popup built on
  the same `.picker-popup` shell as `categoryPicker` (`.filter-popup`),
  containing a search box, a "(Select all)" checkbox (`.filter-select-all`),
  a checklist of the column's distinct values (`.filter-value-list`), and
  OK/Cancel (`.filter-popup-actions`). Selection is worked on in a scratch
  `Set` until OK commits it into the page's `columnFilters` map (`null` = no
  filter, otherwise the Set of allowed values); Cancel/outside-click
  discards the scratch copy untouched. Reuse this whole block (copy
  `addColumnFilter` and its CSS) for any other table that needs the same
  filter UI — don't reinvent a plain single-text filter box again, that was
  the thing this replaced.
- **Gotcha:** `th` uses `box-shadow: inset 0 -1px 0 0 var(--border-strong)`
  for its bottom line, not `border-bottom`. A sticky (`position: sticky`)
  `<th>` inside a `border-collapse: collapse` table paints its collapsed
  border out of sync with neighbouring cells once some headers are laid out
  differently from others (e.g. the filterable ones being flex containers
  for their funnel icon) — the header row's bottom line visibly is not
  straight even though every cell's computed geometry is identical. An inset
  box-shadow sits inside the cell instead of collapsing with neighbours, so
  it does not have this problem. Keep using box-shadow, not border, for any
  future sticky header styling.
- **Gotcha (bigger one, confirmed live):** `position: sticky` on a `<th>`
  stops working the moment that same `<th>`'s own `display` is changed away
  from the browser default (`table-cell`) — e.g. straight to `display: flex`
  for the filterable headers' label+funnel-button row. In the Preview
  table's bounded/scrolling panel (`.scroll-table`, see below), this showed
  up as exactly the four filterable headers (Card, Payee, Owner, Memo)
  silently failing to stick and scrolling away with the body while the
  plain headers (Date, Amount, the two person columns) stayed correctly
  pinned — column widths still lined up perfectly (`getBoundingClientRect()`
  agreed on left/width), only the sticky *top* offset was wrong for the
  flex ones, so it was invisible to a static DOM check and only showed up
  mid-scroll. Fixed by keeping the `<th>` itself a plain (unstyled-display)
  sticky cell and moving `display: flex` onto an inner `.th-filter-row` div
  that holds the label and funnel button instead (`.filterable-th` only
  carries `padding: 0` now, with the padding moved onto `.th-filter-row`).
  Any future `<th>` content that needs its own layout (flex, grid, whatever)
  must go on a child element, never on the `<th>` itself, or sticky silently
  breaks for just that column.
- **Gotcha:** a column filter's `.filter-popup` used to be appended as a
  child of its own `<th>` (like `categoryPicker`'s popup pattern it was
  copied from). Inside `.scroll-table`'s bounded/scrolling panel that
  meant the popup was clipped to the panel's own box - when the table had
  few rows (or the current filters left zero visible), the popup had
  nowhere to overflow into and the panel just grew its own scrollable area
  downward instead, so opening a filter meant scrolling a tiny table to see
  it. Fixed in `addColumnFilter()` (`splitsheet.js`) by appending the popup
  to `document.body` instead and positioning it with `position: fixed`
  from the funnel button's own `getBoundingClientRect()` - it now floats on
  top of the table like any other overlay, regardless of the table's own
  height or scroll state. Two things had to change alongside the portal:
  `onOutside()`'s check widened from `!th.contains(target)` to also allow
  `popup.contains(target)` (the popup is no longer inside `th`, so without
  this every click *inside* the open popup itself immediately closed it),
  and the right-edge-overflow correction changed from flipping to
  `right: 0` (meant "th's right edge" when position was absolute inside
  it) to nudging `left` explicitly (fixed positioning has no positioned
  ancestor to flip relative to - `right: 0` would mean the viewport's edge
  instead). A `scroll` listener on `window` closes the popup too, since a
  `fixed` popup does not track the page's own scroll the way an
  absolutely-positioned one anchored inside a scrolling ancestor would.
  Any future popup opened from inside `.scroll-table` (or any other
  bounded/scrolling panel) should follow the same portal-to-`body` pattern
  rather than appending inside the scrolling container.
- **Gotcha:** `.table-wrap`'s `overflow-x: auto` (for a wide table's
  horizontal scroll) silently defeats `th`'s `position: sticky` for the
  *page's* scroll, because the CSS spec forces `overflow-y` to compute as
  `auto` too whenever `overflow-x` is not `visible` — **even if
  `overflow-y: visible` is set explicitly**, and `overflow-y: clip` doesn't
  reliably avoid it either (this browser computes it as `hidden`, which
  still counts as a scroll container). `.table-wrap` becomes its own
  vertical scroll container either way, and since nothing caps its height
  it never actually needs to scroll, so the sticky header just does
  nothing. Don't fight this - embrace it: `.scroll-table` in `app.css`
  (`max-height: 65vh; overflow-y: auto`) turns the wrapper into a proper
  scrollable panel with a frozen header instead of growing the whole page.
  Originally built just for Bill Splitting's Preview table (hence the class
  was once named `.scroll-table`), then rolled out via
  `<table>.classList.add("scroll-table")` to every other main table that
  can realistically grow long — Reports' four breakdown tables (added once,
  inside the shared `reportTable()` factory), YNAB Budget's and Classic
  Budget's category tables, Auto Assign's plan table, Duplicates' results,
  and Shared Expenses' preview/applied tables. Give any *new* table the
  same class if it can plausibly grow past a screenful — a table nobody
  expects to grow long (a short rules list, a dialog's checklist) doesn't
  need it.

## Testing

```bash
node --test web/tests/*.test.js       # full suite
node --test web/tests/tools.test.js   # one file
```

- `tools/*.js` logic is covered by a matching `tests/*.test.js` using fake
  fixture budgets (`tests/fixtures/test_budget.js`).
- `tests/privacy.test.js` scans the shipped source for tokens, budget/account
  ids, emails, and other things that must never appear in a public repo —
  **this gates the GitHub Pages deploy** (`.github/workflows/pages.yml`
  fails the build if it fails).
- `tests/store.test.js` covers settings import/export/schema behavior.
- Day-to-day: run only the test file(s) for the page/tool you touched, plus
  `node --check <file>.js` for a fast syntax check. Run the full suite (and
  do a real browser check) before a push, not after every small edit — see
  memory: testing-scope preference.

## Conventions worth matching

- No em dashes / en dashes anywhere a user reads, or in source comments —
  `privacy.test.js` enforces this.
- No comments explaining *what* code does; comments exist for *why*
  (a non-obvious constraint, a workaround, a past bug). Match the existing
  file's tone if you add one.
- Destructive/rare actions (Undo, Clear all, Reset) get a `confirmDialog`
  and are visually de-emphasized (small, or styled as a link via
  `.btn-link`) — see `shared.js`'s Undo-as-link-in-history-section pattern.
- Settings-heavy tool pages follow: read-only summary of cross-tool settings
  (name/split, defined once in Setup) → collapsible "tool setup" `<details>`
  block for rarely-touched config → primary action row → results table →
  log pane. `shared.js` and `splitsheet.js` are the clearest examples.
- CSS variables over hardcoded colors, always (`var(--accent)`,
  `var(--faint)`, `var(--border-strong)`, etc.) — see the `:root` block at
  the top of `app.css` for the full palette.

## Deploy

`web/` is published as-is to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main`, gated on the test suite (including the privacy
sweep) passing first. No separate build/bundle step — what's in `web/` is
what ships.

## Changelog

`CHANGELOG.md` (repo root) is a human-readable, feature-grouped log of what
has actually shipped to `main` — not a raw commit log. Add a new dated entry
in that same style (feature/fix name + files touched, then bullets on what
changed and why) as part of every push; work that's still local/uncommitted
doesn't belong there yet.
