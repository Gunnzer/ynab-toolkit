# Changelog

What's actually shipped to `main` (and from there, GitHub Pages), grouped by
feature and dated by when it landed — not a line-by-line commit log. Each
entry names the files it touched. Work that never made it past a local
session doesn't appear here; an entry is only added once it's pushed.

Maintained going forward: add a new dated entry for each push, in this same
style (feature/fix name and files, then bullets on what changed and why),
before or as part of the push itself.

## 2026-08-23

**RTA Tracker: snapshot automatically on every budget refresh** (`state.js`, `rtatracker.js`, `CLAUDE.md`)
* A snapshot used to only happen when you pressed "Snapshot now" on the RTA Tracker page itself. `AppState.reloadAll()` - the one place both the topbar Refresh button and Setup's Connect flow go through - now takes a snapshot on its own, wrapped in try/catch so a snapshot failure never fails the refresh that already succeeded. Respects the tool's enable/disable toggle. The page's own button now calls this same shared method instead of duplicating the fetch.

**New tool: RTA Tracker** (`rtatracker.js`, `rta_tracker.js`, `api.js`, `main.js`, `CLAUDE.md`, `rta_tracker.test.js`)
* Ready to Assign is not scoped to the current month - it's a running total carried forward since the budget started, so a backdated paycheque can shift it without showing up in this month's own activity. Added a tool that snapshots Ready to Assign each time you run it and tries to explain a shift by finding backdated/uncategorized transactions.
* Uses a new `client.transactionsDelta()` (delta sync via `last_knowledge_of_server`, not a date filter) so an edit or delete is caught even if it doesn't change the transaction's own date.
* Flags a transaction as a likely cause only if it's dated before the current month, has no real category, isn't a split's parent record (which also reads `category_id: null`), and isn't a transfer. Sums the flagged amounts and checks that against the actual RTA delta, saying plainly when they don't fully agree rather than presenting a partial explanation as complete.

**Sidebar reorganized into top-level sections, matching YNAB's own** (`main.js`, `setup.js`, `app.css`, `CLAUDE.md`)
* The sidebar's eight tools are now grouped under three (now four, with RTA Tracker's own "Tracking" group) plain section labels - YNAB Info & Reporting, Tracking, YNAB Together, Cleanup - with every page listed directly underneath as its own clickable item. A hover/click flyout menu was tried first and replaced, since it hid a page behind an extra step. Setup's "Tools" enable/disable list mirrors the same grouping.

**Bank Import: friendlier payee rules, column examples, clearer date format picker** (`bank.js`, `CLAUDE.md`)
* Add/Edit rule now offers "Contains this text" as the default, alongside the original "Regular expression (advanced)" mode - no regex knowledge needed for the common case of renaming any payee containing some text. Both modes share a live "Try it" preview that updates as you type, instead of needing to save and separately open Test a name.
* Each column dropdown (Date/Payee/Amount/Memo/Outflow/Inflow) now shows an `e.g. "..."` example value underneath it, pulled from the file's third row (or its last row, for a shorter file), updating live as the mapping changes.
* The "Date format to write" dropdown's three examples all used day 5 - indistinguishable between MM/dd and dd/MM at a glance. Changed to day 23 so all three formats actually look different from each other; the separate "Read 03/05/2025 as" ambiguity-resolver was left alone, since a genuinely ambiguous date is the whole point of that one.

**Bank Import: page reorganized into one "Conversion setup" card** (`bank.js`, `CLAUDE.md`)
* Payee rules used to sit fully expanded on the page at all times; now a "Rules (N)" button opens the full list (add/edit/remove/reorder) in a dialog instead, with Add rule and Test a name staying on the page since those are used often. Caught and fixed a real bug during this change: this app's dialogs all share one `<dialog>` element with no stacking support, so opening Edit or Remove's dialog from inside the Rules dialog corrupted both - fixed by closing the Rules dialog first.
* The old separate "Bank" preset card (save/select/delete a column mapping per bank) was removed outright - the mapping is only a handful of fields and auto-guessing from the file's header row already covers most cases.
* Payee rules and the column mapping (previously two separate cards, one with a floating title once its content moved into a dialog) are now one "Conversion setup" card, with Payee rules first and Columns below it - each a proper subsection heading, not the too-small/muted style tried first. The Convert/Save row moved to the bottom of the same card instead of floating in its own sticky bar underneath.
* The three optional column fields (Memo/Outflow/Inflow) now sit on their own fixed 3-column row, separate from the three required fields (Date/Payee/Amount) on theirs.
* The save button offers QFX or CSV (QFX now default), with the format dropdown moved to the right of the save button; TSV, tried briefly, was removed as unwanted.
* "Push to YNAB" (direct API push, undo) is hidden for now via a `SHOW_PUSH_TO_YNAB` flag - the code underneath is untouched, just not mounted to the page.

**Bank Import: QFX/OFX support, both ways** (`bank_convert.js`, `bank.js`, `CLAUDE.md`, `tools.test.js`)
* Bank Import only read delimited (CSV/TSV/semicolon) exports. Added `parseOfx()`, a line-by-line reader for QFX/OFX's SGML-style tags (most banks write `<DTPOSTED>...` with no closing tag, so it can't go through an XML/DOM parser), pulling date/payee/memo/amount out of each `<STMTTRN>` block.
* A QFX/OFX file is detected by extension or by sniffing for `OFXHEADER`/`<OFX>` in the file's own content, and its output feeds straight into the same column-mapping/convert/payee-rules pipeline a delimited file already uses - the mapping is just pre-filled to the format's own fixed field names instead of guessed from a header row.
* The save button ("Save file...", renamed from "Save YNAB CSV..." to avoid colliding with the unrelated "Save as..." preset button already on the page) now offers a QFX option alongside CSV, via `toOfx()` - QFX is the default. It writes a QFX/OFX file that round-trips cleanly back through `parseOfx()`.

## 2026-08-16

**YNAB Budget: "Whose" filter moved to the top bar, now also narrows Accounts and the headline stats** (`budget.js`, `CLAUDE.md`)
* The "Whose" filter used to sit down in the Categories section and only narrow the category table. Moved it up to the top action bar next to Month, so it reads as a whole-page filter instead of a Categories-only one.
* "Assigned this month" and "Activity" on the headline stat cards now recompute to just the selected person's categories. "Ready to Assign", "Income" and "Age of Money" can't be split per-person (they aren't category-scoped in YNAB's data model), so they keep showing the whole-budget figure with an explicit "(whole budget)" note once a filter is active, rather than a misleading per-person number.
* The Accounts table is now filterable by the same dropdown too, using `payerOf()` (the account-ownership logic Bill Splitting's settle-up math already used) rather than the category-group logic `ownerOf()` uses - an account is either someone's own or unattributed, never literally "shared" the way a category can be, so the filter's "shared" option maps to `payerOf()`'s "joint".

**Shared Expenses: names and Preview/Apply buttons on one line** (`shared.js`)
* The split-ratio line ("Julian 65% · Ara 35%") used to sit on its own line above the Preview/Apply action row. Moved it into the same `card-row` so both sit on one horizontal line, with the buttons still pushed to the right via the spacer.

## 2026-08-15

**Shared Expenses — already-split transactions get their own visible table** (`shared_expenses.js`, `shared.js`, `tools.test.js`)
* Splitting just the shared leg of an already-split transaction (delete + recreate, since YNAB refuses to patch subtransactions on a transaction that's already split) was built, then removed entirely - it caused a real production issue where a category's YNAB budget-page activity total got stuck showing stale figures after the write, persisting across browser, incognito and the mobile app. Already-split transactions are unconditionally skipped again, with no setting or path to convert them.
* Added a dedicated, always-visible "Already split - needs manual review" table on the page, so a multi-split the tool can't touch is still clearly surfaced rather than needing a click into a dialog. The "Skipped" dialog now only covers transfers.

**YNAB Budget: Target as a number, group totals, and a "Whose" filter** (`budget.js`, `app.css`)
* The Target column showed only a thin progress bar with no number anywhere - it now shows the goal's dollar figure and a plain `%` funded instead of a bar.
* Group header rows now total all four numeric columns (Target/Assigned/Activity/Available), not just Available.
* Added the same "Whose" filter (Everyone/Person 1/Person 2/Shared) that Reports and Classic Budget already have, applied to both the category table and the "Needs attention" list.

**Consistency pass — sticky headers rolled out app-wide, two stale patterns fixed** (`app.css`, `budget.js`, `classicbudget.js`, `reports.js`, `autoassign.js`, `duplicates.js`, `shared.js`, `bank.js`, `splitsheet.js`)
* Bill Splitting's Preview table was the only one with a bounded, sticky-header scroll panel; every other main table in the app just grew with the page. Renamed its `.preview-table` CSS class to the generic `.scroll-table` and rolled it out to every other table that can realistically grow long: YNAB Budget's and Classic Budget's category tables, Reports' four breakdown tables, Auto Assign's plan table, Duplicates' results, Shared Expenses' preview and applied tables, and Bank Import's preview.
* Auto Assign's month picker used a native `<input type="month">` (a different widget than every other month picker in the app) plus its own duplicate `thisMonth()` function - switched to the same shared `select(monthOptions(...))` dropdown and `thisMonth()` import every other page already uses.
* Bank Import's preview table was still capped at 50 rows with a "... and N more, all saved" footer - the same pattern Bill Splitting had and removed earlier; removed here too, since expected volume is small enough to just show everything.

**Shared Expenses — splitting a leg of an already-split transaction** (`shared_expenses.js`, `shared.js`, `tools.test.js`)
* A transaction already split into "what came back from friends" + "the genuinely shared portion" (e.g. one person pays a full restaurant bill, two friends transfer back their share) no longer gets skipped outright with "Skip transactions that are already split" unchecked - the leg sitting in a mapped shared category is found and split between the two people, while every other leg is carried through untouched.
* `scan()` matches individual subtransaction legs against shared-category rules, computing each leg's own amount rather than the whole transaction's total.
* `applySplits()` groups planned items by transaction; a group with a matched leg deletes and recreates the transaction (YNAB will not let an update patch subtransactions on one that's already split), preserving every other leg exactly as it was.
* `backupRecord()`/`restoreCreatePayload()` extended to round-trip a full original split, not just a single category, so Undo restores the exact original - friends' leg included.
* Fixed a real bug caught during live testing: the backup now records the transaction's new id after delete+recreate, not the deleted original, so a later Undo doesn't try to delete something that no longer exists.
* `driftCheck()` fixed to key by transaction+leg instead of transaction id alone, since several legs can now share one transaction.
* Preview and the "Last applied" table show the leg's own amount and "(one leg)" instead of the whole transaction's total, and an info tooltip next to the "Skip already split" checkbox explains what unchecking it does.

**Repo cleanup — desktop version removed** (`.gitignore`, `CLAUDE.md`, `web/README.md`)
* Deleted `desktop-archive/` (the old PySide6 desktop app), which was already gitignored and untracked, so this was a local-only removal with no git history impact.
* Removed the now-unused `desktop-archive/` and `ynab_toolkit_config.json` entries from `.gitignore`.
* Updated `CLAUDE.md`'s codebase overview and fixed a stale `web/README.md` line claiming Bill Splitting "stays in the desktop app for now" - it's been in `web/` for a while.

## 2026-08-14

**Bill Splitting — refund/income handling** (`splitsheet.js`, `split_sheet.js`, `splitsheet.test.js`, `tools.test.js`)
* Every inflow (income or refund) is kept as a normal negative row instead of being auto-guessed/dropped.
* Fixed `classifySplit()`: `total <= 0` → `total === 0`, so a genuinely negative (refund) split total no longer gets zeroed out.

**Bill Splitting — Monthly Summary total row** (`splitsheet.js`)
* Appends a bold total row summing every cycle's figures when there's more than one cycle.

**Bill Splitting — sticky Preview header** (`app.css`, `splitsheet.js`)
* The Preview table is now its own bounded, internally-scrolling panel (`.preview-table`) with a frozen header, instead of the header scrolling away with the page.

**Bill Splitting — Owner column pills** (`splitsheet.js`, `app.css`)
* Owner cell renders as a colored pill badge instead of small grey mono text.
* Recolored per explicit feedback: Person 1 = blue, Person 2 = purple, Custom = orange, Shared = grey.
* A Shared row whose actual split has drifted more than 0.05% from the configured ratio (but is still within the classification tolerance) tints yellow instead of plain grey, so a bigger-than-rounding variance is noticeable at a glance.

**Bill Splitting — header index / column-filter bugs** (`splitsheet.js`, `app.css`)
* Fixed the Person-1/Person-2 header repaint using a hardcoded column index, which could silently overwrite the wrong header once the column layout shifted.
* Fixed column filter popups (`position: sticky`'s `display: flex` gotcha) losing their sticky positioning and scrolling away with the table body.
* Fixed filter popups being clipped inside the Preview table's own scroll panel instead of floating on top of it — they now portal to `document.body` with `position: fixed`.

**Shared Expenses — already-split transaction bug fix** (`shared_expenses.js`, `tools.test.js`)
* `scan()` now also matches a rule against a split transaction's subtransaction categories, not just the parent's own `category_id` (which YNAB leaves `null` on any split). An already-split transaction with a leg in a shared category used to be completely invisible to the tool; it's now found and correctly reported as skipped.

**Bill Splitting — Inflows moved to a dialog** (`splitsheet.js`, `ui.js`, `app.css`)
* Income/refunds review moved out of the main Preview table (first as inline checkboxes, then as a second always-visible table — both tried and replaced per feedback) into a dedicated wide popup dialog, opened via an "Inflows (N)" button.
* Ticking an inflow in the dialog moves it into the Preview table and updates the totals live; unticking pulls it back out. Both stay live while the dialog is open.
* Added a general-purpose `wide` option to `customDialog()`/`.dialog.is-wide` for any future dialog that manages a table rather than a form.

**Bill Splitting — removed skip-owned feature** (`splitsheet.js`, `split_sheet.js`, `splitsheet.test.js`)
* Removed the "skip person's own transactions" checkboxes, their settings, and the `buildRows()` filtering logic entirely, per explicit request. Widened the Filters popup (300px → 420px) since it felt cramped.

**Bill Splitting — show all rows, totals, and split % tooltip** (`splitsheet.js`, `app.css`)
* Removed the 60-row cap and "Show all"/"Show first 60" toggle — the Preview table always renders every row now (expected volume is at most a few hundred).
* Added a totals row to the bottom of Preview (Amount/Person 1/Person 2 sums) that reflects whatever column filters are currently active.
* Hovering the Owner pill shows each person's actual split % for that specific row (not the ratio preset), to 2 decimal places, with an explicit message instead of a divide-by-zero when a row's Amount is exactly $0.

**Bill Splitting — split tolerance and the "!" overshoot flag** (`split_sheet.js`, `splitsheet.js`, `app.css`, `splitsheet.test.js`)
* `classifySplit()` now allows a 0.50 percentage point tolerance either side of the configured ratio (64.50%–65.50% for a 65% split) instead of requiring an exact cent-for-cent match, so a real, human-entered split that misses the ratio by a cent or two still reads as "Shared" instead of "Custom".
* Added a small red "!" tag next to the Owner pill (its own separate tag, not folded into the pill) when a row's two displayed percentages — each independently rounded to 2 decimals — add up to over 100%, a display-rounding artifact rather than a data problem.
* The legend below the Preview heading now explains what "!" means.

**Bank Import — "Push to" default** (`bank.js`, `store.js`)
* The account dropdown always defaults to "(choose an account)" now. It used to remember and pre-select whatever account was last pushed to, which risked a real write going to the wrong account without a deliberate choice each time. Removed the now-dead `bankImport.accountId` persistence entirely.

## 2026-08-12

**Move page descriptions into Help** (`ui.js`, `main.js`, `app.css`)
* Every page's intro paragraph (under the heading) was noise once you already knew the tool. `pageHeading()` no longer prints it on the page; it's handed to a new `getPageIntro()`, which the Help dialog reads to show the current page's title and description first.

## 2026-08-11

**Bill Splitting — newest-first sorting** (`split_sheet.js`, `splitsheet.test.js`)
* Both the Preview table and Monthly Summary now sort newest-first, matching each other and how most people scan a transaction list.

**Bill Splitting — settings moved to Setup, account-tag owner codes** (`setup.js`, `splitsheet.js`, `split_sheet.js`, `app.css`)
* Moved Bill Splitting's rarely-touched file-reading settings (date order, split memo pattern, Excel serial) to the Setup page, leaving only a small popup-button payee filter on Bill Splitting itself.
* Owner-column P1/P2 codes now prefer each person's account tag (already set on Setup) over a literal "P1"/"P2", and the legend shows their actual name.
* Added an app-styled instant tooltip (`.tooltip`/`data-tooltip`), replacing the browser's native `title` tooltip, which was also getting clipped by the filter popup.

**Bill Splitting — simplified owner codes, exact shared-ratio matching, real income-handling fix** (`splitsheet.js`, `split_sheet.js`, `state.js`, `store.js`, `home.js`, `setup.js`)
* Owner codes collapsed to four fixed letters (P1/P2/S/C) shown as a legend instead of editable fields, with the shared split reusing Setup's own ratio.
* Replaced tolerance-percentage matching with comparing amounts rounded to the cent, so a cent-rounding artifact still matches the shared split while a genuine difference doesn't.
* Fixed a real bug: an API split transaction with a credited-back leg (e.g. a refund recorded as a split) slipped past the income filter and produced negative preview rows.
* Preview rows get an X, with confirmation, to filter out a payee entirely.
* Removed the redundant read-only "two people" section and the unused "strip account tag" toggle. Fixed a sticky-header `border-collapse` rendering glitch.

## 2026-08-10

**Shared Expenses redesign, Excel-style column filters, picker viewport fix** (`shared.js`, `splitsheet.js`, `ui.js`, `app.css`, `CLAUDE.md`)
* Reworked Shared Expenses around a quiet split line, a grouped preview/apply action bar, and an always-visible undo-history section instead of a same-weight Undo button next to Apply.
* Replaced Bill Splitting's single free-text filter with per-column Excel/LibreOffice-style AutoFilter dropdowns, built on the shared category-picker popup component.
* Fixed that same popup pushing off the right edge of the viewport for fields positioned late in a row.
* Added the first `CLAUDE.md` codebase map.

## 2026-08-09

**Collapsible sidebar toggle placement, per-person expense share, independent budget-tool toggles** (`main.js`, `setup.js`, `shared.js`, `store.js`, `app.css`)
* Moved the sidebar collapse button beside Setup and flipped its icon when collapsed, matching YNAB's own convention.
* Replaced Shared Expenses' editable split percentages with a single Setup-managed share field, used by every tool.
* Split YNAB Budget and Classic Budget into independently toggleable tools instead of sharing one on/off flag.

**Shared Expenses — collapsible mapping, no date range, fixed undo** (`shared.js`, `state.js`, `store.js`, `shared_expenses.js`)
* The category mapping card moved behind a closed-by-default disclosure, since it's set up once and rarely touched.
* Removed the From/To date range entirely — Preview now always scans full transaction history for anything sitting in a mapped shared category.
* Apply no longer clears the preview to blank; a "Last applied" table shows exactly what was just converted.
* Fixed two real bugs found against a live budget: a write followed immediately by a reload could show stale pre-write data (only connect ever persisted the session snapshot; Apply and Undo now do too); and Undo silently failed to actually remove a split, since YNAB's API doesn't support clearing subtransactions or changing category on an already-split transaction via update — Undo now deletes the split and recreates the transaction with its original category.

**Bill Splitting income handling, collapsible sidebar, page-actions bar** (`splitsheet.js`, `split_sheet.js`, `bank_convert.js`, `main.js`, `bank.js`, `budget.js`, `classicbudget.js`, `ui.js`, `store.js`, `api.js`)
* A bare inflow (paycheque, interest, refund — money in with nothing out) was excluded outright instead of becoming a negative "expense" row, whichever category or account it landed in (later revisited and changed again — see 2026-08-14 and 2026-08-11 entries above).
* Fixed a split transaction's shared-category leg being credited entirely to person 1 instead of divided by the usual shared ratio, and let the account tag decide ownership when a category group names neither person.
* Added a "Filter by" control on the preview table (Description/Card/Owner/Memo), view-only.
* Sidebar collapses to an icon-only rail via a toggle next to the logo, remembered across sessions.
* Added `pageActions()`: a sticky bar for a page's primary buttons that stays reachable below the topbar while a long table scrolls under it, applied to Classic Budget, Budget and Bank Import.

## 2026-08-07

**Classic Budget: Overbudget section, tweaks, reusable test fixture** (`classicbudget.js`, `app.css`, `tests/fixtures.test.js`, `tests/fixtures/test_budget.js`, `tools.test.js`)
* Replaced the $/% Difference columns with a Budgeted/Activity table (colored red/green/grey by over/under/exact) plus a new Overbudget section at the top, in table order rather than sorted by amount.
* Added a fake three-month YNAB-shaped test budget fixture (accounts, credit cards, category groups, months, transactions — including a split, transfer pairs, an e-transfer pair, a near-duplicate, a flagged and a deleted transaction), replacing one-off inline fixtures across tests.

**Classic Budget polish, auto-loading months, Bank Import presets/push** (`classicbudget.js`, `budget.js`, `bank.js`, `bank_convert.js`, `api.js`, `store.js`, `app.css`)
* Closed the nav flyout's dead hover zone; dropped the Budgeted column's own coloring so only Difference stays colored (overspending now reads + and red); added a Hide unbudgeted toggle; selected month persists across refreshes.
* Both Budget pages now load automatically on picking a month instead of needing a separate Load button.
* Bank Import: named column-mapping presets per bank (save/apply/delete), and a Push to YNAB action writing converted rows straight to a chosen account over the API with dedupe-safe import IDs.

## 2026-08-05

**Add Classic Budget** (`classicbudget.js`, `main.js`, `reports.js`, `splitsheet.js`, `store.js`, `ui.js`, `app.css`)
* New tool: set a planned amount per category (not a YNAB field, just your own plan) and see it next to that category's activity for the selected month, with $ and % difference columns.
* Centralized month-dropdown logic (`thisMonth`/`monthsAgo`/`monthLabel`/`monthOptions`) into `ui.js`, replacing three near-duplicate local copies in Reports and Bill Splitting.

**Reports and Bill Splitting: faster, clearer, no double-counted cycles** (`reports.js`, `splitsheet.js`, `state.js`, `store.js`, `setup.js`, `main.js`, `app.css`)
* Auto Assign and Duplicates now start switched off by default.
* Reports' category pickers now show hidden categories, which they silently left out before.
* Saved filters became a real editable list (rename in place, Update to save changes) instead of a row of tags.
* The four report tables share one column layout, so Items and Spent line up across all of them.
* Categories, accounts, and full transaction history are fetched once at connect and shared by every page (instead of each tool re-fetching), and that fetch now survives a plain reload via tab-scoped `sessionStorage`.
* Refresh moved from the footer to the header and now means "re-read everything for this budget."
* Bill Splitting's settle-up figure gained an info button showing the arithmetic step by step.
* From/To became month pickers naming the start and end of one statement cycle — picking Feb–March on a 6th-to-5th cycle used to fetch two separate cycles and show two settle-ups instead of one.

**Write the README for people using the app, not building it** (`README.md`, `web/README.md`, `splitsheet.test.js`)
* Rewritten to lead with what the seven tools do, then where data lives, that clearing browsing data erases it, and that the exported backup file is the only durable copy — instead of leading with dev-server setup.
* States plainly what the YNAB access token can do and when not to save it.
* Test fixtures switched to invented card names rather than real banking products.

**Share fetched data between pages, explain the settle up** (`state.js`, `main.js`, `splitsheet.js`, `split_sheet.js`, `ui.js`, `tests/privacy.test.js`)
* `AppState` gained one shared transaction cache and one month cache used by every page, so opening several tools in a row costs one fetch instead of one each; a cache fetched from an earlier date satisfies a later, narrower request for free.
* Anything that writes to YNAB invalidates the cache; Shared Expenses still forces a fresh read before applying.
* The footer shows data age and a Refresh action.
* Bill Splitting's settle-up gained a step-by-step explanation (what each person paid, on which cards, the subtraction that produces the result) and now names joint/unrecognised accounts left out of the total.
* Privacy test coverage widened to the README and the deploy workflow, not just `web/`.

**YNAB Toolkit web app — initial release** (whole repo)
* First release: a static, dependency-free web app for the YNAB chores that need doing by hand — Budget, Reports, Shared Expenses, Bill Splitting, Auto Assign, Duplicates, and Bank Import. Runs entirely in the browser against `api.ynab.com` with the user's own token; no server, nothing leaves the device.
* Only Shared Expenses and Auto Assign write to YNAB, and both back up first so a run can be undone.
* Settings live in `localStorage`, exportable to a JSON backup file (the durable copy); the token is kept under a separate key so an export never contains it.
* `tests/privacy.test.js` fails the build if a token, budget id, email address, or third-party host appears in the source, gating the deploy workflow.
