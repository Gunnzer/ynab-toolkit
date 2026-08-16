// Bill Splitting: export shared expenses into a tracker spreadsheet.

import { fmt } from "../money.js";
import { parseDelimited } from "../tools/bank_convert.js";
import * as sheet from "../tools/split_sheet.js";
import {
  button, card, clear, confirmDialog, customDialog, download, el,
  emptyRow, field, hint, icon, logPane, monthOptions, pageHeading, pickFile,
  radioGroup, sectionTitle, select, table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing converted yet. This tool only reads: it produces a file for your " +
  "tracker and never changes anything in YNAB.";

export function splitSheetPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("splitSheet");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let rows = null;
  let sourceName = "";

  root.append(pageHeading(
    "Bill Splitting",
    "Works out whose expense each transaction was and what each person's " +
    "share of it is, then writes one row per expense for your shared " +
    "expense tracker."));

  // ---------- filters ----------
  //
  // The Owner column itself is not configurable here any more: it is always
  // one of exactly four fixed codes (see the legend below the split line),
  // since who paid is already known from the account tags set on Setup. A
  // manually split transaction counts as the shared split when it is
  // exactly that split rounded to the cent (see classifySplit) - no
  // tolerance percentage to set here. Date parsing, the split memo pattern
  // and the Excel serial option are all configured once and rarely touched,
  // so they live on the Setup page now instead of a disclosure here; only
  // the payee filter, which stays behind a small popup button, is common
  // enough to need to reach quickly.

  const filtersButton = button("Filters", { small: true, onClick: toggleFiltersPopup });
  const filtersAnchor = el("div", { class: "picker" }, filtersButton);
  let filtersPopup = null;
  let skipAddInput = null;
  let skipListEl = null;

  function closeFiltersPopup() {
    if (!filtersPopup) return;
    filtersPopup.remove();
    filtersPopup = null;
    skipAddInput = null;
    skipListEl = null;
    document.removeEventListener("pointerdown", onOutsideFilters, true);
  }
  function onOutsideFilters(event) {
    if (!filtersAnchor.contains(event.target)) closeFiltersPopup();
  }

  function renderSkipList() {
    if (!skipListEl) return;
    clear(skipListEl);
    const entries = settings.skipPayeeSubstrings || [];
    if (!entries.length) {
      skipListEl.append(el("li", { class: "skip-payee-empty", text: "Nothing filtered yet." }));
      return;
    }
    entries.forEach((entry, index) => {
      skipListEl.append(el("li", {},
        el("span", { text: entry }),
        el("button", {
          type: "button", class: "row-exclude-btn",
          "aria-label": `Remove '${entry}' from filters`,
          title: `Remove '${entry}' from filters`,
          onClick: () => removeSkipEntry(index),
        }, icon("x", { size: 13 }))));
    });
  }

  function addSkipEntry() {
    const text = skipAddInput.value.trim();
    if (!text) return;
    const current = settings.skipPayeeSubstrings || [];
    if (current.some((entry) => entry.toLowerCase() === text.toLowerCase())) {
      skipAddInput.value = "";
      return;
    }
    settings.skipPayeeSubstrings = [...current, text];
    store.save();
    skipAddInput.value = "";
    renderSkipList();
    if (rows) convert();
  }

  function removeSkipEntry(index) {
    const current = [...(settings.skipPayeeSubstrings || [])];
    current.splice(index, 1);
    settings.skipPayeeSubstrings = current;
    store.save();
    renderSkipList();
    if (rows) convert();
  }

  function toggleFiltersPopup() {
    if (filtersPopup) return closeFiltersPopup();

    skipAddInput = el("input", {
      type: "text", placeholder: "e.g. interest, monthly fee",
      onKeydown: (event) => { if (event.key === "Enter") { event.preventDefault(); addSkipEntry(); } },
    });
    skipListEl = el("ul", { class: "skip-payee-list" });

    filtersPopup = el("div", { class: "picker-popup filters-popup" },
      el("div", { class: "settle-cell" },
        el("span", { class: "field-label", style: "margin:0", text: "Skip payees containing" }),
        el("span", {
          class: "tooltip",
          "data-tooltip": "Case insensitive, matched anywhere in the payee. " +
            "Transfers between your own accounts are always skipped.",
        },
          el("button", {
            type: "button", class: "info-button",
            "aria-label": "Case insensitive, matched anywhere in the payee. " +
              "Transfers between your own accounts are always skipped.",
          }, icon("info", { size: 14 })))),
      el("div", { class: "card-row" },
        skipAddInput, button("Add", { small: true, onClick: addSkipEntry })),
      skipListEl);
    filtersAnchor.append(filtersPopup);
    if (filtersPopup.getBoundingClientRect().right > window.innerWidth) {
      filtersPopup.style.left = "auto";
      filtersPopup.style.right = "0";
    }
    renderSkipList();
    skipAddInput.focus();
    document.addEventListener("pointerdown", onOutsideFilters, true);
  }

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
    convertButton, saveButton, copyButton, filtersAnchor, summary));

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

    const cycles = sheet.monthlySummary(rows.filter((row) => row.included), active());
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

    // Only worth a total once there is more than one row to add up - a
    // single cycle would just repeat the row above it.
    if (cycles.length > 1) {
      const share1 = cycles.reduce((sum, cycle) => sum + cycle.share1, 0);
      const share2 = cycles.reduce((sum, cycle) => sum + cycle.share2, 0);
      const total = cycles.reduce((sum, cycle) => sum + cycle.total, 0);
      // Net across every cycle, as if nothing had been settled up along the
      // way - the same owedToP1-minus-owedToP2 idea monthlySummary() uses
      // per cycle, just added across all of them.
      const net = cycles.reduce((sum, cycle) => sum + cycle.net, 0);
      const settleFrom = net > 0 ? 2 : net < 0 ? 1 : 0;
      const settleAmount = Math.abs(Math.round(net * 100) / 100);
      const settle = settleFrom === 0 ? "Even"
        : `${state.personName(settleFrom)} pays ` +
          `${state.personName(settleFrom === 1 ? 2 : 1)} ` +
          `${fmt(settleAmount * 1000)}`;

      summaryTable.tbody.append(el("tr", { class: "total-row" },
        el("td", { text: `${cycles.length} cycles` }),
        el("td", { class: "num", text: fmt(share1 * 1000) }),
        el("td", { class: "num", text: fmt(share2 * 1000) }),
        el("td", { class: "num", text: fmt(total * 1000) }),
        el("td", { text: settle })));
    }
  }

  const preview = table([
    { key: "Card", label: "Card" },
    { key: "Date", label: "Date" },
    { key: "Description", label: "Payee" },
    { key: "Amount", label: "Amount", className: "num" },
    { key: "Owner", label: "Owner" },
    { key: "Share1", label: "Person 1", className: "num" },
    { key: "Share2", label: "Person 2", className: "num" },
    { key: "Memo", label: "Memo" },
    { key: "exclude", label: "", className: "check" },
  ]);
  preview.classList.add("scroll-table");

  // Income and refunds are reviewed in a separate dialog (openInflowsDialog,
  // below), not inline in this table - a mixed checkbox-per-row design here
  // was confusing. Every inflow defaults out of Save/Copy/Monthly summary
  // until ticked in the dialog, since most inflows are income and a real
  // refund is rare (see convert()). A ticked inflow also joins this table,
  // as a normal row, since at that point it is being treated as a real
  // expense/credit - see drawPreview()'s filter.
  const inflowsButton = button("Inflows", { small: true, onClick: openInflowsDialog });
  inflowsButton.hidden = true;

  // Filters the preview only - rows itself (what Save/Copy write and the
  // monthly summary above adds up) is never touched by it. Each filterable
  // column gets its own funnel menu in its header, styled after Excel's and
  // LibreOffice's AutoFilter (search box, a checklist of the column's
  // distinct values, OK/Cancel) rather than a single free-text box, and
  // every active filter narrows the rows together, not just one column
  // at a time. `null` in columnFilters means "no filter"; otherwise it's
  // the Set of values that column is currently limited to.
  const columnFilters = { Card: null, Description: null, Owner: null, Memo: null };
  for (const key of Object.keys(columnFilters)) addColumnFilter(key);

  function addColumnFilter(key) {
    const index = preview.columns.findIndex((c) => c.key === key);
    const th = preview.querySelectorAll("th")[index];
    th.classList.add("filterable-th");
    const label = preview.columns[index].label || key;

    const funnelButton = el("button", {
      type: "button", class: "th-filter-btn", "aria-haspopup": "true",
      "aria-label": `Filter ${label}`, title: `Filter ${label}`,
    }, icon("funnel", { size: 13 }));
    // The flex row that holds the label and funnel button is a child of the
    // <th>, not the <th> itself - see the CSS comment on .filterable-th for
    // why (display:flex on a sticky <th> breaks its stickiness here).
    th.textContent = "";
    th.append(el("div", { class: "th-filter-row" },
      el("span", { text: label }), funnelButton));

    let popup = null;

    function close() {
      if (!popup) return;
      popup.remove();
      popup = null;
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", close, true);
    }
    function onOutside(event) {
      if (!th.contains(event.target) && !popup.contains(event.target)) close();
    }

    function open() {
      if (popup) return close();

      // Only the rows shown in this table - an untouched inflow is not
      // part of what this filter narrows, but a ticked-in one is.
      const allValues = [...new Set(
        previewRows().map((row) => String(row[key] ?? "")))]
        .sort((a, b) => a.localeCompare(b));
      // The working selection is a scratch copy - Cancel (or clicking away)
      // must not touch the filter actually applied to the table.
      const working = new Set(columnFilters[key] || allValues);
      let visibleValues = allValues;

      const search = el("input", {
        type: "text", class: "picker-search",
        placeholder: `Search ${label.toLowerCase()}...`, "aria-label": `Search ${label} values`,
      });
      const selectAllBox = el("input", { type: "checkbox" });
      const selectAllRow = el("li", { class: "filter-select-all" },
        el("label", {}, selectAllBox, el("span", { text: "(Select all)" })));
      const list = el("ul", { class: "picker-list filter-value-list", role: "listbox" });
      const okButton = button("OK", { small: true, accent: true, onClick: apply });
      const cancelButton = button("Cancel", { small: true, onClick: close });

      popup = el("div", { class: "picker-popup filter-popup" },
        search, selectAllRow, list,
        el("div", { class: "filter-popup-actions" }, okButton, cancelButton));
      // Appended to <body>, not the <th> - the Preview table is its own
      // bounded, scrolling panel (.scroll-table), and a popup left inside
      // it gets clipped to that panel instead of floating on top of it (you
      // end up scrolling a tiny table to see a filter popup that has
      // nowhere else to go). Positioned as `fixed` from the funnel button's
      // own screen position instead of relying on a positioned ancestor.
      document.body.append(popup);
      const rect = funnelButton.getBoundingClientRect();
      popup.style.position = "fixed";
      popup.style.top = `${rect.bottom + 6}px`;
      popup.style.left = `${rect.left}px`;
      popup.style.minWidth = `${Math.max(rect.width, 220)}px`;

      function syncSelectAll() {
        selectAllBox.checked = visibleValues.length > 0 &&
          visibleValues.every((value) => working.has(value));
      }

      function renderList() {
        const query = search.value.trim().toLowerCase();
        visibleValues = allValues.filter(
          (value) => !query || value.toLowerCase().includes(query));
        clear(list);
        for (const value of visibleValues) {
          const box = el("input", { type: "checkbox" });
          box.checked = working.has(value);
          box.addEventListener("change", () => {
            if (box.checked) working.add(value); else working.delete(value);
            syncSelectAll();
          });
          list.append(el("li", {},
            el("label", {}, box, el("span", { text: value || "(blank)" }))));
        }
        syncSelectAll();
      }

      selectAllBox.addEventListener("change", () => {
        for (const value of visibleValues) {
          if (selectAllBox.checked) working.add(value); else working.delete(value);
        }
        renderList();
      });
      search.addEventListener("input", renderList);
      search.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });

      function apply() {
        columnFilters[key] = working.size === allValues.length ? null : new Set(working);
        funnelButton.classList.toggle("is-active", Boolean(columnFilters[key]));
        drawPreview();
        close();
      }

      renderList();
      // Fixed positioning means "right: 0" would mean the viewport's edge,
      // not the button's - nudge left explicitly instead, clamped so it
      // never runs off the left edge either on a narrow window.
      const overflow = popup.getBoundingClientRect().right - (window.innerWidth - 8);
      if (overflow > 0) {
        popup.style.left = `${Math.max(8, rect.left - overflow)}px`;
      }
      search.focus();
      document.addEventListener("pointerdown", onOutside, true);
      // A popup anchored with `fixed` does not track the page's own scroll,
      // only the button's initial position - closing on scroll avoids it
      // drifting away from the funnel it opened from.
      window.addEventListener("scroll", close, true);
    }

    funnelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      open();
    });
  }

  const legend = el("p", { class: "hint mono" });
  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Preview"), el("span", { class: "spacer" }), inflowsButton),
    legend, preview, log);

  // ---------- settings plumbing ----------

  /** This tool's settings with the shared people folded in. */
  function active() {
    return state.withPeople(settings);
  }

  function save() {
    store.save();
    paintPreviewHeadings();
    paintLegend();
  }

  function paintPreviewHeadings() {
    const heads = preview.querySelectorAll("th");
    heads[preview.columns.findIndex((c) => c.key === "Share1")].textContent = state.personName(1);
    heads[preview.columns.findIndex((c) => c.key === "Share2")].textContent = state.personName(2);
  }

  function paintLegend() {
    const activeSettings = active();
    const codes = settings.codes || {};
    const percent = Math.round(sheet.sharedRatio(activeSettings) * 100);
    legend.textContent =
      `${sheet.personCode(1, activeSettings)} = ${state.personName(1)}   ·   ` +
      `${sheet.personCode(2, activeSettings)} = ${state.personName(2)}   ·   ` +
      `${codes.shared || "S"} = Shared (${percent}% / ${100 - percent}%)   ·   ` +
      `${codes.custom || "C"} = Custom   ·   ` +
      "! = split percentages add up to over 100%";
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

  /**
   * The X on a preview row: adds that payee to "Skip payees containing" and
   * re-runs the conversion, rather than just hiding the row - a filter that
   * only lasted until the next Convert would not actually be a filter. That
   * also means it is not just this one row - every transaction from this
   * payee, past and future, so it is confirmed first rather than sprung on
   * someone who only meant to dismiss the row in front of them.
   */
  async function excludePayee(payee) {
    const text = String(payee || "").trim();
    if (!text) return;
    const current = settings.skipPayeeSubstrings || [];
    if (current.some((entry) => entry.toLowerCase() === text.toLowerCase())) return;

    const confirmed = await confirmDialog("Filter out this payee",
      `This will filter out every transaction from '${text}', not just this ` +
      "one row - now and on every future conversion, until removed from " +
      "Filters below.", { confirmText: "Filter out" });
    if (!confirmed) return;

    settings.skipPayeeSubstrings = [...current, text];
    store.save();
    renderSkipList();
    convert();
  }

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

    rows = sheet.buildRows(source.items, active());
    // An inflow (a paycheque, a refund) is never guessed at - it is kept as
    // a normal negative row, unchecked by default so it takes a deliberate
    // tick to actually count it, rather than silently including income or
    // silently dropping a refund. A normal expense row still defaults on.
    for (const row of rows) row.included = row.Amount >= 0;
    showRows();
  }

  function buildGroupLookup() {
    const map = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) map.set(category.id, group.name);
    }
    return (categoryId) => map.get(categoryId) || "";
  }

  /** The Owner pill's colour depends on whose code it is, worked out once
   * per draw rather than per row. Named apart from active() (shadowed below
   * by the filter list) so callers already inside that scope still work. */
  function ownerCodes() {
    const activeSettings = state.withPeople(settings);
    return {
      p1: sheet.personCode(1, activeSettings),
      p2: sheet.personCode(2, activeSettings),
      shared: settings.codes?.shared || "S",
      custom: settings.codes?.custom || "C",
      ratio: sheet.sharedRatio(activeSettings),
    };
  }

  /** How far a Shared row's actual split can drift from the configured
   * ratio before it's worth a visual nudge - much finer than
   * SPLIT_TOLERANCE (which decides Shared vs Custom in the first place):
   * this only tints an already-Shared row, it never reclassifies one. */
  const VARIANCE_TINT_THRESHOLD = 0.0005;

  function pillClassFor(row, codes) {
    const code = row.Owner;
    if (code === codes.p1) return "pill-blue";
    if (code === codes.p2) return "pill-purple";
    if (code === codes.custom) return "pill-warn";
    if (code === codes.shared && row.Amount) {
      const actualRatio1 = row.Share1 / row.Amount;
      if (Math.abs(actualRatio1 - codes.ratio) > VARIANCE_TINT_THRESHOLD) return "pill-caution";
    }
    return "";
  }

  /** Each person's actual share of a row, as a percentage of its Amount -
   * not the shared-ratio preset, the real number this specific row worked
   * out to (rounding, a Custom split, etc. can all make it differ slightly).
   * A row whose Amount is exactly $0 (both sides fully cancel out) has
   * nothing meaningful to divide by, so it gets an explicit message instead
   * of a misleading 0%/0%. Also reports whether the two percentages, each
   * independently rounded to 2 decimals for display, add up to over 100% -
   * two numbers that each round fine on their own can still overshoot once
   * added together (e.g. 65.02% + 35.02%), which is worth flagging on the
   * pill rather than leaving it looking like a silent inconsistency. */
  function splitPercentInfo(row) {
    if (!row.Amount) {
      return { text: "No split % - amount is $0.", exceeds100: false };
    }
    const percentOf = (value) =>
      Math.round((value / row.Amount) * 10000) / 100;
    const p1 = percentOf(row.Share1);
    const p2 = percentOf(row.Share2);
    return {
      text: `${state.personName(1)}: ${p1.toFixed(2)}%   ·   ` +
        `${state.personName(2)}: ${p2.toFixed(2)}%`,
      // The epsilon absorbs plain float addition error so a genuinely-exact
      // 100% (e.g. 60.00 + 40.00 landing on 100.00000000000001) is not
      // flagged as an overshoot it is not.
      exceeds100: p1 + p2 > 100 + 1e-9,
    };
  }

  /** Rows that belong in the main Preview table: every ordinary expense,
   * plus any inflow ticked in from the Inflows dialog - at that point it is
   * being treated as a real expense/credit, not just tallied quietly. */
  function previewRows() {
    return (rows || []).filter((row) => row.Amount >= 0 || row.included === true);
  }

  /** One <tr>'s worth of cells, shared between the Preview table and the
   * Inflows dialog - they differ only in whether a row carries its own
   * include checkbox (inflows do, ordinary expenses are always included). */
  function rowCells(row, codes, { withCheckbox }) {
    const cells = [];
    if (withCheckbox) {
      const includeBox = el("input", {
        type: "checkbox", "aria-label": `Include '${row.Description}' in the output`,
      });
      includeBox.checked = row.included === true;
      includeBox.addEventListener("change", () => {
        row.included = includeBox.checked;
        // Live, with the dialog still open: ticking (or unticking) moves
        // the row into (or out of) the Preview table and the totals right
        // away, rather than waiting for the dialog to close.
        drawPreview();
        showSummary();
      });
      cells.push(el("td", { class: "check" }, includeBox));
    }
    cells.push(
      el("td", { text: row.Card }),
      el("td", { text: sheet.formatDate(row.Date) }),
      el("td", { text: row.Description }),
      el("td", { class: "num", text: row.Amount.toFixed(2) }),
      el("td", {}, (() => {
        const info = splitPercentInfo(row);
        return el("span", { class: "tooltip", "data-tooltip": info.text },
          el("span", { class: `pill ${pillClassFor(row, codes)}`.trim(), text: row.Owner }),
          info.exceeds100
            ? el("span", { class: "pill-flag", title: "Split percentages add up to over 100%" }, "!")
            : null);
      })()),
      el("td", { class: "num", text: row.Share1.toFixed(2) }),
      el("td", { class: "num", text: row.Share2.toFixed(2) }),
      el("td", { class: "hint", text: row.Memo }),
      el("td", { class: "check" },
        el("button", {
          type: "button", class: "row-exclude-btn",
          "aria-label": `Filter out '${row.Description}'`,
          title: `Filter out '${row.Description}'`,
          onClick: () => excludePayee(row.Description),
        }, icon("x", { size: 13 }))));
    return cells;
  }

  /** Draw the Preview table only. Toggling how much is shown must not
   * re-log. Untouched inflows never appear here - only ordinary expenses
   * and any inflow ticked in via the Inflows dialog (see previewRows()). */
  function drawPreview() {
    clear(preview.tbody);
    const shown = previewRows();
    if (!rows || !rows.length) {
      emptyRow(preview, "Nothing to convert in that range.");
      return;
    }
    if (!shown.length) {
      emptyRow(preview, "Nothing but inflows in that range - see Inflows above.");
      return;
    }

    const codes = ownerCodes();

    const active = Object.entries(columnFilters).filter(([, set]) => set);
    const filtered = active.length
      ? shown.filter((row) => active.every(
          ([key, set]) => set.has(String(row[key] ?? ""))))
      : shown;

    if (!filtered.length) {
      const summary = active.map(([key]) =>
        preview.columns.find((c) => c.key === key)?.label || key).join(", ");
      emptyRow(preview, `Nothing matches the filter on ${summary}.`);
      return;
    }

    for (const row of filtered) {
      preview.tbody.append(el("tr", {}, ...rowCells(row, codes, { withCheckbox: false })));
    }

    // Totals for exactly what's on screen - whatever the column filters
    // above left visible, not the full unfiltered set.
    const totalAmount = filtered.reduce((sum, row) => sum + row.Amount, 0);
    const totalShare1 = filtered.reduce((sum, row) => sum + row.Share1, 0);
    const totalShare2 = filtered.reduce((sum, row) => sum + row.Share2, 0);
    preview.tbody.append(el("tr", { class: "total-row" },
      el("td", { colspan: "3",
        text: `Total (${filtered.length} row${filtered.length === 1 ? "" : "s"})` }),
      el("td", { class: "num", text: totalAmount.toFixed(2) }),
      el("td", {}),
      el("td", { class: "num", text: totalShare1.toFixed(2) }),
      el("td", { class: "num", text: totalShare2.toFixed(2) }),
      el("td", {}),
      el("td", {})));
  }

  /** The Inflows review dialog: income, refunds, anything with a negative
   * Amount. Reviewed on its own, away from ordinary expenses, since most of
   * these are income and only a rare one needs to be ticked in. Ticking a
   * row here updates the Preview table and totals live (see rowCells())
   * without closing the dialog, so several can be reviewed in one pass. */
  function openInflowsDialog() {
    customDialog("Inflows", (body) => {
      body.append(hint(
        "Income, refunds, and other credits. Tick any that should actually " +
        "count - a real refund, say - to add it to Preview and the totals " +
        "above; leave income unticked."));

      const dialogTable = table([
        { key: "included", label: "", className: "check" },
        { key: "Card", label: "Card" },
        { key: "Date", label: "Date" },
        { key: "Description", label: "Payee" },
        { key: "Amount", label: "Amount", className: "num" },
        { key: "Owner", label: "Owner" },
        { key: "Share1", label: state.personName(1), className: "num" },
        { key: "Share2", label: state.personName(2), className: "num" },
        { key: "Memo", label: "Memo" },
        { key: "exclude", label: "", className: "check" },
      ]);
      body.append(dialogTable);

      const inflowRows = (rows || []).filter((row) => row.Amount < 0);
      if (!inflowRows.length) {
        emptyRow(dialogTable, "No refunds, income, or other inflows in this range.");
      } else {
        const codes = ownerCodes();
        for (const row of inflowRows) {
          dialogTable.tbody.append(
            el("tr", {}, ...rowCells(row, codes, { withCheckbox: true })));
        }
      }

      return { value: () => true };
    }, { confirmText: "Done", cancelText: "", hideCancel: true, wide: true });
  }

  function paintInflowsButton() {
    const count = (rows || []).filter((row) => row.Amount < 0).length;
    inflowsButton.textContent = `Inflows (${count})`;
    inflowsButton.hidden = count === 0;
  }

  function showRows() {
    drawPreview();
    paintInflowsButton();
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

    const inflowCount = rows.filter((row) => row.Amount < 0).length;
    if (inflowCount) {
      log.write(`${inflowCount} inflow row(s) found - see the Inflows ` +
        "button above Preview to review them. Excluded from Save, Copy " +
        "and the monthly summary until ticked in.", "muted");
    }

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
    const included = rows.filter((row) => row.included);
    const base = sourceName.replace(/\.[^.]+$/, "") || "split-sheet";
    download(`${base}-split.csv`, sheet.toCsv(included, active()), "text/csv");
    log.write(`Saved ${base}-split.csv (${included.length} of ${rows.length} ` +
      "row(s); unticked rows are left out).", "ok");
  }

  async function copyRows() {
    if (!rows?.length) return;
    const included = rows.filter((row) => row.included);
    // Tab separated, which is what spreadsheets expect from a paste.
    const text = sheet.toCsv(included, active())
      .split("\r\n").map((line) => splitCsvLine(line).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log.write(`Copied ${included.length} of ${rows.length} row(s). Paste ` +
        "straight into your tracker.", "ok");
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

  paintSource();
  paintPreviewHeadings();
  paintLegend();
  emptyRow(preview, "Set the two people up, then press Convert.");
  showSummary();
  saveButton.disabled = true;
  copyButton.disabled = true;

  return root;
}
