// Bill Splitting: export shared expenses into a tracker spreadsheet.

import { fmt } from "../money.js";
import { parseDelimited } from "../tools/bank_convert.js";
import * as sheet from "../tools/split_sheet.js";
import {
  button, card, checkbox, clear, customDialog, download, el, emptyRow, field,
  hint, icon, logPane, monthOptions, pageHeading, pickFile, radioGroup,
  sectionTitle, select, table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing converted yet. This tool only reads: it produces a file for your " +
  "tracker and never changes anything in YNAB.";

const PREVIEW_ROWS = 60;

export function splitSheetPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("splitSheet");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let rows = null;
  let sourceName = "";
  // The preview is capped so a year of transactions does not build tens of
  // thousands of table rows before you have decided the settings are right.
  let showAll = false;

  root.append(pageHeading(
    "Bill Splitting",
    "Works out whose expense each transaction was and what each person's " +
    "share of it is, then writes one row per expense for your shared " +
    "expense tracker."));

  // ---------- tool setup ----------
  //
  // Everything that is configured once and then left alone lives behind one
  // disclosure, so the page you see day to day is the source, the summary
  // and the result. A native <details> keeps it keyboard and screen reader
  // friendly for free.

  const setupBody = el("div", { class: "tool-setup-body" });
  const setupBlock = el("details", { class: "tool-setup" },
    el("summary", {},
      el("span", { class: "caret", "aria-hidden": "true", text: "▾" }),
      el("span", { class: "tool-setup-title", text: "Tool setup" }),
      el("span", { class: "hint", text:
        "People, owner codes, ratios and filters" })),
    setupBody);
  setupBlock.open = Boolean(settings.setupOpen);
  setupBlock.addEventListener("toggle", () => {
    settings.setupOpen = setupBlock.open;
    store.save();
  });
  root.append(setupBlock);

  // ---------- people ----------

  // Who the two people are is defined once, in Setup, because Shared
  // Expenses means the same two. Shown here read-only so the rules driving
  // the conversion are visible where the conversion happens.
  function personSummary(which) {
    const person = state.person(which);
    const show = (value, fallback) => {
      const input = textInput(value || "", { placeholder: fallback });
      input.disabled = true;
      return input;
    };
    return el("div", { class: "stack" },
      field(`Person ${which}`, show(person.name, `Person ${which}`)),
      field("Category group starts with",
        show(person.groupPrefix, person.name || `Person ${which}`)),
      field("Account tag", show(person.accountTag, "not used")));
  }

  const peopleCard = card(
    sectionTitle("The two people"),
    hint("Set in Setup. A category group starting with the prefix marks the " +
      "expense as " +
      "that person's. Everything else is shared. The account tag is the " +
      "letter in brackets at the front of an account name, and is only " +
      "consulted when a transaction has no category group at all."),
    el("div", { class: "card-grid" }, personSummary(1), personSummary(2)),
    checkbox("Strip the account tag from the Card column",
      settings.stripAccountTag,
      (checked) => { settings.stripAccountTag = checked; store.save(); }));

  if (!state.peopleNamed) {
    peopleCard.append(el("p", { class: "hint is-warn", text:
      "Both people need a name before this tool can tell whose expense is " +
      "whose. Set them up first." }));
  }
  setupBody.append(peopleCard);

  // ---------- codes and ratios ----------

  const codeP1 = textInput(settings.codes?.person1 ?? "P1", { onInput: save });
  const codeP2 = textInput(settings.codes?.person2 ?? "P2", { onInput: save });
  const codeCustom = textInput(settings.codes?.custom ?? "C", { onInput: save });
  const sharedCode = textInput(settings.defaultSharedCode ?? "S", { onInput: save });
  const tolerance = textInput(String((settings.tolerance ?? 0.02) * 100), {
    type: "number", onInput: save,
  });

  const presetTable = table([
    { key: "code", label: "Code" },
    { key: "label", label: "Name" },
    { key: "share", label: "Person 1 gets", className: "num" },
    { key: "actions", label: "" },
  ]);

  setupBody.append(card(
    sectionTitle("Owner codes"),
    hint("The letters written into the Owner column. Person 1 and Person 2 " +
      "mean one person carried the whole cost; custom means the split " +
      "matched none of your ratios, so the exact amounts are written " +
      "through instead."),
    el("div", { class: "card-grid" },
      field("Person 1 only", codeP1),
      field("Person 2 only", codeP2),
      field("Shared, no split rows", sharedCode),
      field("Custom", codeCustom),
      field("Match tolerance (%)", tolerance))));

  setupBody.append(
    el("div", { class: "section-head" },
      sectionTitle("Ratio presets"),
      el("span", { class: "spacer" }),
      button("Add ratio", { small: true, onClick: () => editPreset(null) })),
    hint("A split within tolerance of one of these is written with that " +
      "code and snapped to the exact ratio. The 'Shared, no split rows' " +
      "code above should be one of these."),
    presetTable);

  // ---------- filters ----------

  const skipList = textInput((settings.skipPayeeSubstrings || []).join(", "), {
    placeholder: "for example: interest, monthly fee", onInput: save,
  });
  const splitPattern = textInput(settings.splitMemoPattern, {
    placeholder: sheet.DEFAULT_SPLIT_MEMO_PATTERN, onInput: save,
  });
  splitPattern.classList.add("mono");
  const dateOrder = select([
    { value: "dayFirst", label: "3rd May (day first)" },
    { value: "monthFirst", label: "March 5th (month first)" },
  ], settings.dateOrder || "dayFirst",
  (value) => { settings.dateOrder = value; store.save(); });
  const serialBox = checkbox("Write Date Adjusted as an Excel serial number",
    settings.includeExcelSerial !== false,
    (checked) => { settings.includeExcelSerial = checked; store.save(); });

  setupBody.append(card(
    sectionTitle("Filters"),
    el("div", { class: "stack" },
      field("Skip payees containing", skipList),
      hint("Comma separated, case insensitive, matched anywhere in the " +
        "payee. Transfers between your own accounts are always skipped."),
      field("Read 03/05/2026 in a file as", dateOrder),
      hint("Only affects file imports. Transactions pulled from the API " +
        "carry unambiguous dates."),
      field("Split memo pattern (file imports only)", splitPattern),
      hint("Leave blank for the default, which matches memos beginning " +
        "'Split (1/2)'. Transactions pulled from the API use their real " +
        "YNAB split parts instead, so this does not apply to them."),
      serialBox)));

  // ---------- source ----------

  // Month pickers, not raw dates: since a cycle is already set up under
  // "Cycle and accounts", picking "March" should mean that whole cycle,
  // not the 1st to the 31st.
  const thisMonthStr = new Date().toISOString().slice(0, 7);
  const monthOpts = monthOptions(state.firstBudgetMonth);
  if (!settings.sinceMonth) settings.sinceMonth = thisMonthStr;
  if (!settings.toMonth) settings.toMonth = thisMonthStr;

  // From and To name the start-month and end-month of ONE cycle (most
  // cycles span two calendar months), not two separate cycles to add
  // together - so each just applies the relevant day-of-month directly to
  // its own month, rather than walking out to "the next cycle after this
  // one". Feb -> Mar with a 6th-to-5th cycle is one cycle, Feb 6 to Mar 5,
  // not Feb's cycle plus March's.
  function cycleIso(monthStr, which) {
    const [y, m] = monthStr.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const startDay = settings.cycleStartDay || 1;
    const day = which === "start" ? startDay
      : settings.cycleEndDay || (startDay > 1 ? startDay - 1 : lastDay);
    return new Date(y, m - 1, Math.min(day, lastDay)).toISOString().slice(0, 10);
  }

  const sinceInput = { get value() { return cycleIso(settings.sinceMonth, "start"); } };
  const untilInput = { get value() { return cycleIso(settings.toMonth, "end"); } };

  const fromMonthInput = select(monthOpts, settings.sinceMonth, (value) => {
    settings.sinceMonth = value;
    store.save();
  });
  const toMonthInput = select(monthOpts, settings.toMonth, (value) => {
    settings.toMonth = value;
    store.save();
  });
  const fileNote = hint("No file chosen yet.");

  const sourceMode = radioGroup("split-source", [
    { value: "api", label: "Pull from YNAB" },
    { value: "file", label: "Read a YNAB export file" },
  ], settings.source === "file" ? "file" : "api", (value) => {
    settings.source = value;
    store.save();
    paintSource();
  });

  const apiRow = el("div", { class: "card-grid" },
    field("From month", fromMonthInput), field("To month", toMonthInput));

  const dropzone = el("div", { class: "dropzone" },
    el("div", { class: "card-row" },
      button("Choose file...", { onClick: chooseFile }),
      el("span", { class: "hint", text: "or drop one here" })),
    fileNote);

  wireDrop(dropzone, (file) => readFile(file));

  root.append(card(
    sectionTitle("Where to read from"), sourceMode, apiRow, dropzone));

  function paintSource() {
    const mode = sourceMode.querySelector("input:checked").value;
    apiRow.hidden = mode !== "api";
    dropzone.hidden = mode !== "file";
  }

  // ---------- actions ----------

  const convertButton = button("Convert", { accent: true, onClick: convert });
  const saveButton = button("Save CSV...", { onClick: saveCsv });
  const copyButton = button("Copy to clipboard", { onClick: copyRows });
  const summary = hint("");

  root.append(el("div", { class: "card-row" },
    convertButton, saveButton, copyButton, summary));

  // ---------- monthly summary ----------

  const summaryHost = el("div");
  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Monthly summary"),
      el("span", { class: "spacer" }),
      button("Cycle and accounts", { small: true, onClick: editCycle })),
    hint("One row per statement cycle: what each person's share came to, " +
      "what went on each card, and the single transfer that settles up."),
    summaryHost);

  const summaryTable = table([
    { key: "cycle", label: "Cycle" },
    { key: "p1", label: "Person 1", className: "num" },
    { key: "p2", label: "Person 2", className: "num" },
    { key: "total", label: "Total", className: "num" },
    { key: "settle", label: "Settle up" },
  ]);
  summaryHost.append(summaryTable);

  async function editCycle() {
    const accounts = (state.accounts || [])
      .filter((account) => !account.deleted && !account.closed);

    const result = await customDialog("Cycle and accounts", (body) => {
      const day = textInput(String(settings.cycleStartDay || 1), { type: "number" });
      day.min = "1";
      day.max = "28";
      const endDay = textInput(
        settings.cycleEndDay ? String(settings.cycleEndDay) : "", {
          type: "number", placeholder: "day before the next cycle",
        });
      endDay.min = "1";
      endDay.max = "31";

      const note = hint("");
      const paint = () => {
        const start = Number(day.value) || 1;
        const end = Number(endDay.value) || 0;
        if (!end) {
          note.textContent = start === 1
            ? "Calendar months."
            : `Each cycle runs from the ${start}${ordinal(start)} to the ` +
              `${start - 1}${ordinal(start - 1)} of the next month.`;
          return;
        }
        note.textContent = end >= start
          ? `Each cycle runs from the ${start}${ordinal(start)} to the ` +
            `${end}${ordinal(end)} of the same month.`
          : `Each cycle runs from the ${start}${ordinal(start)} to the ` +
            `${end}${ordinal(end)} of the next month.`;
      };
      day.addEventListener("input", paint);
      endDay.addEventListener("input", paint);
      paint();

      body.append(
        el("div", { class: "card-grid" },
          field("Cycle opens on day", day),
          field("Cycle closes on day", endDay)),
        note,
        hint("Leaving the closing day blank runs each cycle right up to the " +
          "day before the next one opens. Setting it earlier leaves a gap, " +
          "and anything falling in that gap is reported rather than counted."));

      const picks = [];
      if (accounts.length) {
        body.append(el("p", {
          class: "field-label", style: "margin-top:14px",
          text: "Whose account is each one?",
        }));
        body.append(hint("Only needed where the account name does not " +
          "already say. Joint accounts are left out of the settle up; " +
          "excluded ones are left out of the conversion altogether."));
        const wrap = el("div", { style: "max-height:280px;overflow-y:auto" });
        const owners = settings.accountOwners || {};
        for (const account of accounts) {
          const choice = select([
            { value: "", label: "Work it out from the name" },
            { value: "p1", label: state.personName(1) },
            { value: "p2", label: state.personName(2) },
            { value: "joint", label: "Joint" },
            { value: "exclude", label: "Exclude entirely" },
          ], owners[account.name] || "", () => {});
          picks.push({ name: account.name, choice });
          wrap.append(el("div", { class: "card-row", style: "padding:4px 0" },
            el("span", { class: "grow", text: account.name }),
            el("div", { style: "min-width:210px" }, choice)));
        }
        body.append(wrap);
      } else {
        body.append(hint("Connect and load a budget to map accounts to people."));
      }

      // File imports can name accounts the API list never mentions.
      const extra = textInput((settings.excludedAccounts || []).join(", "), {
        placeholder: "exact account names, comma separated",
      });
      body.append(
        el("p", { class: "field-label", style: "margin-top:14px",
          text: "Also exclude these accounts" }),
        extra,
        hint("For accounts that only appear in a file. Names must match in " +
          "full, so excluding 'Visa' will not also drop 'Visa Rewards'."));

      return {
        value: () => {
          const owners = {};
          for (const pick of picks) {
            if (pick.choice.value) owners[pick.name] = pick.choice.value;
          }
          return {
            day: Math.min(28, Math.max(1, Number(day.value) || 1)),
            endDay: Math.min(31, Math.max(0, Number(endDay.value) || 0)),
            owners,
            excluded: extra.value.split(",")
              .map((part) => part.trim()).filter(Boolean),
          };
        },
      };
    }, { confirmText: "Apply" });

    if (!result) return;
    settings.cycleStartDay = result.day;
    settings.cycleEndDay = result.endDay;
    settings.excludedAccounts = result.excluded;
    if ((state.accounts || []).length) settings.accountOwners = result.owners;
    store.save();
    showSummary();
  }

  function ordinal(day) {
    if (day >= 11 && day <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
  }

  /**
   * The settle up, shown as arithmetic rather than a conclusion.
   *
   * Every figure here is traceable back to rows in the preview, so a
   * surprising number can be checked instead of taken on faith.
   */
  function explainSettle(cycle) {
    const money = (value) => fmt(value * 1000);
    const name = (which) => state.personName(which);

    const step = (number, title, ...lines) => el("div", { class: "step" },
      el("span", { class: "step-number", text: String(number) }),
      el("div", { class: "step-body" },
        el("p", { class: "step-title", text: title }),
        ...lines.filter(Boolean).map(
          (line) => el("p", { class: "hint", text: line }))));

    const side = (which) => {
      const paid = cycle.paidBy[which === 1 ? "p1" : "p2"];
      const other = which === 1 ? 2 : 1;
      if (!paid.count) {
        return step(which, `${name(which)} paid for nothing this cycle.`,
          `So ${name(other)} owes them nothing.`);
      }
      // A refund (or an inflow left counted as a normal row) can outweigh
      // what was actually spent on a card, so the net can land at or below
      // zero. "Paid -$X" would not make sense, so this is worded as what
      // actually happened instead of assuming the total is always a cost.
      const verb = paid.total > 0 ? `paid ${money(paid.total)}`
        : paid.total < 0 ? `came out ${money(-paid.total)} ahead`
          : "came out even";
      return step(which,
        `${name(which)} ${verb} across ${paid.count} transaction(s).`,
        paid.cards.map((card) => `${card.name}: ${money(card.amount)}`).join("     "),
        `${name(other)}'s share of those comes to ${money(paid.owedByOther)}.`);
    };

    customDialog(`Settle up: ${cycle.label}`, (body) => {
      body.append(side(1), side(2));

      const owed1 = cycle.paidBy.p1.owedByOther;
      const owed2 = cycle.paidBy.p2.owedByOther;
      body.append(step(3, "The two cancel out.",
        `${money(owed1)} owed to ${name(1)}, less ${money(owed2)} owed to ` +
        `${name(2)}, is ${money(cycle.net)}.`,
        cycle.settleFrom === 0
          ? "They are even, so no payment is needed."
          : `${name(cycle.settleFrom)} pays ` +
            `${name(cycle.settleFrom === 1 ? 2 : 1)} ` +
            `${money(cycle.settleAmount)}.`));

      const joint = cycle.paidBy.joint;
      if (joint.count) {
        body.append(el("p", { class: "hint is-warn", text:
          `${joint.count} transaction(s) totalling ${money(joint.total)} were ` +
          "on joint or unrecognised accounts. They count as spending but " +
          "not towards who owes whom, because nobody fronted the money for " +
          "the other." }));
      }

      body.append(hint(
        `Totals for the cycle: ${name(1)} ${money(cycle.share1)}, ` +
        `${name(2)} ${money(cycle.share2)}, ${money(cycle.total)} in all.`));

      return { value: () => true };
    }, { confirmText: "Close", cancelText: "" , hideCancel: true });
  }

  function showSummary() {
    clear(summaryHost).append(summaryTable);
    if (!rows || !rows.length) {
      emptyRow(summaryTable, "Convert first to see the monthly breakdown.");
      return;
    }

    const cycles = sheet.monthlySummary(rows, active());
    if (cycles.outside?.length) {
      summaryHost.append(el("p", { class: "hint is-warn", text:
        `${cycles.outside.length} row(s) fall between cycles and are not ` +
        "counted above. Widen the closing day to include them." }));
    }
    clear(summaryTable.tbody);
    summaryTable.columns[1].label = state.personName(1);
    summaryTable.columns[2].label = state.personName(2);
    const heads = summaryTable.querySelectorAll("th");
    heads[1].textContent = state.personName(1);
    heads[2].textContent = state.personName(2);

    for (const cycle of cycles) {
      const settle = cycle.settleFrom === 0
        ? "Even"
        : `${state.personName(cycle.settleFrom)} pays ` +
          `${state.personName(cycle.settleFrom === 1 ? 2 : 1)} ` +
          `${fmt(cycle.settleAmount * 1000)}`;

      summaryTable.tbody.append(el("tr", {},
        el("td", { text: cycle.label }),
        el("td", { class: "num", text: fmt(cycle.share1 * 1000) }),
        el("td", { class: "num", text: fmt(cycle.share2 * 1000) }),
        el("td", { class: "num", text: fmt(cycle.total * 1000) }),
        el("td", {},
          el("div", { class: "settle-cell" },
            el("span", { class: cycle.settleFrom === 0 ? "hint" : "", text: settle }),
            el("button", {
              type: "button",
              class: "info-button",
              "aria-label": `How the settle up for ${cycle.label} was worked out`,
              title: "How this was worked out",
              onClick: () => explainSettle(cycle),
            }, icon("info", { size: 15 }))))));

      // The cards behind that cycle, so a surprising total can be traced.
      if (cycle.byCard.length > 1) {
        summaryTable.tbody.append(el("tr", {},
          el("td", { class: "hint indent", colspan: "5",
            text: cycle.byCard
              .map((card) => `${card.name}: ${fmt(card.amount * 1000)}`)
              .join("     ") })));
      }
    }
  }

  const preview = table([
    { key: "Card", label: "Card" },
    { key: "Date", label: "Date" },
    { key: "Description", label: "Description" },
    { key: "Amount", label: "Amount", className: "num" },
    { key: "Owner", label: "Owner" },
    { key: "Share1", label: "Person 1", className: "num" },
    { key: "Share2", label: "Person 2", className: "num" },
    { key: "Memo", label: "Memo" },
  ]);

  // Filters the preview only - rows itself (what Save/Copy write and the
  // monthly summary above adds up) is never touched by it.
  const filterColumn = select([
    { value: "Description", label: "Description" },
    { value: "Card", label: "Card" },
    { value: "Owner", label: "Owner" },
    { value: "Memo", label: "Memo" },
  ], "Description", () => drawPreview());
  const filterValue = textInput("", {
    placeholder: "Filter...", onInput: () => drawPreview(),
  });

  root.append(
    sectionTitle("Preview"),
    el("div", { class: "card-row" },
      field("Filter by", filterColumn), filterValue),
    preview, log);

  // ---------- settings plumbing ----------

  /** This tool's settings with the shared people folded in. */
  function active() {
    return state.withPeople(settings);
  }

  function save() {
    settings.codes = {
      ...settings.codes,
      person1: codeP1.value.trim(),
      person2: codeP2.value.trim(),
      custom: codeCustom.value.trim(),
    };
    settings.defaultSharedCode = sharedCode.value.trim();
    const percent = Number(tolerance.value);
    if (Number.isFinite(percent)) settings.tolerance = Math.max(0, percent) / 100;
    settings.skipPayeeSubstrings = skipList.value
      .split(",").map((part) => part.trim()).filter(Boolean);
    settings.splitMemoPattern = splitPattern.value.trim();
    store.save();
    paintPreviewHeadings();
  }

  function paintPreviewHeadings() {
    const heads = preview.querySelectorAll("th");
    heads[5].textContent = state.personName(1);
    heads[6].textContent = state.personName(2);
  }

  function presets() {
    return settings.ratioPresets || (settings.ratioPresets = []);
  }

  function renderPresets() {
    clear(presetTable.tbody);
    const list = presets();
    if (!list.length) {
      emptyRow(presetTable,
        "No ratios. Every shared expense will be written as custom.");
      return;
    }
    list.forEach((preset, index) => {
      presetTable.tbody.append(el("tr", {},
        el("td", { class: "mono", text: preset.code }),
        el("td", { text: preset.label || "" }),
        el("td", { class: "num",
          text: `${preset.person1Percent}% / ${100 - preset.person1Percent}%` }),
        el("td", {}, el("div", { class: "inline" },
          button("Edit", { small: true, onClick: () => editPreset(index) }),
          button("Remove", { small: true, danger: true, onClick: () => {
            presets().splice(index, 1);
            store.save();
            renderPresets();
          } })))));
    });
  }

  async function editPreset(index) {
    const existing = index === null ? null : presets()[index];
    const result = await customDialog(
      existing ? "Edit ratio" : "Add ratio",
      (body) => {
        const code = textInput(existing?.code || "", { placeholder: "SH" });
        const label = textInput(existing?.label || "", { placeholder: "Half and half" });
        const percent = textInput(
          existing ? String(existing.person1Percent) : "50", { type: "number" });
        const split = hint("");
        const error = el("p", { class: "hint is-error" });

        const paint = () => {
          const value = Number(percent.value);
          split.textContent = Number.isFinite(value)
            ? `${state.personName(1)} ${value}%   /   ` +
              `${state.personName(2)} ${100 - value}%`
            : "";
        };
        percent.addEventListener("input", paint);
        paint();

        body.append(
          field("Code", code), field("Name", label),
          field("Person 1 gets (%)", percent), split, error);

        return {
          validate: () => {
            const value = Number(percent.value);
            if (!code.value.trim()) {
              error.textContent = "A code is required.";
              return false;
            }
            if (!Number.isFinite(value) || value < 0 || value > 100) {
              error.textContent = "The percentage must be between 0 and 100.";
              return false;
            }
            const clash = presets().findIndex(
              (preset) => preset.code === code.value.trim());
            if (clash >= 0 && clash !== index) {
              error.textContent = `The code '${code.value.trim()}' is already used.`;
              return false;
            }
            return true;
          },
          value: () => ({
            code: code.value.trim(),
            label: label.value.trim(),
            person1Percent: Number(percent.value),
          }),
        };
      }, { confirmText: existing ? "Save" : "Add" });

    if (!result) return;
    if (index === null) presets().push(result);
    else presets()[index] = result;
    store.save();
    renderPresets();
  }

  // ---------- file input ----------

  function wireDrop(zone, onFile) {
    const carriesFile = (event) =>
      [...(event.dataTransfer?.types || [])].includes("Files");
    let depth = 0;
    zone.addEventListener("dragenter", (event) => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      depth += 1;
      zone.classList.add("is-dragging");
    });
    zone.addEventListener("dragover", (event) => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    zone.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) zone.classList.remove("is-dragging");
    });
    zone.addEventListener("drop", (event) => {
      if (!carriesFile(event)) return;
      event.preventDefault();
      depth = 0;
      zone.classList.remove("is-dragging");
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    });
  }

  let parsed = null;

  async function chooseFile() {
    const file = await pickFile(".csv,.tsv,.txt,text/csv,text/plain");
    if (file) readFile(file);
  }

  async function readFile(file) {
    log.clearLog();
    log.write(`Reading ${file.name} ...`, "head");
    try {
      parsed = parseDelimited(await file.text());
    } catch (error) {
      parsed = null;
      fileNote.textContent = "That file could not be read.";
      return log.write(`ERROR: ${error.message}`, "error");
    }
    sourceName = file.name;
    fileNote.textContent =
      `${file.name}: ${parsed.rows.length} row(s), ${parsed.headers.length} column(s).`;
    log.write(`Columns found: ${parsed.headers.join(", ")}`);
    log.write("Press Convert when the settings above look right.", "muted");
  }

  // ---------- conversion ----------

  async function convert() {
    save();
    const mode = sourceMode.querySelector("input:checked").value;
    log.clearLog();

    let source;
    if (mode === "file") {
      if (!parsed) return log.write("Choose a YNAB export file first.", "warn");
      try {
        source = sheet.fromExport(parsed, active());
      } catch (error) {
        return log.write(`ERROR: ${error.message}`, "error");
      }
    } else {
      if (!state.token || !state.budgetId) {
        return log.write("Connect and choose a budget on the Setup page first.",
          "error");
      }
      if (!state.hasBudgetData) {
        return log.write("Categories are not loaded. Open Setup and press " +
          "Reload categories.", "error");
      }

      log.write(`Reading transactions from ${sinceInput.value} ...`, "head");
      const fetched = await app.run(async () => {
        return state.transactions(sinceInput.value);
      }, { log, buttons: [convertButton] });
      if (!fetched) return;

      if (fetched.cached) {
        log.write(`Using transactions already loaded ${state.dataAge()}. ` +
          "Refresh in the footer to re-read from YNAB.", "muted");
      }
      const until = untilInput.value;
      const inRange = fetched.list.filter((item) => !until || item.date <= until);
      log.write(`${inRange.length} transaction(s) in range.`);

      const groupOf = buildGroupLookup();
      source = sheet.fromApi(inRange, groupOf, active());
      sourceName = `${state.budgetName || "budget"}-${sinceInput.value}`;
    }

    if (source.skippedTransfers) {
      log.write(`Skipped ${source.skippedTransfers} transfer(s).`, "muted");
    }
    if (source.skippedPayees) {
      log.write(`Skipped ${source.skippedPayees} filtered payee(s).`, "muted");
    }
    if (source.skippedAccounts) {
      log.write(`Skipped ${source.skippedAccounts} transaction(s) from ` +
        "excluded accounts.", "muted");
    }
    if (source.skippedIncome) {
      log.write(`Skipped ${source.skippedIncome} inflow(s) with nothing spent ` +
        "(paycheques, interest, refunds) - not an expense either of you " +
        "shared.", "muted");
    }

    rows = sheet.buildRows(source.items, active());
    // A fresh result starts capped again, whatever the last one was showing.
    showAll = false;
    showRows();
  }

  function buildGroupLookup() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, group.name);
    }
    return (categoryId) => map.get(categoryId) || "";
  }

  /** Draw the table only. Toggling how much is shown must not re-log. */
  function drawPreview() {
    clear(preview.tbody);
    if (!rows || !rows.length) {
      emptyRow(preview, "Nothing to convert in that range.");
      return;
    }

    const column = filterColumn.value;
    const query = filterValue.value.trim().toLowerCase();
    const filtered = query
      ? rows.filter((row) => String(row[column] ?? "").toLowerCase().includes(query))
      : rows;

    if (!filtered.length) {
      emptyRow(preview, `Nothing in ${column} matches "${filterValue.value.trim()}".`);
      return;
    }

    const limit = showAll ? filtered.length : PREVIEW_ROWS;
    for (const row of filtered.slice(0, limit)) {
      preview.tbody.append(el("tr", {},
        el("td", { text: row.Card }),
        el("td", { text: sheet.formatDate(row.Date) }),
        el("td", { text: row.Description }),
        el("td", { class: "num", text: row.Amount.toFixed(2) }),
        el("td", { class: "mono", text: row.Owner }),
        el("td", { class: "num", text: row.Share1.toFixed(2) }),
        el("td", { class: "num", text: row.Share2.toFixed(2) }),
        el("td", { class: "hint", text: row.Memo })));
    }
    if (filtered.length > PREVIEW_ROWS) {
      const hidden = filtered.length - PREVIEW_ROWS;
      preview.tbody.append(el("tr", { class: "empty-row" },
        el("td", { colspan: String(preview.columns.length) },
          el("div", { class: "card-row", style: "justify-content:center" },
            el("span", { text: showAll
              ? `Showing all ${filtered.length} rows.`
              : `Showing the first ${PREVIEW_ROWS}. ${hidden} more are saved ` +
                "but not drawn." }),
            button(showAll ? `Show first ${PREVIEW_ROWS}` : `Show all ${filtered.length}`, {
              small: true,
              onClick: () => {
                showAll = !showAll;
                drawPreview();
              },
            })))));
    }
  }

  function showRows() {
    drawPreview();
    if (!rows || !rows.length) {
      summary.textContent = "";
      saveButton.disabled = true;
      copyButton.disabled = true;
      return;
    }

    const byCode = new Map();
    for (const row of rows) byCode.set(row.Owner, (byCode.get(row.Owner) || 0) + 1);
    const breakdown = [...byCode.entries()]
      .map(([code, count]) => `${code}: ${count}`).join(", ");

    const undated = rows.filter((row) => !row.Date).length;
    if (undated) {
      log.write(`${undated} row(s) had a date that could not be read. Check ` +
        "the date order setting if that looks wrong.", "warn");
    }

    log.write(`${rows.length} row(s) ready. Owner codes used: ${breakdown}.`, "ok");

    // A pile of custom rows usually means a ratio is missing from the
    // presets, or that the presets are written from the other person's
    // side. Showing the percentages that actually occurred turns that from
    // guesswork into something you can read off.
    const customCode = settings.codes?.custom || "C";
    const customRows = rows.filter(
      (row) => row.Owner === customCode && row.Amount > 0);

    if (customRows.length > 1) {
      const tally = new Map();
      for (const row of customRows) {
        const percent = Math.round((row.Share1 / row.Amount) * 100);
        tally.set(percent, (tally.get(percent) || 0) + 1);
      }
      const common = [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([percent, count]) => `${percent}% (${count})`);

      log.write(`${customRows.length} custom row(s). ` +
        `${state.personName(1)}'s share came out at: ${common.join(", ")}.`, "warn");
      log.write("Presets are matched on " + state.personName(1) + "'s share, " +
        "so add a ratio at one of those percentages to give them a code.",
      "muted");
    }
    summary.textContent = `${rows.length} row(s) ready.`;
    saveButton.disabled = false;
    copyButton.disabled = false;
    state.recordRun("splitSheet");
    showSummary();
  }

  function saveCsv() {
    if (!rows?.length) return;
    const base = sourceName.replace(/\.[^.]+$/, "") || "split-sheet";
    download(`${base}-split.csv`, sheet.toCsv(rows, active()), "text/csv");
    log.write(`Saved ${base}-split.csv.`, "ok");
  }

  async function copyRows() {
    if (!rows?.length) return;
    // Tab separated, which is what spreadsheets expect from a paste.
    const text = sheet.toCsv(rows, active())
      .split("\r\n").map((line) => splitCsvLine(line).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log.write(`Copied ${rows.length} row(s). Paste straight into your ` +
        "tracker.", "ok");
    } catch {
      log.write("The clipboard was refused. Use Save CSV instead.", "warn");
    }
  }

  function splitCsvLine(line) {
    const out = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { out.push(field); field = ""; }
      else field += char;
    }
    out.push(field);
    return out;
  }

  // ---------- first paint ----------

  renderPresets();
  paintSource();
  paintPreviewHeadings();
  emptyRow(preview, "Set the two people up, then press Convert.");
  showSummary();
  saveButton.disabled = true;
  copyButton.disabled = true;

  return root;
}
