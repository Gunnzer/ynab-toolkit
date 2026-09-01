# YNAB Toolkit - codebase map

**Check this file first** for "where is X" / "how does X work" questions on
this project, before grepping around cold. If the answer isn't here, find it
the normal way (Grep/Read/Explore) - then add what you learned back into this
doc (the right table row, the gotchas list, or a new note) so the next
session doesn't have to re-derive it. Keep entries factual and specific
(file:line, not vague description); if something here turns out to be wrong
or stale, fix it in place rather than leaving it to mislead later.

`web/` is the app. Plain HTML/CSS/ES modules, zero dependencies, no build
step, no server. This is what gets worked on. (An earlier Python/PySide6
desktop version, `desktop-archive/`, was superseded by `web/` and has been
removed entirely - if you find a stray reference to it, it's stale.)

Everything below is about `web/`.

## Where to look first

| I need to... | Go to |
| --- | --- |
| Change a page's UI/behavior | `web/js/pages/<name>.js` |
| Change a tool's actual logic (splitting math, matching rules, CSV parsing) | `web/js/tools/<name>.js` - pure functions, no DOM, fully unit tested |
| Add/change a DOM widget (button, table, dialog, category picker) | `web/js/ui.js` |
| Change styling | `web/css/app.css` - CSS custom properties at the top (`--accent`, `--border`, `--faint`, etc.), grouped sections below with `/* ---------- name ---------- */` headers |
| Change nav, routing, sidebar, or which tools are toggle-able | `web/js/main.js` (`PAGES` array, `App` class) |
| Change what's fetched/cached from YNAB, or session/local storage behavior | `web/js/state.js` (`AppState`) and `web/js/store.js` (`Store`) |
| Change a raw YNAB API call | `web/js/api.js` (`YnabClient`) |
| Money/milliunit math | `web/js/money.js` |

## Page ↔ tool map

| Page (`js/pages/`) | Tool logic (`js/tools/`) | What it does |
| --- | --- | --- |
| `home.js` | - | Landing page, links into each tool |
| `setup.js` | - | Token, budget picker, the two people + their split share, tool on/off switches, backup/restore/reset. Also owns Bill Splitting's rarely-touched file-reading settings (date order, split memo pattern, Excel serial) - see below |
| `shared.js` | `shared_expenses.js` | Converts transactions in shared categories into native YNAB splits; undo via delete+recreate |

`shared_expenses.js`'s `scan()` returns a `skipped` array (`{ transaction, rule, reason }`, `reason` is `"transfer"` or `"already split"`) alongside the existing `skippedTransfers`/`skippedAlreadySplit` counts - the counts stayed for backward compatibility, `skipped` is what a UI actually shows. `shared.js`'s "Skipped" button (`section-head` row next to the "Preview" title, hidden when nothing was skipped, labelled `Skipped (N)`) opens a wide `customDialog` listing exactly which transactions were left out and why, populated fresh each `preview()` run - same "counts alone don't say which ones" reasoning as `applySplits()`'s `applied` array/the "Last applied" table.

**Splitting one leg of an already-split transaction - tried and removed:** for one session, `scan()`/`applySplits()` could further split just the shared-category leg of an already-split transaction (e.g. person 1 pays a full restaurant bill, friends transfer back their share, and the remaining "genuinely shared" leg still needs dividing between the two people), via delete + `createTransactions()` since YNAB's update endpoint refuses to touch subtransactions on a transaction that already has any. It worked and was covered by tests, but caused a real, confusing production issue - a category's YNAB budget-page activity total got stuck showing stale/incorrect figures after the delete+recreate, persisting across browser, incognito and the mobile app, only clearing once *another* write (Undo) touched that category again. Removed entirely at explicit user request ("it just doesn't work") rather than keep chasing what was ultimately a suspected YNAB-server-side reconciliation quirk outside this codebase's control. An already-split transaction is now unconditionally skipped and reported (see below) - there is no setting or path to convert one. If this comes back, budget for confirming with the user first whether YNAB's own aggregate-refresh behavior around delete+recreate has changed, not just re-implementing the same mechanism.

`shared.js`'s "Skipped" button/dialog (transfers only) and the always-visible "Already split - needs manual review" table (below Preview) are two separate destinations for `scan()`'s `skipped` array, split by `reason` in `preview()` (`skippedTransfers` for the dialog, a local `alreadySplit` list for the table). They used to be one combined dialog for both reasons; separated at explicit user request - a multi-split the tool can't touch is a "someone still owes money" problem worth surfacing without an extra click, unlike a skipped transfer, which stays behind the dialog since it's just noise you don't need to act on.

`shared_expenses.js`'s `scan()` matches each transaction to a rule by category id. **Gotcha (real production bug, fixed):** YNAB gives a split transaction's parent record `category_id: null` - the category lives on each subtransaction instead, same as `reports.js`/`split_sheet.js` already assumed (both flatten to subtransaction parts whenever they exist, ignoring the parent's own `category_id`). `scan()` used to check only `transaction.category_id`, so an already-split transaction with one leg in a shared category never matched any rule - not even the `skippedAlreadySplit` counter caught it, since the "already split" check runs only after a rule is found. It was completely invisible, not just skipped. Fixed by falling back to a match against any (non-deleted) subtransaction's `category_id` when the parent's own `category_id` doesn't match. This only makes such a transaction *visible* (found, then correctly skipped and logged as "already split") - it still cannot be converted further, per the existing `updateTransaction` limitation noted below.
| `splitsheet.js` ("Bill Splitting") | `split_sheet.js` | Exports shared expenses to a tracker spreadsheet (CSV/clipboard); each transaction is classified as P1, P2, Shared (the split from Setup), or Custom. Its own page keeps only the payee filter (behind a small "Filters" popup button) and the source/convert/preview flow - everything configured once and rarely touched lives on Setup instead, so there's no "Tool setup" disclosure here |

`split_sheet.js`'s `personCode(which, settings)` is what actually decides the P1/P2 Owner-column letter: it prefers that person's account tag (`person{N}AccountTag`, set on Setup) over the literal "P1"/"P2" fallback, since the tag is already the one-letter identifier the user set up for exactly this purpose. Only "S" (shared) and "C" (custom) are ever fixed, unconditional codes. The Filters popup's info icon uses the new `.tooltip`/`data-tooltip` pattern in `app.css` (instant-appear, app-styled, instead of the browser's native `title` tooltip) - reuse that pattern rather than `title` for any future inline help text, but remember to also set `overflow: visible` on whatever popup contains it, since the default `.picker-popup` clips overflow and a tooltip needs to escape that. **Refund/income handling:** `fromExport`/`fromApi` no longer try to guess whether an inflow is income or a refund (an earlier category-presence heuristic was tried and replaced) - every inflow is kept and turned into a negative-amount row through the normal P1/P2/Shared/Custom classification, same as any expense. `splitsheet.js` sets `row.included = row.Amount >= 0` once per conversion (every negative row - income or refund alike - defaults to excluded, since most inflows are income and refunds are rare). Inflows are reviewed in their own dialog, not inline in the Preview table (two earlier designs were tried and replaced per explicit user feedback: first a single Preview table with a checkbox on every row - confusing, mixed income/refund review in with ordinary expenses; then two always-visible tables, Preview plus a separate always-open Inflows table below it - still too much always-on screen space for something rarely used). The current design: `preview` shows `previewRows()` - every ordinary expense (`Amount >= 0`) plus any inflow that has been ticked in - with no checkbox column of its own (`drawPreview()`). An `inflowsButton` next to the "Preview" heading (`Inflows (N)`, hidden when there are no inflows, count painted by `paintInflowsButton()`) opens `openInflowsDialog()`, a wide (`customDialog(..., { wide: true })`, see the `.dialog.is-wide` CSS gotcha below) modal built fresh on each open from the current `rows`, listing only inflow rows (`Amount < 0`) each with its own include checkbox bound to `row.included`. Ticking a box inside the dialog calls both `drawPreview()` and `showSummary()` immediately (not just `showSummary()`) - the whole point of "moves into preview but stays in inflows so I can uncheck if it was a mistake" (the user's own words) is that the row visibly jumps into the Preview table and the totals update live while the dialog is still open, and unticking pulls it back out just as live. Preview and the dialog share row-rendering via `rowCells(row, codes, { withCheckbox })` and pill-colouring via `ownerCodes()`/`pillClassFor()`, and both read from `previewRows()`/an inline `Amount < 0` filter over the same `rows` array - there's only ever one array, the two views just filter it differently. Column filtering (the funnel icons) only exists on the expense table - inflows are expected to be few enough not to need it, and the funnel's own distinct-values list is drawn from `previewRows()` too, so it only ever offers values actually visible in Preview. `saveCsv()`/`copyRows()`/`monthlySummary()` all still filter the full `rows` array on `row.included` before writing anything out (expense rows pass through unconditionally since they default to `true`). This applies per-leg for split transactions too (every leg is kept, expense and credited-back alike, netted together into one row). `classifySplit()` only special-cases `total === 0`, not `total <= 0` - a negative total (a refund-heavy or all-refund split) classifies the same way a positive one does, just with negative shares; re-introducing a `<= 0` guard would silently zero out real refund amounts. **Owner column styling:** the Owner cell renders as a colored `.pill` badge instead of plain grey `.mono` text - P1 is `pill-blue`, P2 is `pill-purple`, Custom is `pill-warn` (amber - reused as-is since it already read as "orange"), Shared is plain uncoloured `pill` (grey) *unless* it has drifted from the ratio (see the variance-tint note below), in which case it's `pill-caution` (a yellow distinct from `pill-warn`'s amber, so "a bit off" and "genuinely Custom" don't share a colour). `pill-blue`/`pill-purple`/`pill-caution` and their `--blue`/`--purple`/`--caution` (+ `-soft`) root vars were added specifically for this column - `pill-info`/`pill-ok` (the app's general-purpose teal/green) used to be reused for P1/P2 but were swapped out at explicit user request for colours with no other meaning attached elsewhere in the app. **Gotcha:** the Preview table's header row is repainted by index (`paintPreviewHeadings()` swaps the "Person 1"/"Person 2" column headers for the actual names) - it must look up each index via `preview.columns.findIndex(c => c.key === "Share1"/"Share2")` rather than a hardcoded number, since a hardcoded index here previously (when the checkbox column was inline) silently overwrote the wrong header; the dialog's own table is rebuilt fresh on every open with the person names baked straight into the column labels, so it needs no repaint mechanism at all. **`ui.js`'s dialog width:** `customDialog(title, build, options)` accepts `wide: true`, which toggles `.is-wide` on the shared `#dialog` element (`app.css`, `min(920px, 95vw)` instead of the default `min(560px, 92vw)`) - use it for any future dialog that manages a whole table rather than a form's worth of fields, so it isn't squeezed into form-dialog width. (A "skip a whole person's own rows" toggle - two checkboxes in the Filters popup, filtering inside `buildRows()` - was tried and then removed at explicit user request; if something like it comes back, the Owner column's funnel-icon filter in the Preview header is the closer fit, since it's already there and view-only filters are cheaper to reason about than ones that change what Save/Copy/Monthly Summary include.) **No pagination:** the Preview table used to cap itself at 60 rows with a "Show all"/"Show first 60" toggle - removed entirely at explicit user request (expected volume is at most a few hundred rows, and the table is already its own bounded/scrolling panel via `.scroll-table`, so a page-level cap was solving a problem the panel already handles). `drawPreview()` now always renders every row in `filtered`. **Totals row:** appended as the last `<tr class="total-row">` in `drawPreview()`, summing `Amount`/`Share1`/`Share2` over `filtered` (the post-column-filter set) - not over all of `previewRows()` - so narrowing the table with a funnel filter also narrows the total; recomputed on every `drawPreview()` call, so it stays live with everything else (column filters, ticking an inflow in, etc). **Split % tooltip:** hovering the Owner pill shows each person's actual share as a percentage of that row's Amount (`splitPercentInfo()`, using the `.tooltip`/`data-tooltip` pattern, wrapping the pill span rather than a separate info-button) - this is the row's *real* worked-out percentage, not the shared-ratio preset, so a Custom row correctly shows its own uneven split and a Shared row confirms the preset was actually applied. Guards `Amount === 0` explicitly (a split whose two legs fully cancel out, e.g. a purchase and its same-cycle refund/adjustment landing in one grouped row) with a "No split % - amount is $0." message rather than computing a divide-by-zero - both shares are `0` in that case too, so there is no meaningful percentage to show, not even 0%/100%. **`SPLIT_TOLERANCE` (`split_sheet.js`):** `classifySplit()` used to require an exact cent-for-cent match against the shared ratio to classify as "S", which is stricter than it sounds - a real, human-entered split that misses the ratio by even a single cent falls to "C" even though it was clearly meant as the shared split (confirmed against real production data: a $22.50 transaction split $14.63/$7.88 read as Custom because the two legs, whose *unrounded* values were exactly $14.625/$7.875 - a precise 65/35 - each independently round the "wrong way" relative to the transaction's own $22.50 total). Replaced with a tolerance check on person 1's actual percentage of the total (`paid1 / total`, not rounded dollar amounts): within `SPLIT_TOLERANCE` (0.005, i.e. half a percentage point) of the configured ratio either way still counts as "S" - 65% stays a match from 64.50% through 65.50% inclusive. **Gotcha:** the inclusive-edge comparison needs a small epsilon (`SPLIT_TOLERANCE + 1e-9`) beyond the tolerance itself - plain float division (e.g. `64.5/100`) can land a hair on the wrong side of an exact boundary (`0.0050000000000000044` instead of `0.005`), which would otherwise reject a case that is supposed to be an inclusive match; confirmed live, this is not a hypothetical. When the tolerance match succeeds, the output `share1`/`share2` are the row's own actual amounts rounded to the cent (`round2(paid1)`/`round2(paid2)`), not a "clean" ratio-computed pair - showing what was really paid rather than silently substituting idealized numbers. **`VARIANCE_TINT_THRESHOLD` (`splitsheet.js`, the page, not the tool):** a second, much finer threshold (0.0005, i.e. 0.05 percentage points) than `SPLIT_TOLERANCE` (0.5 points) - it never changes whether a row classifies as Shared vs Custom, only whether an already-Shared row's pill tints `pill-caution` (yellow) instead of staying plain grey. `pillClassFor(row, codes)` computes this itself from `row.Share1 / row.Amount` vs `codes.ratio` (added to `ownerCodes()`'s return value alongside the existing code lookups) - it does not read anything off `classifySplit()`'s output beyond the amounts already on the row, since the tool layer has no notion of a "tint," only a code. Guarded on `row.Amount` truthy first, same reasoning as `splitPercentInfo()`'s zero-amount guard. **The "!" overshoot flag:** `splitPercentInfo()` also returns `exceeds100` - the two displayed percentages, each independently rounded to 2 decimals, can add up to just over 100% even for a mathematically exact split (this is exactly the $22.50 example above: 65.02% + 35.02% = 100.04%, a display-rounding artifact, not a data problem). When that happens, `rowCells()` appends a small `.pill-flag` "!" span after the Owner code inside the pill (e.g. "S!"), styled in `var(--error)` regardless of which pill variant it's attached to, with its own `title` explaining why. Both the tolerance and the flag apply everywhere `rowCells()` renders a row - the Inflows dialog included, not just the main Preview table.
| `budget.js` ("YNAB Budget") | - | Read-only look at one month, YNAB's own numbers |

**Accounts filtering:** the same top-bar "Whose" dropdown also narrows the
Accounts table, but accounts use a different ownership function than
categories - `payerOf(card, settings)` (`tools/split_sheet.js`, pre-existing,
built for Bill Splitting's settle-up math) instead of `ownerOf()`. `payerOf`
checks, in order: an explicit `splitSheet.accountOwners` mapping (not folded
into `state.withPeople()`, so `accountOwner()` in `budget.js` merges it in by
hand), then a `(TAG)` prefix on the account name matching
`person{N}AccountTag`, then the account name starting with the person's own
name - returning `"p1"`/`"p2"`/`"joint"` (never a distinct "shared" value,
since an account is either someone's own or unattributed, not literally
shared the way a category can be). The filter's "shared" option is mapped to
`"joint"` for this table only. Verified live: `(J) Visa` / `(A) Chequing` /
`Joint Chequing` correctly split into p1/p2/shared buckets, `all` shows all
three with a correct summed total row.

`budget.js`'s Target column used to show only a thin progress bar with no number anywhere - there was no way to see the actual goal amount, only how far along it was. `.target-cell` (`app.css`) now stacks the goal's dollar figure (`fmt(category.goal_target)`) above the plain `${Math.round(progress * 100)}%` funded (`is-ok` once fully funded) - a bar was tried first and replaced with numbers per explicit request. **Group-row totals:** the collapsible group header row used to total only the Available column - `monthOf(category)` (a small local helper picking the live month figures over the static category) now sums Target/Assigned/Activity too, so collapsing a group still shows its full picture, not just what's left. **"Whose" filter:** `budget.js` had no way to narrow the page to one person's own categories, unlike Reports and Classic Budget which both already have this exact filter. Brought the same pattern over verbatim - an `ownerSelect` (Everyone/Person 1/Person 2/Shared) using `ownerOf(groupName, "", state.withPeople({}))` from `split_sheet.js` to decide each group's owner from the person/group-prefix setup on Setup. It lives in the top `pageActions` bar next to Month, not down by the category table like on Reports/Classic Budget, since it narrows the *whole* page here, not one section - moved up there at explicit request once it became clear it should. It applies in three places: `renderCategories()`'s table (via `visibleGroups()`), `renderAttention()`'s overspent/underfunded lists (via the same `groupOwner()` helper, looked up through the shared `groupNameById()` map), and `renderStats()`'s headline cards - but only for Assigned/Activity, which are genuine sums over categories and so can be recomputed for one person. Ready to Assign, Income and Age of Money cannot: none of them are scoped to a category at all (Ready to Assign is specifically money with no job yet), so there is no coherent "Julian's Ready to Assign" - they always show the whole budget's figure and say so explicitly (`" (whole budget)"`) once a person filter is active, rather than silently looking like a per-person number they are not. `exportCategories()` inherits the filter for free since it already reads from `visibleGroups()`.
| `classicbudget.js` | - | Same idea, but against your own planned amount per category instead of YNAB's Assigned |
| `reports.js` | `reports.js` | Monthly spending by category/payee, filterable, savable filters. Also a Saving mode - see below |
| `spendingexport.js` ("Spending Export") | `spending_export.js` | One person's spending as a horizontal spreadsheet - one row per month, one column per category they own, $0 for a month with no activity - see below |
| `autoassign.js` | `autoassign.js` | Drains a holding category into targeted categories in priority order |
| `duplicates.js` | `duplicates.js` | Flags likely-duplicate transactions; never deletes |
| `bank.js` ("Bank Import") | `bank_convert.js` | Bank export → YNAB's 4-column import CSV, with payee rewrite rules |
| `rtatracker.js` ("RTA Tracker") | `rta_tracker.js` | Snapshots Ready to Assign over time and attributes a shift to backdated/uncategorized transactions |

**Reports: Spending vs Saving mode.** YNAB has no built-in idea of "saving". Three designs were tried before landing here - first *transfers into an account YNAB types as "savings"* (account transfers), then account-level choose/exclude controls to match, then category-level activity (spending's own `toEntries()`/`summarise()`, just pointed at chosen categories) - the last one removed too, once the user pointed out it still reads backwards the moment you actually move the money: transferring out of an "Investing" category to a real brokerage shows up as *spending* in that category, the opposite of what "I saved this" should mean. **Saving mode now reads YNAB's own Assigned figure (`category.budgeted`) per category per month, not transaction activity at all** - assigning money into a category is not affected by what you later do with it, only `activity`/`balance` are. `summariseAssigned()` (`tools/reports.js`) takes `monthlyCategories` - `[{ month, categories: [{ id, name, groupName, budgeted, owner }] }]`, one entry per month in the report's date range - built by `ensureMonthlyCategories()` (`reports.js`) from `state.month()` (one call per month, run concurrently via `Promise.all`, cached per since/until range in `monthlyCategories`/`monthlyRange` module state so re-filtering the same range costs nothing more). Both `reload()` and `refresh()` await it before rendering when `savingMode()` is true; `refresh()` had to become `async` for this (existing callers already fire-and-forget it, same as every other async `onClick`/`onChange` handler in this file). The "Top payees" table has no analog for an assigned amount (it is not tied to any one transaction) - shown as an explanatory empty row (`emptyRow(payeeTable, "Assigned amounts are not tied to a payee.")`) rather than hidden, keeping the same four-table shape either mode. The second stat card is "Categories" (`result.categories.length`) in Saving, "Transactions" (`result.count`) in Spending - `summariseAssigned()` has no transaction count to report. Spending and Saving each remember their own category selection (`settings.categoryIds` vs `settings.savingCategoryIds`) via `categoryIdsKey()`, resolved from `settings.reportMode` - picking "Investing" for Saving never touches Spending's own selection, and vice versa; `filters()` exposes a generic `categoryIds` field (resolved from the *current* mode's key) that both `matches()` and `summariseAssigned()` read the same way. **Gotcha (real bug, caught before shipping):** a saved filter's snapshot carries that same generic `categoryIds` name, so `applySaved()`'s blind `Object.assign(settings, entry.filters)` would land it on whichever key the *currently active* mode resolves to - not necessarily the mode the filter was saved under - silently overwriting the wrong mode's selection. Fixed by applying `reportMode` first, then explicitly routing `categoryIds` through `categoryIdsKey()` (now correctly re-resolved against the just-applied mode) instead of letting Object.assign touch it directly.

**Choose categories, with a group checkbox as a bulk-select shortcut - one control, not two.** "Choose category groups" (whole groups only) became "Choose categories" - `chooseCategories()` lists every individual category, one row per category under its group heading. A group's own checkbox is a convenience, not a separate filtering level: checking or unchecking it just sets every category checkbox inside that group to match, and nothing reads the group checkbox's own state afterward - only the individual category checkboxes are read back out (default when nothing is chosen yet: every box starts checked, i.e. "everything included"). A separate "Exclude categories" dialog/`excludeCategoryIds` setting existed alongside this for one stretch, then was removed entirely at explicit user request ("what's the point of both choose and exclude? if you don't choose it excludes, right?") - not choosing a category already excludes it, and un-picking your way down from "everything" (the group checkbox makes "everything" one click) covers the "mostly all of them, except a couple" case just as well with one control. `categoryIdsKey()` is the only resolver left; there is no `excludeCategoryIdsKey()` any more.

`bank_convert.js` handles two input shapes: delimited text (CSV/TSV/semicolon, `parseDelimited()`, user maps columns) and QFX/OFX (`parseOfx()`, `looksLikeOfx()`). OFX/QFX is SGML, not XML - most banks write `<DTPOSTED>20250305120000` with no closing tag at all, so it cannot go through a DOM/XML parser. `parseOfx()` normalizes adjacent tags with nothing between them (`></` → `>\n<`, needed for the rarer OFX 2.x/XML-style writers that pack several tags on one line) then reads line by line, tracking only `<STMTTRN>...</STMTTRN>` boundaries and pulling `DTPOSTED`/`NAME`(falls back to `PAYEE`)/`MEMO`/`TRNAMT` out of each. `DTPOSTED` carries a timestamp and optional timezone suffix (`20250305120000[-5:EST]`) - only the first 8 digits are the date. Output is the same `{ headers, rows }` shape `parseDelimited()` produces, with fixed header names (`Date`/`Payee`/`Memo`/`Amount`) so it feeds straight into the existing `convert()`/column-mapping/payee-rules pipeline unchanged - `bank.js`'s `readFile()` just pre-fills the mapping to those fixed names instead of guessing from a header row, detected via `.qfx`/`.ofx` extension or `looksLikeOfx()` content-sniffing (`OFXHEADER`/`<OFX>` in the first 400 characters) as a fallback for a renamed/extensionless file.

**Save file format:** `toOfx(rows, { accountName })` writes the converted rows out as a QFX/OFX 1.02 SGML file, an alternative to the existing `toCsv(rows)` - `bank.js` has a small format dropdown (`SAVE_FORMATS`, persisted as `settings.saveFormat`, labels are bare "CSV"/"QFX" - no parenthetical, at explicit user request) next to the save button (dropdown sits to the right of "Save file...", at explicit user request), picking the serializer, file extension and MIME type together. QFX is the default. (A CSV/TSV delimiter choice was tried here too, then removed at explicit user request - only QFX was actually wanted alongside CSV.) The save button is labelled "Save file..." rather than "Save as..." - keep that in mind if a "Save as..." label is ever reused elsewhere on this page, since a duplicate label previously broke a `find(b => b.textContent === "Save as...")` style lookup during live verification.

**Bank presets removed:** `bank.js` used to let you name and save a column mapping per bank (a "Bank" card above Columns, with its own save/select/delete UI, `PRESET_FIELDS`, `settings.presets`). Removed entirely at explicit user request - the mapping is only a handful of fields and auto-guessing from the file's header row already handles most cases, so a whole naming/saving system for it wasn't worth keeping. Any pre-existing `settings.presets`/`settings.presetName` in a user's stored settings is simply ignored now, not migrated - `store.js`'s forward-compatible settings merge means this is harmless, not a breaking change.

`toOfx()` is not a real bank statement - there is no live bank/account id to put in it, just placeholder `<BANKID>`/`<ACCTID>` (the latter set from the account chosen in "Push to", falling back to the source filename) wrapping the converted rows so a QFX/OFX-aware importer (including YNAB's own file import) accepts it; round-tripping it straight back through `parseOfx()` reproduces the same rows (covered by a test). FITID is derived the same way `toYnabTransactions()`'s `import_id` is - date + milliunits + an occurrence counter, so repeated same-day/same-amount rows still get distinct ids. **Gotcha (real bug, caught live):** `Date.prototype.toISOString()` includes a literal `T` separator (`2026-08-23T20:44:23.456Z`); the first cut at `DTSERVER` only stripped `-`/`:` before slicing to 14 characters, leaving a stray `T` in the middle of what OFX expects to be 14 plain digits (`yyyymmddhhmmss`). Fixed by also stripping `T` before the slice. If any other OFX timestamp field is ever built from `toISOString()`, strip `T` there too.

**RTA Tracker** (`rtatracker.js`/`rta_tracker.js`) exists because Ready to Assign is not scoped to the current month - it is a running total of every unbudgeted inflow since the budget started, carried forward. Backdating a transaction (importing a paycheque on the 5th but dating it for a prior pay period) makes YNAB recompute every month's rollover from that date forward, shifting the *current* month's RTA even though the transaction itself lives in a past month and never shows up if you only look at this month's own activity. `settings.snapshots` (an array, `store.section("rtaTracker")`) records `{ timestamp, month, toBeBudgeted, delta, flagged, flaggedSum, summary, serverKnowledge }` each time "Snapshot now" runs; `settings.serverKnowledge` is the delta-sync cursor, persisted separately since it is the thing each new run needs, not something that belongs to any one snapshot. Detecting what changed uses `client.transactionsDelta(budgetId, { lastKnowledgeOfServer })` (`api.js`, a second entry point onto the same `/transactions` endpoint as the existing `transactions()` - added rather than changed, since `transactions()`'s callers all expect a plain array and this one needs to keep `server_knowledge` too) rather than `since_date`: a *date* filter would miss a transaction that was edited or deleted after the fact without changing its own date, where `last_knowledge_of_server` catches any change since that cursor regardless of which date the change touches. `findFlaggedTransactions()` in `rta_tracker.js` looks for transactions dated before the current month with `category_id: null` that are not a split's parent record (same trap `shared_expenses.js` already documents - a split's own `category_id` reads `null` too, but the category lives on its subtransactions) and not a transfer (transfers carry `category_id: null` but do not touch Ready to Assign on their own). `buildAttribution()` sums the flagged transactions and compares that sum back against the actual RTA delta as a sanity check - if they do not match, the summary says so explicitly ("does not fully account for...") rather than presenting a partial explanation as a complete one; a budgeted-amount edit or a category move are both real causes this tool cannot see, since neither shows up as a transaction change.

**A snapshot is taken automatically on every budget refresh, not only when the page is open.** `AppState.snapshotRta()` (`state.js`) holds the actual fetch-and-save logic - `reloadAll()` calls it itself, wrapped in try/catch so a snapshot failure (most likely a rate limit) never fails the refresh that already succeeded. Since `reloadAll()` is what both the topbar Refresh button and Setup's Connect flow call, this is the one place that needed the hook, not two. `snapshotRta()` checks `store.get("tools.enabled", {}).rtaTracker` itself and does nothing if the tool is switched off, the same as any other disabled tool. RTA Tracker's own "Snapshot now" button calls this exact method too (`rtatracker.js`'s `takeSnapshot()` no longer duplicates the fetch) - there is only one definition of what a snapshot contains, called from two places. Verified live: stubbing `requireClient()` and calling `state.reloadAll()` directly recorded a snapshot each time, correctly skipped it when `tools.enabled.rtaTracker` was set to `false`, and the RTA Tracker page picked up snapshots it did not itself take.

**Payee rules are behind a dialog, not shown inline:** the full rules table used to sit on the page permanently - now a "Rules (N)" button (`rulesButton`, in the same row as "Add rule"/"Test a name") opens it in a `customDialog` (wide, "Done"-only) instead, at explicit user request to stop always showing the whole list. This section also used to have its own card with a floating "Payee rules" title - once the table moved into a dialog there was nothing left under that title to anchor it to, so it reads oddly on its own. Folded into one "Conversion setup" card together with the column mapping instead (a single `card(...)` call named `mappingCard`, built after `rulesButton`/`editRule`/`testRule` exist since it references them as children), Payee rules listed first and Columns below it - each its own `sectionTitle()` (a `.field-label` was tried first for these subsections and looked wrong per explicit user feedback - too small and too muted next to the card's own title, which uses the same `sectionTitle()`; nesting `sectionTitle()` inside a card is an already-supported pattern, per the `.card > .section-title + *` CSS rule). The Convert/Save row (`mappingCard.append(...)`, not `pageActions()`) was moved to the bottom of this same card too, at explicit user request - it used to be its own separate sticky `pageActions()` bar underneath, which read as disconnected once Payee rules and Columns were merged into one card above it. `pageActions()` gives itself its own sticky card chrome, so nesting it inside `mappingCard` would look like a card inside a card - a plain `card-row` div is used instead. **Gotcha (real bug, caught live):** every dialog in this app - `customDialog` and `confirmDialog` alike - shares one singleton `<dialog>` element (`openDialog()` in `ui.js` always does `document.getElementById("dialog")`), so there is no dialog stacking. Opening a second dialog (e.g. `confirmDialog` for Remove, or `customDialog` for Edit) while the rules dialog is still open re-attaches listeners to the same shared form; confirmed live, confirming the nested Remove silently closed the *outer* rules dialog too, since both dialogs' `onSubmit` handlers fired off the one shared form. Fixed by having Edit/Remove's onClick call a `closeOpenDialog()` helper first - dispatches a synthetic `"cancel"` event on the shared `<dialog>`, the same event Escape fires, which is exactly what the existing close logic already listens for - before opening the follow-up dialog. Any future feature that opens a dialog from inside another dialog needs the same close-first step; this codebase's dialog system does not support nesting.

**Column mapping shows a live example value:** each column dropdown (`renderMapping()` in `bank.js`) now has an `e.g. "..."` hint underneath it, pulled from `sampleRow()` - the file's third data row if it has one, otherwise its last row, never the header. Repaints on every dropdown change (`paintExample(value)`, called both on first render and inside the `select()`'s `onChange`), so picking a different column updates its own example immediately without needing to hit Convert first. Returns `null` for an empty/unloaded file so the hint stays blank instead of printing `e.g. "undefined"`.

**Add/Edit rule dialog: Simple vs Advanced matching, at explicit user request ("make rule adding more user friendly"):** the dialog used to only expose a raw regex `Pattern`/`Replacement` pair - fine for the two built-in Interac rules (which need a named capture group to pull a name out of the payee), but not approachable for the common case of "if the payee contains this text, rename it to that." A `modeSelect` ("Contains this text" / "Regular expression (advanced)", `RULE_MODES` in `bank.js`) now switches between two field sets in the same dialog (`simpleFields`/`advancedFields`, shown/hidden via `paintMode()`, never removed from the DOM - toggling is instant, no rebuild). Simple mode's "Payee contains" text is escaped into a literal-match pattern via a small `escapeRegExp()` and stored as the rule's real `pattern` - `compileRules()`/`applyPayeeRules()` in `bank_convert.js` need no changes at all, they only ever see a compiled regex either way. The rule object gains two UI-only fields not read by the tool layer: `mode` (which set of fields to reopen into) and `matchText` (the original literal text, so editing a Simple rule doesn't have to try to un-escape its regex back to plain text - it just reads `matchText` directly). **Gotcha (real bug, caught live):** the initial-mode logic was first written backwards - `existing?.mode === "advanced" ? "advanced" : "simple"` defaults anything *without* an explicit mode to Simple, which is wrong for every pre-existing rule (including both built-in Interac rules): a real regex like `^amzn` has no `matchText` to show, so it silently opened into Simple mode with empty fields, discarding the pattern from view (not from storage - Cancel would have left it untouched - but Save would have overwritten a working regex rule with an empty literal-text one). Fixed to `!existing ? "simple" : existing.mode === "simple" ? "simple" : "advanced"` - a brand new rule defaults to the friendlier Simple, but any existing rule without an explicit `mode: "simple"` opens into Advanced, since its `pattern` is real regex either way (legacy data, or written before this toggle existed). A live "Try it" field runs the current draft (whichever mode is active) against `compileRules()`/`applyPayeeRules()` and shows "Becomes: ..." on every keystroke, wrapped in try/catch since a half-typed regex in Advanced mode is expected to throw mid-edit, not surface as an error.

**Push to YNAB is turned off, not removed:** `SHOW_PUSH_TO_YNAB` (`bank.js`, near where the action buttons are built) gates whether the "Push to"/account-picker/push/undo row is appended to the page - it is `false` for now, at explicit user request. `pushToYnab()`, `undoLastPush()`, `accountSelect`, `pushButton`, `undoButton` and `undoLabel` are all still fully intact underneath, just never mounted to the DOM while the flag is off - flip it back to `true` to bring the row back rather than re-writing any of this.

**Verifying downloads without disrupting the person at the keyboard:** clicking a real save/download button in the shared local preview pops the browser's native Save-As dialog on whoever is looking at that browser window, not just in an isolated headless sandbox - if the user is sitting at the same `localhost` instance, this interrupts them. Verify Bank Import's save path (or any other real file-download button) by stubbing `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` for the duration of the click (capture the `Blob` instead of letting the real anchor navigate, then restore both), and read the blob's content back with `blob.text()`. Do not click a real save/download button during live verification while the user might be watching the same browser.

**Spending Export** (`spendingexport.js`/`spending_export.js`) exports one person's spending as a horizontal spreadsheet: one row per month, one column per category *they own*, with $0 shown blank rather than "$0.00" for a category with no activity that month - the column itself still always appears, so every row has the exact same columns and an external tracker built against it never has to handle one that comes and goes. Column set is fully automatic (`ownedCategories()`, every non-hidden/non-deleted category whose group resolves to the chosen person via the same `ownerOf()` used everywhere else) - there is no manual choose/exclude step here, unlike Reports; the user explicitly confirmed auto-detection over a fixed list so a new category shows up on its own. Amounts are spending activity (reuses `reports.js`'s own `toEntries()`), not Assigned - a refund nets off within its own month/category the same way Reports' Spending mode does, gated behind the same "Include income and refunds" checkbox, off by default. Categories owned by neither person (shared) are left out entirely, at explicit user request - this is a one-person export, not a household one. Row/column shape (`buildRows()`) keys internally by category id, not name/label, since two categories in different groups can share a name (e.g. "Gifts" under two different groups). The preview table's column count changes with which person is selected, unlike every other `table()` in the app where columns are fixed at creation - `wrap.columns` (which `emptyRow()`'s colspan reads) has to be kept in sync by hand on every redraw rather than relying on the value `table()` set once.

**Export column headers only, cleaned to a plain category name:** the on-screen table always shows a category's real YNAB name, decoration and all (emoji, an account tag in parens, a goal amount in brackets, a due-date suffix) - that is your own budget and the decoration is meaningful there. The exported CSV/clipboard header does not: at explicit user request ("If it's 0 can you make it blank... Can you make the titles more basic? Like remove emojies () and []"), then further clarified into one general rule ("It's always emoji then the word or words we want to keep followed by a special character, anything after the special character should be discarded"), `cleanLabel()` in `spending_export.js` strips any leading emoji and then cuts the name at its first "decoration" character - `(`, `[`, a hyphen, or an en/em dash (`DECORATION_START`, built from `String.fromCharCode` rather than the literal characters, since source files are scanned for those the same as user-facing text - see the privacy test note below) - discarding everything from there on, in one pass, regardless of what kind of decoration follows or how many different kinds are stacked together (a bracketed goal amount, then a due-date suffix, then a parenthetical per-person progress note, all in the same name). `toCsv()` re-disambiguates by group name if two categories only collide once their decoration is cut off (the same reasoning `ownedCategories()`'s own on-screen `label` disambiguation uses), since `cleanLabel()` itself has no notion of a group. **Gotcha, hit repeatedly while building this:** typing an actual en dash (U+2013) or em dash (U+2014) character anywhere in a source or test file - including inside a regex character class, a code comment, or a test string literal - fails `privacy.test.js`'s "no em dashes or en dashes" scan; there is no exemption for string literals or comments, the scan is over the whole file's raw text. An en/em dash escape sequence typed by hand *looks* like a fix but is not reliable to get right - it can end up written to disk as the literal character instead, depending on the editing path taken - so `String.fromCharCode(0x2013)` / `String.fromCharCode(0x2014)` is the pattern that actually stays scan-clean, both in the tool file's `DECORATION_START` and in `spending_export.test.js`'s en-dash test case.

Every `pages/*.js` exports one `xPage(app)` function that builds and returns
the page's root DOM node. Every `tools/*.js` file is DOM-free and has its own
test file in `web/tests/`.

## Core infrastructure

- **`main.js`** - `PAGES` array (id, title, icon, optional `key` for the
  Setup tool-toggle and optional `group`/`groupLabel` for a sidebar
  section), the `App` class (routing via `go`/`show`,
  `buildNav`, `visiblePages`/`toolEnabled`, and `run(job, {log, buttons})` -
  the standard wrapper every page uses for an async action: sets busy state,
  disables the passed buttons, logs errors, always re-enables in `finally`).
  Four groups cover every toggleable tool (at explicit user request):
  `"info"` → **YNAB Info & Reporting** (YNAB Budget, Classic Budget,
  Reports), `"tracking"` → **Tracking** (Bank Import, RTA Tracker),
  `"together"` → **YNAB Together** (Shared Expenses, Bill Splitting),
  `"cleanup"` → **Cleanup** (Auto Assign, Duplicates). Group order in the
  sidebar follows each group's first appearance in the `PAGES` array, not
  alphabetical or insertion-into-a-Set order - `"tracking"` sits between
  `"info"` and `"together"` because that is where its first member (Bank
  Import) sits in the array, at explicit user request to have it appear
  above "YNAB Together". `buildNav()` renders each group as a plain `.sidebar-section`
  label (the same style already used for the single "Tools" heading above
  the whole list) with the group's own pages listed underneath as regular
  full-size `nav-item` buttons - like YNAB's own sidebar, at explicit user
  request. A hover/click flyout menu (`buildNavGroup()`) was tried first and
  removed - it hid a page behind an extra step instead of always showing it.
  `groupIcon` and the flyout's CSS (`.nav-flyout`, `.nav-item-parent`,
  `.nav-caret`, `.nav-item-wrap`) were removed with it, since nothing reads
  them any more. **`setup.js`'s "Tools" card mirrors the same grouping** rather
  than listing all eight toggles flat - it reads each page's own
  `group`/`groupLabel` (deduping by `page.group || page.id` so an
  ungrouped future page still gets its own "Other" heading instead of being
  silently dropped) rather than hardcoding the three group names a second
  time, so a page's group only ever needs to change in one place
  (`PAGES` here) to move it in both the sidebar and Setup at once.
- **`state.js`** (`AppState`) - the connected client, the loaded budget
  (groups/accounts/transactions), and helpers like `personName(which)`,
  `categoryName(id)`, `withPeople(settings)`. `withPeople()` is the one place
  that folds cross-tool shared config (the two people's names/prefixes/tags,
  *and* their shared-cost split ratio from `sharedExpenses.person1Ratio`)
  into a tool's own settings object - any tool needing "who they are" or
  "how they split" should go through this rather than reading another
  tool's settings section directly. Fetched YNAB data is cached in
  **`sessionStorage`** (`persistSession()`/`restoreSession()`/`invalidate()`)
  so a plain reload is free but nothing survives closing the tab.
  `patchTransactions(updates)` mutates specific cached transactions in place
  after a write, instead of invalidating and re-fetching - use this after any
  action whose result you already know (see `shared.js`'s Apply flow); use
  `invalidate()` when the transaction's *id* changed (delete+recreate, e.g.
  Undo) since a patch can't target an id that no longer exists.
- **`store.js`** (`Store`) - settings persistence in **`localStorage`**
  (`ynab-toolkit.settings`), separate from the token
  (`ynab-toolkit.token`, only written if "Remember on this device" is
  checked). `DEFAULTS` + `deepMerge` gives forward/backward-compatible
  import/export: unknown old keys are harmlessly kept, new keys not in an
  old export just fall back to default. `SCHEMA_VERSION` only gates
  *future* schema rejection, not every shape change - bump it only for a
  genuinely breaking change, not routine new settings.
- **`api.js`** (`YnabClient`) - thin wrapper over YNAB API v1. Notable gotcha
  (confirmed by live testing, not just docs): **you cannot un-split a
  transaction, or change its category while it's split, via `updateTransaction`.**
  The only way to revert a split back to a single category is
  `deleteTransaction` + `createTransactions` with the original details. See
  `shared_expenses.js`'s `undoFromBackup`.
- **`ui.js`** - `el(tag, attrs, ...children)` is the DOM builder every page
  uses (`onClick`/`onInput`/etc. map to `addEventListener`; `class`/`text`
  are shorthands). `pageHeading(title, intro)` no longer prints `intro`
  visibly on the page (every page open with a paragraph of explanation was
  noise once you already knew the tool) - it stashes it in a module
  variable instead, read back by `getPageIntro()`. `main.js`'s `showHelp()`
  calls that to prepend the *current* page's title and description to the
  Help dialog, so the explanation still exists, just behind Help instead of
  always on screen. `table(columns)` builds a `<table>` wrapped in
  `.table-wrap`, returns the wrapper with `.tbody` and `.columns` attached;
  to customize a header cell after creation (e.g. adding a filter icon),
  index into `wrap.querySelectorAll("th")` by
  `wrap.columns.findIndex(c => c.key === ...)`. `categoryPicker(state)` is
  the reusable searchable-dropdown pattern (`.picker`/`.picker-popup`,
  outside-click-to-close via a `pointerdown` listener on `document`) - reuse
  this pattern (see the Bill Splitting column-filter popovers) rather than
  inventing a new popover mechanism. It's the same component everywhere a
  category is picked (Shared Expenses' mapping included), so a fix here
  fixes every caller at once - don't special-case one page's pickers.
  **Gotcha:** `.picker-popup` opens anchored to the field's left edge and
  can size up to 460px wide; a field sitting in the right portion of a row
  (e.g. the last of several columns) can push the popup, search box
  included, off the right edge of the viewport. `open()` in `ui.js` checks
  `popup.getBoundingClientRect().right > window.innerWidth` *after*
  `render()` (not right after the popup is appended - it's empty then, so
  `width: max-content` hasn't accounted for the list content yet) and flips
  to `right: 0` when it would overflow. If a similar popup is added
  elsewhere, remember the same width-depends-on-content-after-render trap.
- **Per-column table filtering** (Bill Splitting's `splitsheet.js`,
  `addColumnFilter()`) - the Excel/LibreOffice AutoFilter pattern: a funnel
  icon in a filterable `<th>` (`.filterable-th`, label + `.th-filter-btn`
  wrapped in an inner `.th-filter-row` div - see the sticky-header gotcha
  below for why it's not flex on the `<th>` itself) opens a popup built on
  the same `.picker-popup` shell as `categoryPicker` (`.filter-popup`),
  containing a search box, a "(Select all)" checkbox (`.filter-select-all`),
  a checklist of the column's distinct values (`.filter-value-list`), and
  OK/Cancel (`.filter-popup-actions`). Selection is worked on in a scratch
  `Set` until OK commits it into the page's `columnFilters` map (`null` = no
  filter, otherwise the Set of allowed values); Cancel/outside-click
  discards the scratch copy untouched. Reuse this whole block (copy
  `addColumnFilter` and its CSS) for any other table that needs the same
  filter UI - don't reinvent a plain single-text filter box again, that was
  the thing this replaced.
- **Gotcha:** `th` uses `box-shadow: inset 0 -1px 0 0 var(--border-strong)`
  for its bottom line, not `border-bottom`. A sticky (`position: sticky`)
  `<th>` inside a `border-collapse: collapse` table paints its collapsed
  border out of sync with neighbouring cells once some headers are laid out
  differently from others (e.g. the filterable ones being flex containers
  for their funnel icon) - the header row's bottom line visibly is not
  straight even though every cell's computed geometry is identical. An inset
  box-shadow sits inside the cell instead of collapsing with neighbours, so
  it does not have this problem. Keep using box-shadow, not border, for any
  future sticky header styling.
- **Gotcha (bigger one, confirmed live):** `position: sticky` on a `<th>`
  stops working the moment that same `<th>`'s own `display` is changed away
  from the browser default (`table-cell`) - e.g. straight to `display: flex`
  for the filterable headers' label+funnel-button row. In the Preview
  table's bounded/scrolling panel (`.scroll-table`, see below), this showed
  up as exactly the four filterable headers (Card, Payee, Owner, Memo)
  silently failing to stick and scrolling away with the body while the
  plain headers (Date, Amount, the two person columns) stayed correctly
  pinned - column widths still lined up perfectly (`getBoundingClientRect()`
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
  `auto` too whenever `overflow-x` is not `visible` - **even if
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
  can realistically grow long - Reports' four breakdown tables (added once,
  inside the shared `reportTable()` factory), YNAB Budget's and Classic
  Budget's category tables, Auto Assign's plan table, Duplicates' results,
  and Shared Expenses' preview/applied tables. Give any *new* table the
  same class if it can plausibly grow past a screenful - a table nobody
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
  ids, emails, and other things that must never appear in a public repo -
  **this gates the GitHub Pages deploy** (`.github/workflows/pages.yml`
  fails the build if it fails).
- `tests/store.test.js` covers settings import/export/schema behavior.
- Day-to-day: run only the test file(s) for the page/tool you touched, plus
  `node --check <file>.js` for a fast syntax check. Run the full suite (and
  do a real browser check) before a push, not after every small edit - see
  memory: testing-scope preference.

## Conventions worth matching

- No em dashes / en dashes anywhere a user reads, or in source comments -
  `privacy.test.js` enforces this.
- No comments explaining *what* code does; comments exist for *why*
  (a non-obvious constraint, a workaround, a past bug). Match the existing
  file's tone if you add one.
- Destructive/rare actions (Undo, Clear all, Reset) get a `confirmDialog`
  and are visually de-emphasized (small, or styled as a link via
  `.btn-link`) - see `shared.js`'s Undo-as-link-in-history-section pattern.
- Settings-heavy tool pages follow: read-only summary of cross-tool settings
  (name/split, defined once in Setup) → collapsible "tool setup" `<details>`
  block for rarely-touched config → primary action row → results table →
  log pane. `shared.js` and `splitsheet.js` are the clearest examples.
- CSS variables over hardcoded colors, always (`var(--accent)`,
  `var(--faint)`, `var(--border-strong)`, etc.) - see the `:root` block at
  the top of `app.css` for the full palette.

**Responsive breakpoints (`app.css`, bottom "Responsive" section):** two
tiers, tablet at `max-width: 900px` then phone at `max-width: 560px` (a
phone always matches both - the 560px rules only add to or override the
900px ones, never replace the whole approach). 900px turns the sidebar
into a wrapping horizontal top bar; that's as far as tablet needs to go.
560px is for what only breaks once the viewport itself gets phone-narrow:
nav items shrink further so a full tool list wraps to two rows instead of
three or four, `--gutter`/card padding/stat-card padding all tighten,
table cells get denser (no attempt to reflow a wide table into cards -
`.table-wrap`'s existing horizontal scroll is the mobile answer for
Reports'/Bill Splitting's many-column tables, since a card layout would
need its own per-table column-priority rules), dialogs get tighter
padding, and a wrapped row of buttons (`.card-row .btn`) goes full-width
so each is an easy tap target instead of a cramped half-row. **Gotcha:**
Bank Import's column-mapping grid (`bank.js`) used to be a `.card-grid`
with an inline `style="grid-template-columns: repeat(3, 1fr)"` overriding
the class's own auto-fit, specifically so 3 related fields (Date/Payee/
Amount, then the 3 optional ones) stayed grouped together while a desktop
window narrows, instead of the auto-fit's usual wrap-to-2-then-1. An
inline style can't be touched by a later, more specific selector, so it
would have stayed 3-up (each select ~100px wide, unusable) even on a
phone. Moved into a real class, `.map-grid-3` (3 columns by default,
collapses to `1fr` inside the phone breakpoint) so the desktop grouping
behavior is preserved while phones still get one field per row. Any
future page-specific grid override should be a class for the same reason
- an inline style is invisible to every other breakpoint.

## Deploy

`web/` is published as-is to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main`, gated on the test suite (including the privacy
sweep) passing first. No separate build/bundle step - what's in `web/` is
what ships.

## Changelog

`CHANGELOG.md` (repo root) is a human-readable, feature-grouped log of what
has actually shipped to `main` - not a raw commit log. Add a new dated entry
in that same style (feature/fix name + files touched, then bullets on what
changed and why) as part of every push; work that's still local/uncommitted
doesn't belong there yet.
