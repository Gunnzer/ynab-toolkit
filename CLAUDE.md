# YNAB Toolkit — codebase map

**Check this file first** for "where is X" / "how does X work" questions on
this project, before grepping around cold. If the answer isn't here, find it
the normal way (Grep/Read/Explore) — then add what you learned back into this
doc (the right table row, the gotchas list, or a new note) so the next
session doesn't have to re-derive it. Keep entries factual and specific
(file:line, not vague description); if something here turns out to be wrong
or stale, fix it in place rather than leaving it to mislead later.

Two codebases live here. Only one is active:

- **`web/`** — the live app. Plain HTML/CSS/ES modules, zero dependencies, no
  build step, no server. This is what gets worked on.
- **`desktop-archive/`** — a dead Python/PySide6 desktop version, superseded
  by `web/`. Don't edit it; don't let it shadow a search for "where is X" —
  if a page name matches both (e.g. `page_shared.py` vs `pages/shared.js`),
  the web one is the real one. It's kept around for reference only.

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
| `setup.js` | — | Token, budget picker, the two people + their split share, tool on/off switches, backup/restore/reset |
| `shared.js` | `shared_expenses.js` | Converts transactions in shared categories into native YNAB splits; undo via delete+recreate |
| `splitsheet.js` ("Bill Splitting") | `split_sheet.js` | Exports shared expenses to a tracker spreadsheet (CSV/clipboard); each transaction is classified as P1, P2, Shared (the split from Setup), or Custom |
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
  are shorthands). `table(columns)` builds a `<table>` wrapped in
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
  icon in a filterable `<th>` (`.filterable-th`/`.th-filter-btn`) opens a
  popup built on the same `.picker-popup` shell as `categoryPicker`
  (`.filter-popup`), containing a search box, a "(Select all)" checkbox
  (`.filter-select-all`), a checklist of the column's distinct values
  (`.filter-value-list`), and OK/Cancel (`.filter-popup-actions`). Selection
  is worked on in a scratch `Set` until OK commits it into the page's
  `columnFilters` map (`null` = no filter, otherwise the Set of allowed
  values); Cancel/outside-click discards the scratch copy untouched. Reuse
  this whole block (copy `addColumnFilter` and its CSS) for any other table
  that needs the same filter UI — don't reinvent a plain single-text
  filter box again, that was the thing this replaced.
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
