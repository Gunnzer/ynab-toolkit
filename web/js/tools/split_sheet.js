// Bill Splitting: YNAB transactions -> a shared-expense tracker.
//
// Two people share some costs and each pays for things out of their own
// accounts. This works out, per transaction, whose expense it was and what
// each person's share of it is, and writes one row per expense.
//
// The original script hard-coded two names, one 65/35 ratio and a private
// list of payees to ignore. Nothing here knows any of that: every name,
// ratio, code and filter is a setting, and the shipped defaults are blank.

import { parseAmount, parseDate } from "./bank_convert.js";

/** Memo convention marking one half of a manually split transaction. */
export const DEFAULT_SPLIT_MEMO_PATTERN =
  "^\\s*split\\s*\\(\\s*(\\d+)\\s*/\\s*(\\d+)\\s*\\)\\s*";

/** Column names YNAB uses in its own export. */
export const DEFAULT_COLUMNS = {
  accountColumn: "Account",
  dateColumn: "Date",
  payeeColumn: "Payee",
  groupColumn: "Category Group",
  memoColumn: "Memo",
  outflowColumn: "Outflow",
  inflowColumn: "Inflow",
};

export class SplitSheetError extends Error {}

// ---------- classification ----------

/** YNAB writes transfers as "Transfer : Account Name". */
export function isTransfer(payee) {
  return /^\s*transfer\s*:/i.test(String(payee || ""));
}

export function isSkippedPayee(payee, substrings) {
  const text = String(payee || "").toLowerCase();
  return (substrings || []).some(
    (needle) => needle && text.includes(String(needle).toLowerCase()));
}

/** The "(J)" style tag some people put in front of an account name. */
export function accountTag(accountName) {
  const match = String(accountName || "").match(/^\s*\(\s*([^)]{1,4}?)\s*\)/);
  return match ? match[1].trim().toUpperCase() : "";
}

/**
 * Accounts to leave out entirely.
 *
 * Matched on the whole name after trimming, not as a substring: an account
 * called "Visa" should not drag "Visa Rewards" out with it.
 */
export function isExcludedAccount(accountName, settings) {
  const name = String(accountName || "").trim();
  if (!name) return false;
  if ((settings.accountOwners || {})[name] === "exclude") return true;
  return (settings.excludedAccounts || []).some(
    (entry) => String(entry).trim().toLowerCase() === name.toLowerCase());
}

export function stripAccountTag(accountName) {
  return String(accountName || "").replace(/^\s*\([^)]{1,4}\)\s*/, "").trim();
}

/**
 * Whose expense is this: "p1", "p2" or "shared".
 *
 * The category group decides it. Only when a transaction has no group at
 * all does the account tag get a say, which matches the original: a group
 * that names neither person means the cost is shared, rather than falling
 * through to whoever happened to pay.
 */
export function ownerOf(groupName, accountName, settings) {
  const group = String(groupName || "").trim().toLowerCase();
  const p1 = String(settings.person1GroupPrefix || settings.person1Name || "")
    .trim().toLowerCase();
  const p2 = String(settings.person2GroupPrefix || settings.person2Name || "")
    .trim().toLowerCase();

  if (group) {
    if (p1 && group.startsWith(p1)) return "p1";
    if (p2 && group.startsWith(p2)) return "p2";
    return "shared";
  }

  const tag = accountTag(accountName);
  if (tag) {
    if (tag === String(settings.person1AccountTag || "").trim().toUpperCase() &&
      settings.person1AccountTag) return "p1";
    if (tag === String(settings.person2AccountTag || "").trim().toUpperCase() &&
      settings.person2AccountTag) return "p2";
  }
  return "shared";
}

/**
 * Turn "person 1 paid X, person 2 paid Y" into a code and two shares.
 *
 * A share that lands within tolerance of one of your presets is snapped to
 * it, so a 64.8/35.2 split reads as the 65/35 preset rather than as a
 * one-off. Anything else keeps the exact amounts and is marked custom.
 */
export function classifySplit(paid1, paid2, settings) {
  const total = paid1 + paid2;
  const codes = settings.codes || {};
  if (total <= 0) {
    return { code: codes.shared || "S", share1: 0, share2: 0, matched: null };
  }

  const fraction = paid1 / total;
  const tolerance = Number(settings.tolerance ?? 0.02);

  if (Math.abs(fraction - 1) <= tolerance) {
    return { code: codes.person1 || "P1", share1: total, share2: 0, matched: null };
  }
  if (Math.abs(fraction) <= tolerance) {
    return { code: codes.person2 || "P2", share1: 0, share2: total, matched: null };
  }

  for (const preset of settings.ratioPresets || []) {
    const target = Number(preset.person1Percent) / 100;
    if (!Number.isFinite(target)) continue;
    if (Math.abs(fraction - target) <= tolerance) {
      return {
        code: preset.code,
        share1: total * target,
        share2: total * (1 - target),
        matched: preset,
      };
    }
  }

  return { code: codes.custom || "C", share1: paid1, share2: paid2, matched: null };
}

/** What each person owes on a row whose owner is already known. */
export function sharesFor(code, amount, settings) {
  const codes = settings.codes || {};
  if (code === (codes.person1 || "P1")) return [amount, 0];
  if (code === (codes.person2 || "P2")) return [0, amount];

  for (const preset of settings.ratioPresets || []) {
    if (preset.code === code) {
      const target = Number(preset.person1Percent) / 100;
      if (Number.isFinite(target)) return [amount * target, amount * (1 - target)];
    }
  }
  // Custom rows carry their own amounts; nothing to derive.
  return [0, 0];
}

// ---------- dates ----------

/**
 * Excel's serial day number, 1900 system.
 *
 * The epoch is 30 December 1899 rather than the 31st because Excel believes
 * 1900 was a leap year. Keeping the bug is what makes the number match.
 */
export function excelSerial(date) {
  if (!date) return "";
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate()) - epoch) / 86400000);
}

/** m/d/yyyy with no leading zeros, matching the original output. */
export function formatDate(date) {
  if (!date) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function toDate(value, dateOrder) {
  const parsed = parseDate(value, "yyyy-MM-dd", { dateOrder });
  if (!parsed.ok) return null;
  const [year, month, day] = parsed.value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// ---------- input adapters ----------

/**
 * Read a YNAB export.
 *
 * Rows whose memo carries the split marker are gathered by date and payee,
 * because a manually split expense appears once per person.
 */
export function fromExport({ headers, rows }, settings) {
  const columns = { ...DEFAULT_COLUMNS, ...(settings.columns || {}) };
  const required = ["accountColumn", "dateColumn", "payeeColumn", "outflowColumn"];
  const missing = required
    .map((key) => columns[key])
    .filter((name) => !headers.includes(name));
  if (missing.length) {
    throw new SplitSheetError(
      `The file is missing these columns: ${missing.join(", ")}.\n\n` +
      `Columns in the file: ${headers.join(", ")}`);
  }

  const splitPattern = new RegExp(
    settings.splitMemoPattern || DEFAULT_SPLIT_MEMO_PATTERN, "i");

  const items = [];
  const groups = new Map();
  let skippedTransfers = 0;
  let skippedPayees = 0;
  let skippedAccounts = 0;

  for (const row of rows) {
    const payee = String(row[columns.payeeColumn] ?? "").trim();
    if (isTransfer(payee)) { skippedTransfers += 1; continue; }
    if (isSkippedPayee(payee, settings.skipPayeeSubstrings)) {
      skippedPayees += 1;
      continue;
    }

    const accountName = String(row[columns.accountColumn] ?? "").trim();
    if (isExcludedAccount(accountName, settings)) {
      skippedAccounts += 1;
      continue;
    }
    const groupName = String(row[columns.groupColumn] ?? "").trim();
    const rawMemo = String(row[columns.memoColumn] ?? "").trim();
    const date = toDate(row[columns.dateColumn], settings.dateOrder);
    const outflow = parseAmount(row[columns.outflowColumn]).value;
    const inflow = columns.inflowColumn
      ? parseAmount(row[columns.inflowColumn]).value : 0;

    const isSplit = splitPattern.test(rawMemo);
    const memo = isSplit ? rawMemo.replace(splitPattern, "").trim() : rawMemo;
    const base = { accountName, date, payee, groupName, memo };

    if (!isSplit) {
      items.push({ ...base, outflow, inflow, parts: null });
      continue;
    }

    // Each half of a split was paid by one person out of their own account.
    let side = ownerOf(groupName, accountName, settings);
    if (side === "shared") side = "p1";

    const key = `${date ? date.toDateString() : ""}|${payee.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { ...base, memos: [], parts: [] });
    }
    const group = groups.get(key);
    group.parts.push({ owner: side, amount: outflow });
    if (memo && !group.memos.includes(memo)) group.memos.push(memo);
  }

  for (const group of groups.values()) {
    items.push({
      accountName: group.accountName,
      date: group.date,
      payee: group.payee,
      groupName: group.groupName,
      memo: group.memos.join(" | "),
      outflow: 0,
      inflow: 0,
      parts: group.parts,
    });
  }

  return { items, skippedTransfers, skippedPayees, skippedAccounts };
}

/**
 * Read transactions straight from the API.
 *
 * Real YNAB splits arrive as subtransactions, so there is no memo
 * convention to honour here: each part already says which category, and so
 * which person, it belongs to.
 */
export function fromApi(transactions, groupNameFor, settings) {
  const items = [];
  let skippedTransfers = 0;
  let skippedPayees = 0;
  let skippedAccounts = 0;

  for (const transaction of transactions) {
    if (transaction.deleted) continue;
    if (transaction.transfer_account_id) { skippedTransfers += 1; continue; }

    if (isExcludedAccount(transaction.account_name, settings)) {
      skippedAccounts += 1;
      continue;
    }

    const payee = String(transaction.payee_name || "").trim();
    if (isTransfer(payee)) { skippedTransfers += 1; continue; }
    if (isSkippedPayee(payee, settings.skipPayeeSubstrings)) {
      skippedPayees += 1;
      continue;
    }

    const [year, month, day] = String(transaction.date).split("-").map(Number);
    const base = {
      accountName: transaction.account_name || "",
      date: Number.isFinite(year) ? new Date(year, month - 1, day) : null,
      payee,
      groupName: groupNameFor(transaction.category_id) || "",
      memo: String(transaction.memo || "").trim(),
    };

    const subs = (transaction.subtransactions || []).filter((sub) => !sub.deleted);
    if (subs.length) {
      const parts = subs.map((sub) => {
        let side = ownerOf(groupNameFor(sub.category_id), base.accountName, settings);
        if (side === "shared") side = "p1";
        // Milliunits, and outflows are negative in the API.
        return { owner: side, amount: -(sub.amount || 0) / 1000 };
      });
      const memos = subs
        .map((sub) => String(sub.memo || "").trim())
        .filter((memo, index, all) => memo && all.indexOf(memo) === index);
      items.push({ ...base, memo: memos.join(" | ") || base.memo, parts });
      continue;
    }

    const amount = (transaction.amount || 0) / 1000;
    items.push({
      ...base,
      outflow: amount < 0 ? -amount : 0,
      inflow: amount > 0 ? amount : 0,
      parts: null,
    });
  }

  return { items, skippedTransfers, skippedPayees, skippedAccounts };
}

// ---------- conversion ----------

/** Build the output rows. Nothing here touches YNAB or the file system. */
export function buildRows(items, settings) {
  const codes = settings.codes || {};
  const out = [];

  const card = (accountName) => settings.stripAccountTag
    ? stripAccountTag(accountName) : String(accountName || "").trim();

  for (const item of items) {
    if (item.parts) {
      let paid1 = 0;
      let paid2 = 0;
      for (const part of item.parts) {
        if (part.owner === "p2") paid2 += part.amount;
        else paid1 += part.amount;
      }
      const { code, share1, share2 } = classifySplit(paid1, paid2, settings);
      out.push({
        Card: card(item.accountName),
        Date: item.date,
        Description: item.payee,
        Amount: round2(paid1 + paid2),
        Owner: code,
        Share1: round2(share1),
        Share2: round2(share2),
        Memo: item.memo,
        DateAdjusted: item.date,
      });
      continue;
    }

    const owner = ownerOf(item.groupName, item.accountName, settings);
    const code = owner === "p1" ? (codes.person1 || "P1")
      : owner === "p2" ? (codes.person2 || "P2")
        : (settings.defaultSharedCode || codes.shared || "S");

    // Outflow and inflow stay on separate lines, so a refund is visible on
    // its own row rather than quietly reducing a purchase.
    for (const amount of [item.outflow, item.inflow ? -item.inflow : 0]) {
      if (!amount) continue;
      const [share1, share2] = sharesFor(code, amount, settings);
      out.push({
        Card: card(item.accountName),
        Date: item.date,
        Description: item.payee,
        Amount: round2(amount),
        Owner: code,
        Share1: round2(share1),
        Share2: round2(share2),
        Memo: item.memo,
        DateAdjusted: item.date,
      });
    }
  }

  out.sort((a, b) => (a.Date?.getTime() ?? Infinity) - (b.Date?.getTime() ?? Infinity));
  return out;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// ---------- monthly summary ----------

/**
 * The start of the cycle a date falls in.
 *
 * A statement cycle rarely lines up with a calendar month: a 6th-to-5th
 * cycle means the 5th of March belongs to the cycle that opened on 6
 * February. Day 1 gives plain calendar months.
 */
export function cycleStart(date, startDay = 1) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  if (date.getDate() < startDay) start.setMonth(start.getMonth() - 1);
  start.setDate(startDay);
  return start;
}

/**
 * The last day of the cycle that opened on `start`.
 *
 * With no end day the cycle runs right up to the day before the next one
 * opens. Setting one explicitly allows a cycle that closes early, which
 * leaves a gap: dates in that gap belong to no cycle at all, and the
 * summary reports them rather than quietly filing them somewhere wrong.
 */
export function cycleEnd(start, startDay = 1, endDay = 0) {
  if (!endDay) {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    end.setDate(startDay);
    end.setDate(end.getDate() - 1);
    return end;
  }

  // An end day at or after the start day closes in the same month;
  // otherwise it closes in the next one.
  const month = start.getMonth() + (endDay >= startDay ? 0 : 1);
  const lastOfMonth = new Date(start.getFullYear(), month + 1, 0).getDate();
  return new Date(start.getFullYear(), month, Math.min(endDay, lastOfMonth));
}

export function cycleLabel(start, startDay = 1, endDay = 0) {
  if (startDay === 1 && !endDay) {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const end = cycleEnd(start, startDay, endDay);
  const short = (date) => date.toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
  return `${short(start)} - ${short(end)}, ${end.getFullYear()}`;
}

/**
 * Who paid, worked out from the account a row came out of.
 *
 * The explicit mapping wins; the account tag and the person's name are
 * fallbacks so a budget that already names its accounts clearly needs no
 * mapping at all. Anything unrecognised counts as joint, which keeps it out
 * of the "who owes whom" arithmetic rather than guessing wrong.
 */
export function payerOf(card, settings) {
  const name = String(card || "").trim();
  if (!name) return "joint";

  const owners = settings.accountOwners || {};
  if (owners[name] === "p1" || owners[name] === "p2") return owners[name];

  const tag = accountTag(name);
  if (tag) {
    if (settings.person1AccountTag &&
      tag === String(settings.person1AccountTag).trim().toUpperCase()) return "p1";
    if (settings.person2AccountTag &&
      tag === String(settings.person2AccountTag).trim().toUpperCase()) return "p2";
  }

  const lowered = stripAccountTag(name).toLowerCase();
  for (const [which, key] of [[1, "p1"], [2, "p2"]]) {
    const person = String(settings[`person${which}Name`] || "").trim().toLowerCase();
    if (person && lowered.startsWith(person)) return key;
  }
  return "joint";
}

/**
 * Per cycle: what each person spent, what was on each card, and the single
 * transfer that settles up.
 *
 * The balance is what one person's share came to on the other's cards. If
 * person 1 paid for something person 2 owes half of, person 2 owes that
 * half back, and the same in reverse; the difference is the one payment
 * that squares the cycle.
 */
export function monthlySummary(rows, settings = {}) {
  const startDay = Number(settings.cycleStartDay) || 1;
  const endDay = Number(settings.cycleEndDay) || 0;
  const cycles = new Map();
  const outside = [];

  for (const row of rows) {
    if (!row.Date) continue;
    const start = cycleStart(row.Date, startDay);
    const end = cycleEnd(start, startDay, endDay);
    // A cycle that closes early leaves days belonging to nothing.
    if (row.Date > end) {
      outside.push(row);
      continue;
    }
    const key = start.toISOString().slice(0, 10);

    if (!cycles.has(key)) {
      cycles.set(key, {
        key,
        start,
        end,
        label: cycleLabel(start, startDay, endDay),
        share1: 0, share2: 0, total: 0, count: 0,
        owedToP1: 0, owedToP2: 0,
        byCard: new Map(),
      });
    }

    const cycle = cycles.get(key);
    cycle.share1 += row.Share1;
    cycle.share2 += row.Share2;
    cycle.total += row.Amount;
    cycle.count += 1;

    const card = row.Card || "(no card)";
    cycle.byCard.set(card, (cycle.byCard.get(card) || 0) + row.Amount);

    const payer = payerOf(row.Card, settings);
    if (payer === "p1") cycle.owedToP1 += row.Share2;
    else if (payer === "p2") cycle.owedToP2 += row.Share1;
  }

  const result = [...cycles.values()]
    .map((cycle) => {
      const net = cycle.owedToP1 - cycle.owedToP2;
      return {
        ...cycle,
        byCard: [...cycle.byCard.entries()]
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount),
        net: Math.round(net * 100) / 100,
        // Who pays, and how much, to settle the cycle.
        settleFrom: net > 0 ? 2 : net < 0 ? 1 : 0,
        settleAmount: Math.abs(Math.round(net * 100) / 100),
      };
    })
    .sort((a, b) => b.start - a.start);

  // Carried on the array so callers can report it without a second pass.
  result.outside = outside;
  return result;
}

export function columnsFor(settings) {
  return ["Card", "Date", "Description", "Amount", "Owner",
    settings.person1Name || "Person 1",
    settings.person2Name || "Person 2",
    "Memo", "Date Adjusted"];
}

/** Serialise for pasting into a tracker. */
export function toCsv(rows, settings) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columnsFor(settings).map(escape).join(",")];
  for (const row of rows) {
    lines.push([
      row.Card,
      formatDate(row.Date),
      row.Description,
      row.Amount.toFixed(2),
      row.Owner,
      row.Share1.toFixed(2),
      row.Share2.toFixed(2),
      row.Memo,
      settings.includeExcelSerial === false ? "" : excelSerial(row.DateAdjusted),
    ].map(escape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
