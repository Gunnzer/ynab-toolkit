// Privacy guard.
//
// This app is meant to be published on GitHub Pages, where anyone can read
// every byte of it. Nothing personal belongs in the source: no token, no
// budget, no names, no payees. These tests fail the build if any creeps in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULTS, Store } from "../js/store.js";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXTENSIONS = new Set([".js", ".html", ".css", ".md", ".json", ".svg"]);

function sourceFiles(dir = WEB, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (TEXT_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

const FILES = sourceFiles().map((path) => ({
  path,
  name: relative(WEB, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

// This test file necessarily contains the patterns it looks for.
const SCANNED = FILES.filter((file) => file.name !== "tests/privacy.test.js");

test("there is source to scan", () => {
  assert.ok(SCANNED.length > 10, "expected the web app's files to be found");
});

test("no YNAB access tokens", () => {
  // Personal access tokens are 64 hex characters. Anything that long and
  // that hex-shaped in the source is a mistake.
  const token = /\b[0-9a-f]{40,}\b/i;
  for (const file of SCANNED) {
    const match = file.text.match(token);
    assert.equal(match, null, `${file.name} contains a token-shaped string: ${match?.[0]}`);
  }
});

test("no budget, category or account ids", () => {
  // Every id YNAB hands out is a UUID, and every one of them identifies a
  // real budget belonging to a real person.
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  for (const file of SCANNED) {
    const match = file.text.match(uuid);
    assert.equal(match, null, `${file.name} contains a UUID: ${match?.[0]}`);
  }
});

test("no email addresses", () => {
  const email = /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i;
  for (const file of SCANNED) {
    const match = file.text.match(email);
    assert.equal(match, null, `${file.name} contains an email address: ${match?.[0]}`);
  }
});

test("no third party hosts appear anywhere", () => {
  // api.ynab.com is the only host the app talks to. app.ynab.com is a link
  // the user clicks to fetch a token. Nothing else should be referenced:
  // no CDN, no analytics, no fonts, nothing that could see the token.
  const urls = /https?:\/\/([\w.-]+)/g;
  const allowed = new Set([
    "api.ynab.com", "app.ynab.com", "www.w3.org", "localhost", "127.0.0.1",
  ]);
  for (const file of SCANNED) {
    for (const [, host] of file.text.matchAll(urls)) {
      assert.ok(allowed.has(host), `${file.name} references ${host}`);
    }
  }
});

test("no em dashes or en dashes in anything a user reads", () => {
  for (const file of SCANNED) {
    assert.equal(/[–—]/.test(file.text), false,
      `${file.name} contains a dash character that should be a plain hyphen`);
  }
});

test("no em dashes or en dashes outside web/ either", () => {
  // The scan above starts at web/, so files above it need naming. They are
  // read by people too, and the README is the first thing anyone sees.
  //
  // Paths resolve from this file, so the repository root is two levels up.
  // A missing file fails rather than being skipped: a typo here would
  // otherwise leave the test passing while checking nothing.
  const outside = ["../../README.md", "../../.github/workflows/pages.yml"];
  let checked = 0;

  for (const name of outside) {
    const path = fileURLToPath(new URL(name, import.meta.url));
    assert.ok(existsSync(path), `${name} was not found at ${path}`);
    const text = readFileSync(path, "utf8");
    assert.equal(/[–—]/.test(text), false,
      `${name} contains a dash character that should be a plain hyphen`);
    checked += 1;
  }

  assert.equal(checked, outside.length);
});

test("defaults are a clean slate", () => {
  assert.equal(DEFAULTS.budgetId, "");
  assert.equal(DEFAULTS.budgetName, "");
  assert.equal(DEFAULTS.rememberToken, false);
  assert.equal(DEFAULTS.sharedExpenses.rules.length, 0);
  assert.deepEqual(DEFAULTS.sharedExpenses.backups, {});
  assert.equal(DEFAULTS.autoAssign.holdingCategoryId, "");
  assert.equal(DEFAULTS.autoAssign.holdingCategoryName, "");
  assert.equal(DEFAULTS.autoAssign.groupIds.length, 0);
  assert.deepEqual(DEFAULTS.autoAssign.backups, {});
  assert.equal(DEFAULTS.duplicates.since, "");
  for (const key of ["dateColumn", "payeeColumn", "amountColumn", "memoColumn",
    "outflowColumn", "inflowColumn"]) {
    assert.equal(DEFAULTS.bankImport[key], "", `bankImport.${key} should start empty`);
  }
});

test("nobody is named in the shipped defaults", () => {
  // The two people are defined in one place, and that place starts empty.
  for (const which of ["person1", "person2"]) {
    const person = DEFAULTS.people[which];
    assert.deepEqual(person, { name: "", groupPrefix: "", accountTag: "" },
      `${which} should ship blank`);
  }
  // And no tool keeps its own copy to drift out of step.
  const dump = JSON.stringify(DEFAULTS);
  assert.equal(/person[12]Name/.test(dump), false,
    "a tool is still holding its own copy of a person's name");
});

test("the shipped split sheet defaults name nobody and assume nothing", () => {
  // The shared split itself lives on Setup (sharedExpenses.person1Ratio),
  // not here - split sheet only ships a neutral code, no assumed ratio.
  assert.equal(DEFAULTS.splitSheet.codes.shared, "S");
  assert.equal(DEFAULTS.splitSheet.skipPayeeSubstrings.length, 0);
});

test("the shipped payee rules name nobody", () => {
  for (const rule of DEFAULTS.bankImport.payeeRules) {
    // A rule may capture a name at run time, but must not contain one.
    assert.match(rule.pattern, /\(\?<name>/,
      `rule '${rule.label}' should capture a name rather than hard-code one`);
    assert.match(rule.replacement, /\$<name>/,
      `rule '${rule.label}' should substitute the captured name`);
  }
});

test("an export never carries the token", () => {
  const store = new Store();
  const dump = JSON.stringify(store.exportData());
  assert.equal(dump.includes("token"), false,
    "exported settings must not mention a token at all");
});
