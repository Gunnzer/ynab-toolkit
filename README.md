# YNAB Toolkit

Seven tools for the parts of YNAB that otherwise need doing by hand:
splitting shared costs, filling categories from a holding account, turning
bank exports into something YNAB can import, and reporting on where the
money actually went.

It runs entirely in your browser. There is no server, no account to create
and no database. Your budget data goes from YNAB to your screen and nowhere
else.

## Getting started

1. Open the app.
2. Go to **Setup** and paste a YNAB personal access token. You can create one
   at [ynab.com](https://app.ynab.com/settings/developer) under Account
   Settings, Developer Settings, New Token.
3. Choose your budget. That is it.

Tick **Remember on this device** if you would rather not paste the token
every time. Leave it unticked on a shared or public computer.

## The tools

**Budget** shows where a month stands: what is left to assign, what is
overspent, what each category holds and how far it is towards its target.

**Reports** answers where the money went. Filter by date, by person, by
category group or payee, then save the filter so the same report is one
click next month.

**Shared Expenses** takes transactions in the categories you share with
someone and turns each one into a native YNAB split, at whatever ratio you
set. Every change is backed up first, and any of them can be undone.

**Bill Splitting** works out whose expense each transaction was and what
each person's share of it comes to, then exports one row per expense for a
shared expense spreadsheet. It also gives a monthly summary with a single
settle up figure, and shows the arithmetic behind it.

**Auto Assign** empties a holding category into your targeted categories,
group by group in the priority order you choose, until it runs dry.

**Duplicates** finds transactions that look imported twice and flags them
for review. It never deletes anything.

**Bank Import** converts a bank export into the four columns YNAB wants,
tidying up payee names with rules you control.

Only Shared Expenses and Auto Assign change anything in YNAB, and both save
a backup first so a run can be reversed. Everything else only reads.

Tools you do not use can be switched off in Setup.

## Your data

Nothing is sent anywhere except YNAB. The only network requests the app
makes are to `api.ynab.com`, from your browser, using your own token.

Your settings live in your browser's storage. **Clearing your browsing data
will erase them**, and there is no copy anywhere else, so:

- **Back up settings** on the Setup page writes a file. That file is the
  durable copy. Keep it somewhere you keep other backups.
- **Restore from file** reads it back, in any browser or on any machine.
- A backup never contains your token. You paste that in again.

Two people using the app each have their own settings. Nothing is shared
between browsers unless you send someone a backup file.

### About the token

A YNAB personal access token can read and change everything in your budget.
If you tick **Remember on this device**, it is stored in your browser in
plain text, which is a reasonable trade on your own machine and a bad one on
a shared one. You can revoke a token at any time from the same YNAB page you
created it on.

YNAB allows 200 requests an hour per token. The app fetches your
transactions once and shares them between tools, and the footer shows how
old that data is with a Refresh button when you want it re-read.

## Running it yourself

You need Node installed. Nothing else, and nothing to install.

```bash
node web/serve.js
```

Then open http://127.0.0.1:8123/.

Opening `index.html` straight from disk does not work, because browsers
refuse to load JavaScript modules over `file://`.

## Tests

```bash
node --test "web/tests/*.test.js"
```

Covers the money arithmetic, all seven tools, the settings store, and a
privacy sweep that fails if a token, budget id, email address or third party
host ever appears in the source.
