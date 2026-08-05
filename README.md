# YNAB Toolkit

Utilities for the parts of YNAB that need doing by hand, as a static web app.
No build step, no dependencies, no server: it runs in your browser and talks
to `api.ynab.com` with your own token.

Everything it knows about you lives in your browser's storage, and can be
exported to a JSON file. Nothing is sent anywhere else.

## Running it

```bash
node web/serve.js
```

Then open http://127.0.0.1:8123/.

ES modules will not load over `file://`, so it has to be served. Any static
server works.

## The tools

| Tool | What it does |
| --- | --- |
| Budget | Where a month stands: ready to assign, what is overspent, what every category holds. |
| Reports | Monthly spending from your history, filtered per person, with saved filters. |
| Shared Expenses | Splits transactions in shared categories between two people, as native YNAB splits. |
| Bill Splitting | Works out whose expense each transaction was and exports one row per expense for a tracker. |
| Auto Assign | Empties a holding category into targeted categories in priority order. |
| Duplicates | Finds transactions imported twice and flags them. Never deletes. |
| Bank Import | Converts a bank export into a CSV YNAB can import, tidying payee names. |

Only Shared Expenses and Auto Assign write to YNAB, and both back up first so
the change can be undone.

## Tests

```bash
node --test "web/tests/*.test.js"
```

Covers the money arithmetic, every tool's logic, the settings store, and a
privacy sweep that fails if a token, budget id, email address or third party
host ever appears in the source.

## More

See [web/README.md](web/README.md) for where your data lives, what happens if
browser storage is cleared, and how to publish it.

The previous Windows desktop version (Python and PySide6) is archived locally
in `desktop-archive/` and is not part of this repository.
