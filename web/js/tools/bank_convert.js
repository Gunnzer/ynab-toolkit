// Bank export -> YNAB import CSV.
//
// Sniffs the delimiter, normalises the date, parses amounts tolerantly
// (currency symbols, thousands separators, comma decimals), rewrites payee
// names with rules you control, and produces Date,Payee,Memo,Amount.

export const YNAB_COLUMNS = ["Date", "Payee", "Memo", "Amount"];

export class ConvertError extends Error {}

// ---------- reading ----------

export function sniffDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(";")) return ";";
  return ",";
}

/** Parse delimited text, honouring quoted fields containing the delimiter. */
export function parseDelimited(text, delimiter = null) {
  const sep = delimiter || sniffDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const clean = text.replace(/^﻿/, "");

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  if (!nonEmpty.length) {
    throw new ConvertError(
      "Could not read the file. Check that the first row is a header row.");
  }

  const headers = nonEmpty[0].map((h) => h.trim());
  const records = nonEmpty.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, position) => {
      record[header] = (values[position] ?? "").trim();
    });
    return record;
  });
  return { headers, rows: records };
}

// ---------- value parsing ----------

// Year-first shapes are unambiguous. The three short shapes are not, so
// their order is decided by the caller: "03/05/2025" is March 5th to a
// North American bank and 3rd May to most others, and nothing in the file
// says which. Month-first matches the original PowerShell script, which
// parsed with InvariantCulture.
const DATE_PATTERNS = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ["y", "m", "d"] },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ["y", "m", "d"] },
  { re: /^(\d{4})(\d{2})(\d{2})$/, order: ["y", "m", "d"] },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, ambiguous: true },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, ambiguous: true },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, ambiguous: true },
];

export const MONTH_FIRST = "monthFirst";
export const DAY_FIRST = "dayFirst";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(value) {
  return String(value).padStart(2, "0");
}

/**
 * Return { value, ok }. Like the original, an unparseable date is kept
 * as-is rather than silently dropped.
 *
 * Ambiguous numeric dates (both parts <= 12) are read day-first, matching
 * the desktop app's ordering.
 */
export function parseDate(raw, outFormat = "yyyy-MM-dd", {
  dateOrder = MONTH_FIRST,
} = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "", ok: false };

  const shortOrder = dateOrder === DAY_FIRST
    ? ["d", "m", "y"] : ["m", "d", "y"];

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const order = pattern.ambiguous ? shortOrder : pattern.order;
    const parts = {};
    order.forEach((key, index) => {
      parts[key] = Number(match[index + 1]);
    });
    if (parts.m > 12 && parts.d <= 12) {
      const swap = parts.m;
      parts.m = parts.d;
      parts.d = swap;
    }
    if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) continue;
    return { value: formatDate(parts, outFormat), ok: true };
  }

  // "5 Mar 2025", "Mar 5, 2025"
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/) ||
    text.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const isDayFirst = /^\d/.test(named[1]);
    const month = MONTHS[(isDayFirst ? named[2] : named[1]).slice(0, 3).toLowerCase()];
    if (month) {
      return {
        value: formatDate({
          y: Number(named[3]),
          m: month,
          d: Number(isDayFirst ? named[1] : named[2]),
        }, outFormat),
        ok: true,
      };
    }
  }

  return { value: text, ok: false };
}

function formatDate({ y, m, d }, outFormat) {
  if (outFormat === "MM/dd/yyyy") return `${pad(m)}/${pad(d)}/${y}`;
  if (outFormat === "dd/MM/yyyy") return `${pad(d)}/${pad(m)}/${y}`;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Tolerant money parser. Whichever separator appears last is the decimal
 * point, so both "1,234.56" and "1.234,56" parse correctly.
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return { value: 0, ok: false };
  if (typeof raw === "number") return { value: raw, ok: true };

  let text = String(raw).trim();
  if (!text) return { value: 0, ok: false };

  const negativeParens = text.startsWith("(") && text.endsWith(")");

  text = text.replace(/[^\d.\-,]/g, "");
  if (!text || ["-", ".", ","].includes(text)) return { value: 0, ok: false };

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  text = lastComma > lastDot
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");

  const value = Number(text);
  if (Number.isNaN(value)) return { value: 0, ok: false };
  return { value: negativeParens && value > 0 ? -value : value, ok: true };
}

export function toTitleCase(text) {
  if (!text || !text.trim()) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const TRAILING_JUNK = /\s*[-,(].*$/;

/** Compile enabled rules, reporting any that fail so they can be shown. */
export function compileRules(rules) {
  const compiled = [];
  const errors = [];
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    if (!rule.pattern) continue;
    try {
      compiled.push({ regex: new RegExp(rule.pattern, "iu"), rule });
    } catch (error) {
      errors.push(`${rule.label || rule.pattern}: ${error.message}`);
    }
  }
  return { compiled, errors };
}

/** Return { payee, changed }. The first matching rule wins. */
export function applyPayeeRules(rawPayee, compiled) {
  const original = rawPayee === null || rawPayee === undefined ? "" : String(rawPayee);

  for (const { regex, rule } of compiled) {
    const match = original.match(regex);
    if (!match) continue;

    const transform = (value) => {
      let text = value ?? "";
      if (rule.cleanName !== false) text = text.replace(TRAILING_JUNK, "").trim();
      if (rule.titleCase !== false) text = toTitleCase(text);
      return text;
    };

    const replacement = (rule.replacement || "").replace(
      /\$<([^>]+)>|\$(\d+)/g,
      (_whole, name, index) => {
        const value = name ? match.groups?.[name] : match[Number(index)];
        return transform(value);
      }
    );
    return { payee: replacement, changed: true };
  }

  return { payee: original, changed: false };
}

// ---------- conversion ----------

/**
 * Convert parsed rows into YNAB import rows. Nothing is written; the caller
 * shows them for review and saves afterwards.
 */
export function convert({ headers, rows }, settings) {
  const result = {
    rows: [], totalIn: rows.length, unparsedDates: 0,
    unparsedAmounts: 0, renamedPayees: 0, warnings: [],
  };

  if (!rows.length) {
    throw new ConvertError(
      "No rows found. Make sure the file has a header and at least one " +
      "transaction.");
  }

  const {
    dateColumn, payeeColumn, amountColumn, memoColumn,
    outflowColumn, inflowColumn,
  } = settings;
  const useFlowPair = Boolean(outflowColumn || inflowColumn);

  const missing = [];
  const need = [["Date", dateColumn], ["Payee", payeeColumn]];
  if (!useFlowPair) need.push(["Amount", amountColumn]);
  for (const [label, column] of need) {
    if (!column || !headers.includes(column)) missing.push(`${label} -> '${column || ""}'`);
  }
  for (const [label, column] of [["Outflow", outflowColumn], ["Inflow", inflowColumn],
    ["Memo", memoColumn]]) {
    if (column && !headers.includes(column)) missing.push(`${label} -> '${column}'`);
  }
  if (missing.length) {
    throw new ConvertError(
      "Column mapping does not match this file.\n\nNot found: " +
      missing.join(", ") + "\n\nColumns in the file: " + headers.join(", "));
  }

  const { compiled, errors } = compileRules(settings.payeeRules);
  result.warnings.push(...errors.map((error) => `Rule skipped - ${error}`));

  for (const row of rows) {
    const date = parseDate(row[dateColumn], settings.dateFormat || "yyyy-MM-dd",
      { dateOrder: settings.dateOrder || MONTH_FIRST });
    if (!date.ok) result.unparsedDates += 1;
    // Always kept in ISO too, alongside the display-formatted Date above:
    // the API needs "yyyy-MM-dd" regardless of what the CSV is set to write.
    const isoDate = parseDate(row[dateColumn], "yyyy-MM-dd",
      { dateOrder: settings.dateOrder || MONTH_FIRST });

    let amount;
    let amountOk;
    if (useFlowPair) {
      const outflow = outflowColumn ? parseAmount(row[outflowColumn]) : { value: 0, ok: true };
      const inflow = inflowColumn ? parseAmount(row[inflowColumn]) : { value: 0, ok: true };
      amount = Math.abs(inflow.value) - Math.abs(outflow.value);
      amountOk = outflow.ok || inflow.ok;
    } else {
      const parsed = parseAmount(row[amountColumn]);
      amount = parsed.value;
      amountOk = parsed.ok;
    }
    if (!amountOk) result.unparsedAmounts += 1;
    if (settings.invertAmount) amount = -amount;

    const { payee, changed } = applyPayeeRules(row[payeeColumn], compiled);
    if (changed) result.renamedPayees += 1;

    result.rows.push({
      Date: date.value,
      Payee: payee.trim(),
      Memo: memoColumn ? String(row[memoColumn] ?? "").trim() : "",
      Amount: amount.toFixed(2),
      ISODate: isoDate.value,
    });
  }

  return result;
}

/** Serialise rows to CSV text in YNAB's four-column import format. */
export function toCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [YNAB_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(YNAB_COLUMNS.map((column) => escape(row[column])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Turn converted rows into YNAB API transaction payloads for the given
 * account. import_id follows YNAB's own "YNAB:<milliunits>:<date>:<n>"
 * convention (n counts same-day, same-amount repeats), so pushing the same
 * file twice is recognised as a re-import and skipped rather than
 * duplicated.
 */
export function toYnabTransactions(rows, accountId) {
  const seen = new Map();
  return rows.map((row) => {
    const milliunits = Math.round(Number(row.Amount) * 1000);
    const key = `${milliunits}:${row.ISODate}`;
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);

    return {
      account_id: accountId,
      date: row.ISODate,
      payee_name: row.Payee || null,
      memo: row.Memo || null,
      amount: milliunits,
      cleared: "uncleared",
      import_id: `YNAB:${milliunits}:${row.ISODate}:${occurrence}`,
    };
  });
}

/** Guess a sensible mapping from the file's own headers. */
export function guessColumns(headers) {
  const lowered = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const pick = (candidates) => {
    for (const candidate of candidates) {
      if (lowered.has(candidate)) return lowered.get(candidate);
    }
    return "";
  };
  return {
    dateColumn: pick(["date", "transaction date", "posted", "posting date",
      "transfer date"]),
    payeeColumn: pick(["description", "payee", "details", "merchant",
      "name", "narrative"]),
    amountColumn: pick(["amount", "value", "transaction amount"]),
  };
}
