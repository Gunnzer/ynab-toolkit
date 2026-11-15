// Turning the text of a PDF statement (pdf_text.js) into transactions, for
// Bank Import (at explicit user request: "can the converter tool extract from
// pdf statements?"). Two shapes are understood:
//
//   card  one line per transaction: a date (often two: transaction and
//         posting), the description, and one amount. A purchase is money
//         out; a payment or refund (a minus sign, brackets, or "CR") is in.
//   bank  a table with Withdrawals, Deposits and Balance columns, found by
//         its header row; each amount's column decides its sign. Banks that
//         print the date once per day carry it down to the next lines, and
//         a column order with the date after the amounts (TD) works too.
//
// Years come from the statement period, so a December purchase on a January
// statement lands in the right year. Rows are checked against the running
// balance where the statement prints one.
//
//   readStatement(pages, { dateOrder, today, kind })
//     -> { kind, rows: [{ date, payee, memo, amount }], period, warnings, balanceChecked, balanceOff }

const MONTHS = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, aout: 8, august: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const MONTH_WORD = "(jan(?:uary|vier|v)?|f[e\\u00e9]v(?:r(?:ier)?)?|feb(?:ruary)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il)?|may|mai|june?|juin|july?|juil(?:let)?|aug(?:ust)?|ao[u\\u00fb]t?|sept?(?:ember|embre)?|oct(?:ober|obre)?|nov(?:ember|embre)?|d[e\\u00e9]c(?:ember|embre)?)\\.?";

function plain(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function monthNumber(word) {
  const key = plain(word).replace(/\.$/, "");
  return MONTHS[key] || MONTHS[key.slice(0, 4)] || MONTHS[key.slice(0, 3)] || 0;
}

// Each pattern gives month, day and maybe year, with where it sits in the text.
const DATE_PATTERNS = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  {
    re: new RegExp(`\\b${MONTH_WORD}\\s?(\\d{1,2})(?![\\d.,]\\d)(?:,?\\s+(\\d{4}))?`, "gi"),
    read: (m) => ({ m: monthNumber(m[1]), d: +m[2], y: m[3] ? +m[3] : 0 }),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})\\s?${MONTH_WORD}(?![a-z])(?:,?\\s+(\\d{4}))?`, "gi"),
    read: (m) => ({ d: +m[1], m: monthNumber(m[2]), y: m[3] ? +m[3] : 0 }),
  },
  {
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
    numeric: true,
    read: (m) => ({ a: +m[1], b: +m[2], y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0 }),
  },
];

/** Every date in a piece of text, in order: { m, d, y (0 if none), index, length }. */
export function findDates(text, { dateOrder = "mdy" } = {}) {
  const found = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text))) {
      let parts = pattern.read(match);
      if (pattern.numeric) {
        const dayFirst = dateOrder === "dmy" || parts.a > 12;
        parts = dayFirst ? { d: parts.a, m: parts.b, y: parts.y } : { m: parts.a, d: parts.b, y: parts.y };
      }
      if (!parts.m || parts.m > 12 || !parts.d || parts.d > 31) continue;
      if (found.some((f) => match.index < f.index + f.length && f.index < match.index + match[0].length)) continue;
      found.push({ ...parts, index: match.index, length: match[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

const AMOUNT_RE = /(\()?(-\s?)?(?:\$\s?)?(\d{1,3}(?:[,\u00a0\u202f]\d{3})+|\d+)[.,](\d{2})(\))?(?:\s?(CR|DR|-)(?![a-z]))?(?![\d%]|\s?%)/gi;

/** Every money amount in a piece of text: { value (unsigned), credit, debit, index, length }. */
export function findAmounts(text) {
  const found = [];
  AMOUNT_RE.lastIndex = 0;
  let match;
  while ((match = AMOUNT_RE.exec(text))) {
    const before = text[match.index - 1] || " ";
    // Inside a longer number or a word (a card number, "C12345.00"): not money.
    if (/[\w.]/.test(before) && !match[1] && !match[2]) {
      AMOUNT_RE.lastIndex = match.index + 1;
      continue;
    }
    const value = Number(`${match[3].replace(/[,\u00a0\u202f]/g, "")}.${match[4]}`);
    const mark = (match[6] || "").toUpperCase();
    const minus = Boolean(match[2]) || Boolean(match[1] && match[5]) || mark === "-";
    found.push({
      value,
      // On a card statement a minus or "CR" is a payment or refund.
      credit: minus || mark === "CR",
      minus,
      cr: mark === "CR",
      debit: mark === "DR",
      index: match.index,
      length: match[0].length,
    });
  }
  return found;
}

// ---------- positions ----------

// A line's text with an x position for every character, so a date or an
// amount found in the text can be placed under a column heading.
function charPositions(line) {
  const xs = [];
  const runs = [];
  let text = "";
  for (const item of line.items || [{ x: 0, x2: line.text.length, text: line.text }]) {
    if (text) {
      text += " ";
      xs.push(item.x);
    }
    runs.push({ start: text.length, end: text.length + item.text.length, x: item.x, x2: item.x2 });
    const width = (item.x2 - item.x) / Math.max(item.text.length, 1);
    for (let i = 0; i < item.text.length; i += 1) xs.push(item.x + width * i);
    xs.push(item.x2);
    xs.pop();
    text += item.text;
  }
  const span = (index, length) => {
    const x = xs[index] ?? 0;
    const last = xs[index + length - 1] ?? x;
    const nextX = xs[index + length];
    const charWidth = nextX !== undefined && nextX > last ? nextX - last : 4;
    return { x, x2: last + Math.min(charWidth, 8) };
  };
  // The whole cell a heading word starts, when it starts one: headings are
  // aligned with their column by the cell's edges, not the word's.
  const cell = (index) => runs.find((run) => run.start === index) || null;
  return { text, span, cell };
}

// ---------- statement period and years ----------

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The statement's first and last day, from dates with a year in them. */
export function statementPeriod(lines, { dateOrder = "mdy", today = new Date() } = {}) {
  const dated = [];
  for (const line of lines) {
    if (/\bdue\b|\bpay by\b|\b[e\u00e9]ch[e\u00e9]ance\b/i.test(line.text)) continue;
    const near = /period|statement|closing|opening|from|\bto\b|\bdu\b|\bau\b|relev/i.test(line.text);
    for (const date of findDates(line.text, { dateOrder })) {
      if (date.y >= 2000 && date.y <= 2100) dated.push({ value: iso(date.y, date.m, date.d), near });
    }
  }
  const pool = dated.some((d) => d.near) ? dated.filter((d) => d.near) : dated;
  if (!pool.length) {
    const t = today;
    const end = iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
    return { start: "", end, guessed: true };
  }
  const values = pool.map((d) => d.value).sort();
  return { start: values[0], end: values[values.length - 1], guessed: false };
}

/** The full date for a month and day: the latest one on or before the statement's end. */
export function withYear(m, d, period) {
  const endYear = Number(period.end.slice(0, 4));
  const limit = new Date(`${period.end}T00:00:00`);
  limit.setDate(limit.getDate() + 3);
  for (const y of [endYear, endYear - 1]) {
    const candidate = new Date(y, m - 1, d);
    if (candidate <= limit) return iso(y, m, d);
  }
  return iso(endYear, m, d);
}

// ---------- reading the rows ----------

const CARD_WORDS = /credit limit|minimum payment|payment due|available credit|limite de cr[e\u00e9]dit|paiement minimum/i;

const SUMMARY = /^(previous|new|opening|closing|starting|ending)\s+(statement\s+)?balance|^balance\s+(forward|brought|carried)|^(sub)?total\b|^minimum payment|^payment due|^credit limit|^available credit|^annual interest|^interest rate|^solde|^total\b/i;

// Page headers and footers that can sit right under a table's last row.
const PAGE_FURNITURE = /continued|^page\b|\bpage \d|\bsuite\b|\u00e0 suivre|see reverse|^\d+\s*(of|\/|de)\s*\d+$/i;

// A description that only says what kind of transaction it was; the shop or
// person is then on the line below.
const TYPE_ONLY = /^(?:(?:contactless\s+)?(?:interac\s+)?(?:point of sale|pos|debit card|retail|interac)\s+purchase|(?:interac\s+)?e-?transfer(?:\s+(?:sent|received|deposit|autodeposit))?|pre-?authori[sz]ed\s+(?:debit|payment|pmt)|bill\s+payment|online\s+(?:banking\s+)?(?:payment|transfer|bill payment)|mb-?\s*(?:bill payment|transfer|credit card\/loc pay\.?)|(?:payroll|direct|mobile|abm|atm|branch)?\s*deposit|(?:abm|atm|branch)?\s*withdrawal|(?:customer\s+)?transfer(?:\s+(?:to|from))?|service\s+charge|misc(?:ellaneous)?\.?\s+payment|insurance|mortgage\s+payment|loan\s+payment|cheque|refund|purchase|payment|fee)(?:[\s\-#*:]*[\dA-Z]{0,12})?$/i;

const COLUMN_WORDS = {
  out: /^(withdrawals?|debits?|cheques|paid out|money out|retraits?|withdrawn|amounts? withdrawn|amounts? deducted|cheques\/debits)/i,
  in: /^(deposits?|credits?|paid in|money in|d[e\u00e9]p[o\u00f4]ts?|amounts? deposited|amounts? added)/i,
  amount: /^(amount|montant)/i,
  balance: /^(balance|solde)/i,
  date: /^(date|transaction date)\b/i,
};

// Column words on one line, and where each sits. Words are tried alone and
// with the next word ("Amounts withdrawn", "Paid out"), never letting a pair
// swallow a heading of its own: Scotiabank prints "Transactions" right
// before "withdrawn ($)", which read as one heading and lost the column.
function columnWords(line) {
  const { text, span, cell } = charPositions(line);
  const columns = {};
  const words = [...text.matchAll(/[A-Za-zÀ-ÿ$()/]+/g)];
  words.forEach((word, i) => {
    const next = words[i + 1];
    const pair = next && text.slice(word.index + word[0].length, next.index) === " " ? `${word[0]} ${next[0]}` : null;
    for (const [kind, re] of Object.entries(COLUMN_WORDS)) {
      if (columns[kind]) continue;
      const found = pair && re.test(pair) ? pair : re.test(word[0]) ? word[0] : null;
      if (found) columns[kind] = cell(word.index) || span(word.index, found.length);
    }
  });
  return columns;
}

// A table heading: where its Withdrawals, Deposits, Balance and Date columns
// sit. Words inside one run of text (columns printed close together) are
// placed by their share of the run. Headings that wrap ("Amounts" over
// "withdrawn ($)") can leave Balance or Date on a line just above, so
// `above` (the heading lines right above it, with no amounts) fills those in.
function headerColumns(line, above = []) {
  const columns = columnWords(line);
  // Withdrawals and Deposits, or (Tangerine and others) one signed Amount
  // column beside a running Balance.
  if (columns.out && columns.in) delete columns.amount;
  else if (!(columns.amount && columns.balance)) return null;
  for (const other of above) {
    const more = columnWords(other);
    for (const kind of ["balance", "date"]) if (!columns[kind] && more[kind]) columns[kind] = more[kind];
  }
  return columns.out && columns.in ? columns : { ...columns, single: true };
}

// Up to two lines right above line i on the same page with no amounts in
// them: the rest of a heading that wraps.
function headingAbove(lines, i) {
  const above = [];
  for (let j = i - 1; j >= 0 && above.length < 2; j -= 1) {
    if (lines[j + 1].pageStart || Math.abs(lines[j].y - lines[i].y) > 30) break;
    if (findAmounts(lines[j].text).length) break;
    above.push(lines[j]);
  }
  return above;
}

function nearestColumn(columns, box) {
  let best = null;
  let bestDistance = Infinity;
  for (const kind of ["out", "in", "amount", "balance"]) {
    const col = columns[kind];
    if (!col) continue;
    const center = (box.x + box.x2) / 2;
    // Money is right-aligned under its heading more often than not.
    const distance = Math.min(Math.abs(box.x2 - col.x2), Math.abs(center - (col.x + col.x2) / 2));
    if (distance < bestDistance) {
      best = kind;
      bestDistance = distance;
    }
  }
  return best;
}

function cleanPayee(text) {
  return text
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+\$\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:*]+|[\s\-:*]+$/g, "")
    .trim();
}

function removeSpans(text, spans) {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.index - a.index)) {
    out = `${out.slice(0, s.index)} ${out.slice(s.index + s.length)}`;
  }
  return out;
}

function readCard(lines, period, options) {
  const rows = [];
  for (const line of lines) {
    const text = line.text.trim();
    const dates = findDates(text, options);
    // A short reference number may come first (Scotiabank's "Ref.#").
    if (!dates.length || !/^[#\d\s.]{0,12}$/.test(text.slice(0, dates[0].index))) continue;
    // A second date right after the first is the posting date.
    let end = dates[0].index + dates[0].length;
    if (dates[1] && dates[1].index - end <= 3) end = dates[1].index + dates[1].length;
    const rest = text.slice(end);
    const amounts = findAmounts(rest);
    if (!amounts.length) continue;
    const amount = amounts[amounts.length - 1];
    const payee = cleanPayee(rest.slice(0, amount.index));
    if (!payee || SUMMARY.test(payee)) continue;
    const signed = amount.credit ? amount.value : -amount.value;
    rows.push({ date: withYear(dates[0].m, dates[0].d, period), payee, memo: "", amount: Math.round(signed * 100) / 100 });
  }
  return { rows, balanceChecked: 0, balanceOff: 0, guessedSigns: 0 };
}

function readBank(lines, period, options) {
  const rows = [];
  let columns = null;
  let currentDate = "";
  let lastBalance = null;
  let pendingPayee = "";
  let balanceChecked = 0;
  let balanceOff = 0;
  let guessedSigns = 0;
  // The row(s) the last line with money made, where its description starts,
  // and how many more lines of description it has picked up.
  let lastRows = [];
  let descX = null;
  let extraLines = 0;
  let prevY = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const gap = prevY === null || line.pageStart ? Infinity : Math.abs(prevY - line.y);
    prevY = line.y;
    if (line.pageStart) {
      pendingPayee = "";
      lastRows = [];
    }
    const header = headerColumns(line, headingAbove(lines, i));
    if (header) {
      columns = header;
      pendingPayee = "";
      lastRows = [];
      continue;
    }
    const { text, span } = charPositions(line);
    const dates = findDates(text, options).filter((date) => {
      const box = span(date.index, date.length);
      if (columns?.date) return box.x2 >= columns.date.x - 12 && box.x <= columns.date.x2 + 24;
      return date.index <= 2;
    });
    const date = dates[0];
    const amounts = findAmounts(text).filter((a) => !date || a.index >= date.index + date.length || a.index + a.length <= date.index);
    if (date) currentDate = withYear(date.m, date.d, period);

    const placed = amounts.map((a) => ({ ...a, column: columns ? nearestColumn(columns, span(a.index, a.length)) : null }));
    let balance = null;
    let money = placed;
    if (columns) {
      const balanceAmount = placed.find((a) => a.column === "balance");
      balance = balanceAmount ? (balanceAmount.credit ? -balanceAmount.value : balanceAmount.value) : null;
      money = placed.filter((a) => a.column === "out" || a.column === "in" || a.column === "amount");
    } else if (placed.length >= 2) {
      const last = placed[placed.length - 1];
      balance = last.credit ? -last.value : last.value;
      money = placed.slice(0, -1);
    }
    const description = cleanPayee(removeSpans(text, [...dates, ...amounts]));

    if (!money.length) {
      if (balance !== null) {
        lastBalance = balance;
        lastRows = [];
      } else if (description && !SUMMARY.test(description) && columns) {
        // A second line of description under the last row (Scotiabank and
        // RBC print the kind of transaction, then the shop on the next line).
        const startX = span(text.search(/\S/), 1).x;
        if (!date && lastRows.length && extraLines < 2 && gap <= 24 && descX !== null &&
            Math.abs(startX - descX) <= 12 && !PAGE_FURNITURE.test(description)) {
          for (const row of lastRows) row.extra.push(description);
          extraLines += 1;
        } else {
          lastRows = [];
        }
        pendingPayee = description;
      }
      continue;
    }
    if (SUMMARY.test(description) || !currentDate) {
      if (balance !== null) lastBalance = balance;
      lastRows = [];
      continue;
    }
    // Where this row's description starts, to know its next lines by.
    let masked = text;
    for (const s of [...dates, ...amounts]) masked = masked.slice(0, s.index) + " ".repeat(s.length) + masked.slice(s.index + s.length);
    const descStart = masked.search(/[A-Za-z]/);
    // A line of description with no money, then this line with money and no
    // description of its own: that line was this row's, not the last one's.
    if (!description && pendingPayee && lastRows.length) {
      for (const row of lastRows) if (row.extra[row.extra.length - 1] === pendingPayee) row.extra.pop();
    }
    const made = [];

    for (const item of money) {
      let signed;
      if (item.column === "out") signed = -item.value;
      else if (item.column === "in") signed = item.value;
      else {
        // One signed column, or no headings at all: the running balance
        // settles it when it moved by exactly this amount; otherwise the
        // printed sign (a minus, brackets or "DR" is money out).
        const printed = item.minus || item.debit ? -item.value : item.value;
        const delta = balance !== null && lastBalance !== null ? Math.round((balance - lastBalance) * 100) / 100 : null;
        if (delta !== null && Math.abs(Math.abs(delta) - item.value) < 0.005) signed = delta;
        else {
          signed = printed;
          if (item.column !== "amount") guessedSigns += 1;
        }
      }
      const payee = description || pendingPayee;
      const row = { date: currentDate, payee, memo: "", amount: Math.round(signed * 100) / 100, extra: [] };
      rows.push(row);
      made.push(row);
      if (lastBalance !== null) lastBalance = Math.round((lastBalance + signed) * 100) / 100;
    }
    pendingPayee = "";
    lastRows = made;
    extraLines = 0;
    descX = descStart >= 0 ? span(descStart, 1).x : null;
    if (balance !== null) {
      if (lastBalance !== null) {
        balanceChecked += 1;
        if (Math.abs(lastBalance - balance) > 0.005) balanceOff += 1;
      }
      lastBalance = balance;
    }
  }
  for (const row of rows) {
    const extra = row.extra.join(" ");
    delete row.extra;
    if (!extra) continue;
    // "Point of sale purchase" then "LOBLAWS 1234": the shop is the payee and
    // the kind of transaction goes in the memo.
    if (!row.payee || TYPE_ONLY.test(row.payee)) {
      row.memo = row.payee;
      row.payee = extra;
    } else {
      row.payee = `${row.payee} ${extra}`;
    }
  }
  return { rows, balanceChecked, balanceOff, guessedSigns };
}

/**
 * Transactions from a statement's pages (extractPdfText().pages). `kind` is
 * "card", "bank" or "auto" (a Withdrawals/Deposits heading means bank).
 */
export function readStatement(pages, { dateOrder = "mdy", today = new Date(), kind = "auto" } = {}) {
  const lines = [];
  pages.forEach((page) => page.lines.forEach((line, i) => lines.push({ ...line, pageStart: i === 0 })));
  const options = { dateOrder };
  const period = statementPeriod(lines, { dateOrder, today });
  // A card statement's summary ("Payments & credits ... Purchases & debits")
  // can look like a bank table's heading, so a card statement only counts as
  // a bank one if its running balances actually add up.
  let isBank = kind === "bank";
  let result = null;
  if (kind === "auto" && lines.some((line, i) => headerColumns(line, headingAbove(lines, i)))) {
    const bank = readBank(lines, period, options);
    const cardWords = lines.some((line) => CARD_WORDS.test(line.text));
    const balancesWork = bank.balanceChecked >= 2 && bank.balanceOff === 0;
    if (bank.rows.length && (!cardWords || balancesWork)) {
      isBank = true;
      result = bank;
    }
  }
  if (!result) result = isBank ? readBank(lines, period, options) : readCard(lines, period, options);

  const warnings = [];
  if (period.guessed) warnings.push("No statement period with a year was found, so years were guessed from today's date.");
  if (result.balanceOff) {
    warnings.push(`${result.balanceOff} of ${result.balanceChecked} running balance${result.balanceChecked === 1 ? "" : "s"} did not add up. Check those rows against the statement.`);
  }
  if (result.guessedSigns) {
    warnings.push(`The money in or out was guessed for ${result.guessedSigns} row${result.guessedSigns === 1 ? "" : "s"}. Check their signs.`);
  }
  return { kind: isBank ? "bank" : "card", period, ...result, warnings };
}

export const _test = { charPositions, headerColumns, cleanPayee, monthNumber };
