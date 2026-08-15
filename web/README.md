# YNAB Toolkit (web)

A browser version of the toolkit. It is a static site: plain HTML, CSS and ES
modules, no build step, no npm packages, no server.

## What it does

| Tool | What it is for |
| --- | --- |
| Shared Expenses | Turns transactions in your shared categories into native YNAB splits between two people, and can undo any of them. |
| Bill Splitting | Exports shared expenses to a tracker spreadsheet, working out each person's share and who paid. |
| Auto Assign | Empties a holding category into your targeted categories, group by group in the priority order you set. |
| Duplicates | Finds transactions that look imported twice and flags them for review. It never deletes anything. |
| Bank Import | Converts a bank export into the four-column CSV YNAB imports, tidying up payee names on the way. |

## Running it locally

You need Node only to serve the files. There is nothing to install.

```bash
node web/serve.js
```

Then open http://127.0.0.1:8123/. Any static server will do, and so will
GitHub Pages. Opening `index.html` straight off disk does not work: browsers
refuse to load ES modules over `file://`.

## Tests

```bash
node --test web/tests/*.test.js
```

50 tests covering the money maths, all four tools, the settings store, and a
privacy sweep of the source.

## Where your data lives

There is no server behind this app and no account to create. Two things are
stored, both in your own browser:

- **Settings** under `ynab-toolkit.settings`: budget choice, category
  mappings, payee rules, undo history.
- **Your access token** under `ynab-toolkit.token`, and only if you tick
  **Remember on this device**. Left unticked it stays in memory and is gone
  when you close the tab.

The only network requests the app makes are to `api.ynab.com`, with your own
token, straight from your browser. Nothing passes through anyone else.

### If browser storage gets cleared

Clearing browsing data erases both keys, and there is no copy anywhere else to
restore from. So:

- On the Setup page, **Back up settings** writes a JSON file. That file is the
  durable copy. Keep it somewhere you keep other backups.
- **Restore from file** reads it back, on this browser or any other. It is how
  you move your setup to another machine.
- A backup never contains your token. You paste that in again.
- The app asks the browser for persistent storage on load, which stops it
  evicting the settings on its own. It does not stop you clearing them by hand,
  which is exactly what the backup file is for.

**Reset everything** on the Setup page wipes both keys deliberately.

### A note on the token

A YNAB personal access token can read and change everything in your budget.
When you tick **Remember on this device** it is written to this browser's
localStorage in plain text, which any script running on the same site could
read. That is an acceptable trade on your own machine and a bad one on a
shared or public computer: there, leave the box unticked.

Revoke a token any time at
`app.ynab.com` under Account Settings, Developer Settings.

YNAB allows 200 API requests per hour per token. The footer shows how many the
current hour has used.

## Publishing to GitHub Pages

The site is the `web/` folder as-is, published by
`.github/workflows/pages.yml` on every push to `main`. The tests run first
and the deploy depends on them, so a failing privacy check stops the
publish rather than shipping it.

The repository is public because GitHub Pages requires it on the free plan.
That is safe here: the published files contain no token, no budget, no
names and no payees, and every visitor's data stays in their own browser.

Deploying from a branch is not an option here: that mode only serves the
repository root or `/docs`, and this app lives in `web/`. The workflow
uploads that folder instead, and runs the test suite first, so a failing
privacy check stops the deploy rather than publishing.

1. Push the repository to GitHub.
2. Settings, Pages, Build and deployment: set **Source** to **GitHub
   Actions**.
3. Every push to `main` republishes. The site appears at
   `https://<user>.github.io/<repo>/`.

Free for public repositories: 1 GB of site content, 100 GB of bandwidth a
month, 10 builds an hour. This app is a few hundred kilobytes.

Pages sites on free and Pro accounts are **always publicly readable** and
cannot be access-restricted. That is fine here, because the published files
contain nothing personal: no token, no budget, no names, no payees. The
`tests/privacy.test.js` suite fails the build if any of those appear in the
source.

## Layout

```
web/
  index.html          the shell
  serve.js            local static server for testing
  css/app.css         YNAB-style palette and layout
  js/
    main.js           app shell, sidebar, routing
    api.js            YNAB API v1 client
    store.js          settings, token, export and import
    state.js          shared app state
    money.js          milliunits and splitting
    ui.js             DOM helpers, widgets, dialogs, category picker
    tools/            tool logic, no DOM, fully tested
    pages/            one module per page
  tests/              node --test suites
```
