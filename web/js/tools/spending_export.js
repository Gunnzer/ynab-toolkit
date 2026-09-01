// Spending Export: one person's spending, one row per month, one column
// per category they own - a horizontal shape meant for pasting into an
// external spreadsheet or tracker, not a report to read on screen. Every
// category currently owned by that person becomes a column on every row,
// filled with $0 when nothing was spent that month rather than the column
// just not being there - that consistency (every row has the same shape,
// every month) is the entire point of exporting it this way instead of a
// long list of "category, amount" pairs.

import { toEntries } from "./reports.js";
import { ownerOf } from "./split_sheet.js";

export { toEntries };

/**
 * Every category currently owned by `owner` ("p1" or "p2"), in budget
 * order (group by group, category by category within each group) rather
 * than alphabetical, so the export reads the way the budget itself is
 * laid out. Ownership is decided at the group level, same as everywhere
 * else in the app (ownerOf) - a category has no owner of its own, only
 * the group it lives in does.
 *
 * Two categories can share a name across different groups (rare, but
 * possible - "Gifts" under both a personal and a shared goals group,
 * say). `label` disambiguates only when that actually happens, so the
 * common case still gets a plain column header.
 */
export function ownedCategories(categoryGroups, owner, settings) {
  const seen = new Map();
  const out = [];

  for (const group of categoryGroups || []) {
    if (group.deleted || group.hidden) continue;
    if (group.name === "Internal Master Category") continue;
    if (ownerOf(group.name, "", settings) !== owner) continue;

    for (const category of group.categories || []) {
      if (category.deleted || category.hidden) continue;
      seen.set(category.name, (seen.get(category.name) || 0) + 1);
      out.push({ id: category.id, name: category.name, groupName: group.name });
    }
  }

  for (const category of out) {
    category.label = seen.get(category.name) > 1
      ? `${category.name} (${category.groupName})`
      : category.name;
  }

  return out;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Every "YYYY-MM" from sinceIso's month to untilIso's month, inclusive. */
export function monthsBetween(sinceIso, untilIso) {
  const [sy, sm] = sinceIso.split("-").map(Number);
  const [uy, um] = untilIso.split("-").map(Number);
  const months = [];
  let y = sy;
  let m = sm;
  while (y < uy || (y === uy && m <= um)) {
    months.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

/**
 * One row per month in `months` ("YYYY-MM", ascending), one field per
 * category in `categories` (keyed by category id, not label - two
 * categories can share a label, never an id). Values are milliunits of
 * spending; refunds net off within their own month and category the same
 * way Reports' Spending mode works, unless `includeInflow` asks to count
 * income and refunds as their own thing instead of a reduction.
 */
export function buildRows(entries, months, categories, owner, { includeInflow = false } = {}) {
  const ids = new Set(categories.map((c) => c.id));
  const totals = new Map();

  for (const entry of entries) {
    if (entry.owner !== owner) continue;
    if (!ids.has(entry.categoryId)) continue;
    if (entry.amount >= 0 && !includeInflow) continue;

    const month = entry.date.slice(0, 7);
    const key = `${month}|${entry.categoryId}`;
    totals.set(key, (totals.get(key) || 0) - entry.amount);
  }

  return months.map((month) => {
    const row = { month };
    for (const category of categories) {
      row[category.id] = totals.get(`${month}|${category.id}`) || 0;
    }
    return row;
  });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// A "special character" marks the end of the actual category name and the
// start of decoration - the shape people use in practice is emoji, then
// the word(s) to keep, then a special character, then anything else: an
// account tag in parens ("(J)"), a goal amount in brackets ("[$1643]"), a
// due-date suffix ("- 11th"), a per-person progress note
// ("(Alex $23.73)"), or any combination/order of those. Cutting at the
// first one handles all of them at once, rather than pattern-matching
// each decoration style on its own. The dash characters below are an en
// dash and an em dash, written as unicode escapes rather than typed
// literally - this file is scanned for those the same as user-facing
// text, see privacy.test.js.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const DECORATION_START = new RegExp(`[([\\-${EN_DASH}${EM_DASH}]`);

/**
 * Cuts a YNAB category name down to just the word(s) before its first
 * decoration character (see DECORATION_START), after stripping any
 * leading emoji - the plain name a spreadsheet header should read. Only
 * used for the exported column headers, not the on-screen preview table:
 * on screen you are looking at your own budget and the decoration is
 * meaningful there, but a tracker you paste this into just wants
 * "Internet", not "(globe emoji) Internet [$67.80] - 11th (Alex $23.73)".
 */
function cleanLabel(text) {
  const withoutEmoji = String(text || "").replace(/\p{Extended_Pictographic}/gu, "");
  const cut = withoutEmoji.search(DECORATION_START);
  const kept = cut === -1 ? withoutEmoji : withoutEmoji.slice(0, cut);
  return kept.replace(/\s+/g, " ").trim();
}

/**
 * A horizontal CSV: Month, then one column per category, cleaned down to
 * a plain name (see cleanLabel) - re-disambiguated by group name if two
 * categories' names collide only once the decoration is cut off, the
 * same way ownedCategories() disambiguates its own on-screen label.
 * `monthLabelFor` formats the month cell (defaults to the raw "YYYY-MM"
 * key); the page passes a friendlier "March 2026" formatter. A $0 cell is
 * left blank rather than printed as "0.00" - the column itself still
 * always appears (that consistency is the whole point of this shape),
 * just with nothing in it for a month with no activity, easier to scan
 * than a grid of zeroes.
 */
export function toCsv(categories, rows, monthLabelFor = (m) => m) {
  const cleaned = categories.map((c) => cleanLabel(c.name));
  const counts = new Map();
  for (const label of cleaned) counts.set(label, (counts.get(label) || 0) + 1);
  const headerLabels = categories.map((c, i) =>
    counts.get(cleaned[i]) > 1 ? `${cleaned[i]} (${c.groupName})` : cleaned[i]);

  const header = ["Month", ...headerLabels];
  const lines = [header.map(escapeCsv).join(",")];

  for (const row of rows) {
    const cells = [
      monthLabelFor(row.month),
      ...categories.map((c) => (row[c.id] ? (row[c.id] / 1000).toFixed(2) : "")),
    ];
    lines.push(cells.map(escapeCsv).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}
