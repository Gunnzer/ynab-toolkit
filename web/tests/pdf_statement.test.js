import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { extractPdfText, groupLines, parseCMap } from "../js/tools/pdf_text.js";
import { findAmounts, findDates, readStatement, statementPeriod, withYear } from "../js/tools/pdf_statement.js";

// ---------- a tiny PDF writer, so the reader is tested on real files ----------

function buildPdf(objects) {
  // objects: [{ num, body: string | Buffer }] in order; the first is the catalog.
  const parts = [Buffer.from("%PDF-1.5\n")];
  const offsets = [];
  let size = parts[0].length;
  for (const { num, body } of objects) {
    offsets[num] = size;
    const chunk = Buffer.concat([Buffer.from(`${num} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    size += chunk.length;
  }
  parts.push(Buffer.from(`trailer\n<< /Root ${objects[0].num} 0 R /Size ${objects.length + 1} >>\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

function stream(dict, data, { compress = false } = {}) {
  const raw = Buffer.from(data, "latin1");
  const body = compress ? deflateSync(raw) : raw;
  return Buffer.concat([
    Buffer.from(`<< ${dict}${compress ? " /Filter /FlateDecode" : ""} /Length ${body.length} >>\nstream\n`),
    body,
    Buffer.from("\nendstream"),
  ]);
}

describe("reading text out of a PDF", () => {
  test("a plain PDF with a standard font, Td/Tm/TJ positioning and two pages", async () => {
    const page1 = [
      "BT /F1 10 Tf 50 700 Td (Statement period Oct 15, 2026 to Nov 14, 2026) Tj ET",
      "BT /F1 9 Tf 1 0 0 1 50 650 Tm (OCT 16) Tj 1 0 0 1 200 650 Tm (TIM HORTONS) Tj 1 0 0 1 520 650 Tm (4.50) Tj ET",
      "BT /F1 9 Tf 50 630 Td [(PAY) -50 (MENT)] TJ ET",
    ].join("\n");
    const page2 = "BT /F1 9 Tf 50 700 Td (Second \\(page\\)) Tj ET";
    const pdf = buildPdf([
      { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> >> >>" },
      { num: 3, body: "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>" },
      { num: 4, body: "<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>" },
      { num: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" },
      { num: 6, body: stream("", page1) },
      { num: 7, body: stream("", page2) },
    ]);
    const result = await extractPdfText(pdf);
    assert.equal(result.encrypted, false);
    assert.equal(result.pages.length, 2);
    const lines = result.pages[0].lines.map((l) => l.text);
    assert.deepEqual(lines, ["Statement period Oct 15, 2026 to Nov 14, 2026", "OCT 16 TIM HORTONS 4.50", "PAYMENT"]);
    const row = result.pages[0].lines[1];
    assert.deepEqual(row.items.map((i) => i.text), ["OCT 16", "TIM HORTONS", "4.50"], "far-apart pieces stay separate columns");
    assert.equal(Math.round(row.items[2].x), 520);
    assert.equal(result.pages[1].lines[0].text, "Second (page)");
  });

  test("compressed content, a two-byte font with a ToUnicode map, packed in an object stream", async () => {
    // Codes 0001-0004 map to "Caf\u00e9", 0005 to a space, 0006-0007 to "$5".
    const cmap = [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
      "1 begincodespacerange <0000> <FFFF> endcodespacerange",
      "2 beginbfchar <0005> <0020> <0004> <00E9> endbfchar",
      "2 beginbfrange <0001> <0003> <0043> <0006> <0007> [<0024> <0035>] endbfrange",
      "endcmap end end",
    ].join("\n");
    // Codes 1-3 become C, D, E by the range rule, so map 1-3 to "Caf" explicitly instead.
    const cmapFixed = cmap.replace("<0001> <0003> <0043>", "<0001> <0001> <0043> <0002> <0002> <0061> <0003> <0003> <0066>").replace("2 beginbfrange", "4 beginbfrange");
    const content = "BT /F1 12 Tf 72 720 Td <000100020003000400050006000700050006> Tj ET";
    const fontDict = "<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>";
    const cidFont = "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 500 /W [1 [600 500 300 500] 5 5 250] >>";
    // Object stream holding objects 5 (font) and 6 (descendant).
    const header = `5 0 6 ${fontDict.length + 1} `;
    const objStm = header + fontDict + " " + cidFont;
    const pdf = buildPdf([
      { num: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { num: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { num: 3, body: "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" },
      { num: 4, body: stream("", content, { compress: true }) },
      { num: 7, body: stream("", cmapFixed, { compress: true }) },
      { num: 8, body: stream(`/Type /ObjStm /N 2 /First ${header.length}`, objStm, { compress: true }) },
    ]);
    const result = await extractPdfText(pdf);
    assert.equal(result.pages[0].lines[0].text, "Caf\u00e9 $5 $");
  });

  test("a locked PDF is reported, not misread", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R >>\n");
    assert.deepEqual(await extractPdfText(pdf), { encrypted: true, pages: [] });
    await assert.rejects(extractPdfText(new TextEncoder().encode("hello")), /not a PDF/);
  });

  test("ToUnicode ranges count up, and arrays map one by one", () => {
    const { map, codeBytes } = parseCMap("1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfrange <41> <43> <0061> <30> <31> [<0058> <0059>] endbfrange");
    assert.equal(codeBytes, 1);
    assert.deepEqual([map.get(0x41), map.get(0x43), map.get(0x30), map.get(0x31)], ["a", "c", "X", "Y"]);
  });

  test("pieces of text become lines and columns", () => {
    const lines = groupLines([
      { x: 10, x2: 40, y: 100, size: 10, text: "OCT 3" },
      { x: 300, x2: 330, y: 100.5, size: 10, text: "4.50" },
      { x: 60, x2: 90, y: 99.8, size: 10, text: "SHOP" },
      { x: 92, x2: 120, y: 100, size: 10, text: "NAME" },
      { x: 10, x2: 40, y: 80, size: 10, text: "next" },
    ]);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].items.map((i) => i.text), ["OCT 3", "SHOP NAME", "4.50"]);
  });
});

// ---------- turning lines into transactions ----------

// A line from positioned runs: [x, x2, text] each.
const line = (...runs) => ({
  items: runs.map(([x, x2, text]) => ({ x, x2, text })),
  text: runs.map((r) => r[2]).join(" "),
});
const page = (...lines) => ({ lines });

describe("dates and amounts", () => {
  test("dates in the shapes statements print them", () => {
    const pick = (text, opts) => findDates(text, opts).map(({ m, d, y }) => [m, d, y]);
    assert.deepEqual(pick("OCT 16 OCT 17 SHOP"), [[10, 16, 0], [10, 17, 0]]);
    assert.deepEqual(pick("03 Oct Payroll"), [[10, 3, 0]]);
    assert.deepEqual(pick("DEC15"), [[12, 15, 0]]);
    assert.deepEqual(pick("Oct. 4"), [[10, 4, 0]]);
    assert.deepEqual(pick("November 14, 2026"), [[11, 14, 2026]]);
    assert.deepEqual(pick("2027-01-02"), [[1, 2, 2027]]);
    assert.deepEqual(pick("03/09/2027"), [[3, 9, 2027]]);
    assert.deepEqual(pick("03/09/2027", { dateOrder: "dmy" }), [[9, 3, 2027]]);
    assert.deepEqual(pick("12 d\u00e9c. 2026"), [[12, 12, 2026]]);
  });

  test("money, and what is not money", () => {
    const pick = (text) => findAmounts(text).map((a) => [a.value, a.credit]);
    assert.deepEqual(pick("SHOP 4.50"), [[4.5, false]]);
    assert.deepEqual(pick("PAYMENT -$1,250.00"), [[1250, true]]);
    assert.deepEqual(pick("RETURN 25.99 CR"), [[25.99, true]]);
    assert.deepEqual(pick("PAYMENT 420.00-"), [[420, true]]);
    assert.deepEqual(pick("(12.34)"), [[12.34, true]]);
    assert.deepEqual(pick("INTEREST 19.99% 12.34"), [[12.34, false]], "a rate is not money");
    assert.deepEqual(pick("USD @ 1.4523"), [], "an exchange rate is not money");
    assert.deepEqual(pick("JAN01 589.45"), [[589.45, false]], "a date's digits are not part of the amount");
    assert.deepEqual(pick("SHELL C12345.00"), [], "glued to a word: a code, not money");
  });

  test("years come from the statement period", () => {
    const period = statementPeriod([
      { text: "Statement period Dec 20, 2026 to Jan 19, 2027" },
      { text: "Payment due date Feb 9, 2027" },
    ]);
    assert.deepEqual([period.start, period.end], ["2026-12-20", "2027-01-19"], "the due date is not the period");
    assert.equal(withYear(12, 22, period), "2026-12-22");
    assert.equal(withYear(1, 5, period), "2027-01-05");
  });
});

describe("reading a statement", () => {
  test("a card statement: two dates, payments and refunds are money in, totals and FX notes left out", () => {
    const result = readStatement([page(
      line([50, 300, "Statement period: Oct 15, 2026 to Nov 14, 2026"]),
      line([50, 300, "Credit limit $10,000.00 Minimum payment $25.00"]),
      line([50, 90, "TRANSACTION"], [120, 150, "POSTING"], [190, 270, "ACTIVITY DESCRIPTION"], [510, 550, "AMOUNT ($)"]),
      line([50, 75, "OCT 16"], [120, 145, "OCT 17"], [190, 310, "TIM HORTONS #1234 TORONTO ON"], [540, 560, "4.50"]),
      line([50, 75, "OCT 20"], [120, 145, "OCT 21"], [190, 270, "PAYMENT - THANK YOU"], [530, 560, "-500.00"]),
      line([190, 300, "Foreign currency 85.00 USD @ 1.4523"]),
      line([50, 75, "NOV 10"], [120, 145, "NOV 12"], [190, 300, "RETURN - CANADIAN TIRE #55"], [520, 560, "25.99 CR"]),
      line([190, 260, "Total new charges"], [530, 560, "187.95"]),
    )]);
    assert.equal(result.kind, "card");
    assert.deepEqual(result.rows.map((r) => [r.date, r.payee, r.amount]), [
      ["2026-10-16", "TIM HORTONS #1234 TORONTO ON", -4.5],
      ["2026-10-20", "PAYMENT - THANK YOU", 500],
      ["2026-11-10", "RETURN - CANADIAN TIRE #55", 25.99],
    ]);
    assert.deepEqual(result.warnings, []);
  });

  test("a reference number before the date, and a card summary row that is not a bank table", () => {
    const result = readStatement([page(
      line([50, 300, "Statement Period Oct 3, 2026 - Nov 2, 2026"]),
      line([50, 300, "Credit limit $12,000.00"]),
      line([50, 120, "Previous balance"], [150, 230, "Payments & credits"], [270, 350, "Purchases & debits"], [400, 460, "New balance"]),
      line([90, 120, "420.00"], [210, 240, "420.00"], [330, 360, "312.40"], [450, 480, "312.40"]),
      line([50, 65, "001"], [90, 115, "Oct 4"], [150, 175, "Oct 5"], [210, 320, "SOBEYS #812 TORONTO ON"], [530, 560, "112.40"]),
      line([50, 65, "002"], [90, 115, "Oct 9"], [150, 175, "Oct 9"], [210, 320, "PAYMENT FROM"], [525, 560, "420.00-"]),
    )]);
    assert.equal(result.kind, "card");
    assert.deepEqual(result.rows.map((r) => [r.date, r.payee, r.amount]), [
      ["2026-10-04", "SOBEYS #812 TORONTO ON", -112.4],
      ["2026-10-09", "PAYMENT FROM", 420],
    ]);
  });

  test("a bank statement: columns decide the sign, a date printed once per day carries down, balances check out", () => {
    const header = line([50, 66, "Date"], [100, 144, "Description"], [321, 380, "Withdrawals ($)"], [424, 470, "Deposits ($)"], [517, 560, "Balance ($)"]);
    const result = readStatement([
      page(
        line([50, 220, "From October 1, 2026 to October 31, 2026"]),
        header,
        line([50, 75, "01 Oct"], [100, 166, "Opening Balance"], [525, 560, "1,000.00"]),
        line([50, 75, "03 Oct"], [100, 207, "Payroll Deposit ACME CORP"], [435, 470, "2,000.00"]),
        line([100, 182, "e-Transfer sent Sam"], [352, 380, "150.00"], [525, 560, "2,850.00"]),
      ),
      page(
        header,
        line([50, 75, "05 Oct"], [100, 264, "Online Banking payment HYDRO ONE"], [357, 380, "95.12"], [525, 560, "2,754.88"]),
        line([50, 75, "31 Oct"], [100, 166, "Closing Balance"], [525, 560, "2,754.88"]),
      ),
    ]);
    assert.equal(result.kind, "bank");
    assert.deepEqual(result.rows.map((r) => [r.date, r.payee, r.amount]), [
      ["2026-10-03", "Payroll Deposit ACME CORP", 2000],
      ["2026-10-03", "e-Transfer sent Sam", -150],
      ["2026-10-05", "Online Banking payment HYDRO ONE", -95.12],
    ]);
    assert.equal(result.balanceChecked, 2);
    assert.equal(result.balanceOff, 0);
    assert.deepEqual(result.warnings, []);
  });

  test("a date column after the amounts (TD), across the new year", () => {
    const result = readStatement([page(
      line([30, 180, "Statement period Dec 1, 2026 to Jan 2, 2027"]),
      line([32, 92, "Description"], [290, 357, "Withdrawals"], [393, 430, "Deposits"], [439, 463, "Date"], [539, 580, "Balance"]),
      line([32, 150, "BALANCE FORWARD"], [439, 475, "DEC01"], [547, 580, "500.00"]),
      line([32, 111, "PAYROLL DEP"], [394, 430, "1,800.00"], [439, 475, "DEC15"], [538, 580, "2,300.00"]),
      line([32, 100, "RENT E-TFR"], [315, 357, "1,500.00"], [439, 473, "JAN01"], [547, 580, "800.00"]),
    )]);
    assert.deepEqual(result.rows.map((r) => [r.date, r.payee, r.amount]), [
      ["2026-12-15", "PAYROLL DEP", 1800],
      ["2027-01-01", "RENT E-TFR", -1500],
    ]);
    assert.equal(result.balanceOff, 0);
  });

  test("one signed Amount column beside a Balance (Tangerine)", () => {
    const result = readStatement([page(
      line([50, 300, "Statement Period: March 1, 2027 to March 31, 2027"]),
      line([50, 120, "Transaction Date"], [150, 260, "Transaction Description"], [440, 470, "Amount"], [520, 560, "Balance"]),
      line([50, 95, "03/01/2027"], [150, 220, "Opening Balance"], [515, 560, "$1,000.00"]),
      line([50, 95, "03/05/2027"], [150, 290, "INTERAC e-Transfer From: SAM"], [430, 470, "$200.00"], [515, 560, "$1,200.00"]),
      line([50, 95, "03/09/2027"], [150, 260, "Bill Payment - ROGERS"], [430, 470, "-$85.40"], [515, 560, "$1,114.60"]),
    )]);
    assert.equal(result.kind, "bank");
    assert.deepEqual(result.rows.map((r) => r.amount), [200, -85.4]);
    assert.deepEqual(result.warnings, []);
  });

  test("headings over two lines, and a second line of description (Scotiabank chequing)", () => {
    // Reported live: "Transactions" right before "withdrawn ($)" read as one
    // heading, so no table was found and the balances came out as amounts.
    const at = (y, l) => ({ ...l, y });
    const result = readStatement([page(
      at(746, line([50, 237, "Statement period Aug 18, 2026 to Sep 17, 2026"])),
      at(710, line([351, 383, "Amounts"], [436, 468, "Amounts"])),
      at(705, line([50, 68, "Date"], [110, 164, "Transactions"], [512, 559, "Balance ($)"])),
      at(700, line([332, 388, "withdrawn ($)"], [419, 475, "deposited ($)"])),
      at(680, line([50, 75, "Aug 18"], [110, 176, "Opening Balance"], [525, 561, "4,126.32"])),
      at(664, line([50, 75, "Aug 24"], [110, 205, "Point of sale purchase"], [361, 390, "76.84"], [525, 561, "4,049.48"])),
      at(653, line([110, 220, "LOBLAWS 1234 TORONTO ON"])),
      at(637, line([50, 70, "Sep 2"], [110, 180, "Payroll deposit"], [442, 475, "600.00"], [525, 561, "4,649.48"])),
      at(626, line([110, 160, "ACME CORP"])),
      at(610, line([50, 70, "Sep 9"], [110, 170, "AMAZON.CA*AB12CD"], [357, 390, "10.00"], [525, 561, "4,639.48"])),
      at(599, line([110, 170, "AMZN.CA/BILL ON"])),
      at(583, line([50, 75, "Sep 17"], [110, 176, "Closing Balance"], [520, 561, "$4,639.48"])),
      at(567, line([110, 200, "continued on next page"])),
    )]);
    assert.equal(result.kind, "bank");
    assert.deepEqual(result.rows.map((r) => [r.date, r.payee, r.memo, r.amount]), [
      ["2026-08-24", "LOBLAWS 1234 TORONTO ON", "Point of sale purchase", -76.84],
      ["2026-09-02", "ACME CORP", "Payroll deposit", 600],
      ["2026-09-09", "AMAZON.CA*AB12CD AMZN.CA/BILL ON", "", -10],
    ]);
    assert.equal(result.balanceChecked, 3);
    assert.deepEqual(result.warnings, []);
  });

  test("a balance that does not add up is flagged", () => {
    const result = readStatement([page(
      line([50, 300, "From October 1, 2026 to October 31, 2026"]),
      line([50, 66, "Date"], [100, 144, "Description"], [321, 380, "Withdrawals"], [424, 470, "Deposits"], [517, 560, "Balance"]),
      line([50, 75, "01 Oct"], [100, 166, "Opening Balance"], [525, 560, "100.00"]),
      line([50, 75, "02 Oct"], [100, 166, "Coffee"], [352, 380, "5.00"], [525, 560, "90.00"]),
      line([50, 75, "03 Oct"], [100, 166, "Lunch"], [352, 380, "10.00"], [525, 560, "80.00"]),
    )]);
    assert.equal(result.balanceOff, 1);
    assert.match(result.warnings.join(" "), /did not add up/);
  });
});
