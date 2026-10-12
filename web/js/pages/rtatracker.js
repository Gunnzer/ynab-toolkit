// RTA Tracker: snapshots Ready to Assign over time and explains, as best it
// can, why it moved between two snapshots.

import { fmt } from "../money.js";
import * as rta from "../tools/rta_tracker.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, dateLabel,
  download, el, emptyRow, hint, logPane, monthLabel, pageHeading, pill,
  sectionTitle, table,
} from "../ui.js";

const LOG_EMPTY =
  "Press \"Snapshot now\" to record today's Ready to Assign figure and see " +
  "what changed since the last one you took.";

export function rtaTrackerPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("rtaTracker");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  root.append(pageHeading(
    "RTA Tracker",
    "Ready to Assign is not scoped to the current month - it is a running " +
    "total carried forward since the budget started, so a backdated " +
    "paycheque can shift it without showing up in this month's own " +
    "activity. This records a snapshot each time you run it and tries to " +
    "explain what moved since the last one."));

  function snapshots() {
    return settings.snapshots || (settings.snapshots = []);
  }

  function lastSnapshot() {
    const list = snapshots();
    return list.length ? list[list.length - 1] : null;
  }

  // ---------- actions ----------

  const snapshotButton = button("Snapshot now", { accent: true, onClick: takeSnapshot });
  const clearLink = button("Clear history", { small: true, onClick: clearHistory });
  clearLink.classList.add("btn-link");

  root.append(card(
    el("div", { class: "card-row" }, snapshotButton, clearLink)));

  // ---------- latest result ----------

  const latestCard = card(hint(
    "Nothing recorded yet. Take a snapshot to get started."));
  root.append(latestCard);

  function renderLatest(snapshot) {
    clear(latestCard);
    if (!snapshot) {
      latestCard.append(hint("Nothing recorded yet. Take a snapshot to get started."));
      return;
    }

    const deltaPill = snapshot.delta === null
      ? pill("First snapshot", "muted")
      : pill(
        `${snapshot.delta >= 0 ? "+" : ""}${fmt(snapshot.delta)}`,
        snapshot.delta === 0 ? "muted" : snapshot.delta > 0 ? "ok" : "warn");

    latestCard.append(
      el("div", { class: "card-row" },
        sectionTitle("Latest snapshot"),
        el("span", { class: "spacer" }),
        deltaPill),
      el("p", {},
        el("b", { text: fmt(snapshot.toBeBudgeted) }),
        ` ready to assign, as of ${new Date(snapshot.timestamp).toLocaleString()}.`),
      hint(snapshot.summary));

    if (snapshot.flagged.length) {
      const flaggedTable = table([
        { key: "date", label: "Date" },
        { key: "payee", label: "Payee" },
        { key: "amount", label: "Amount", className: "num" },
      ]);
      flaggedTable.classList.add("scroll-table");
      for (const item of snapshot.flagged) {
        flaggedTable.tbody.append(el("tr", {},
          el("td", { text: dateLabel(item.date) }),
          el("td", { text: item.payee }),
          el("td", { class: "num", text: fmt(item.amount) })));
      }
      latestCard.append(flaggedTable);
    }
  }

  // ---------- reconstruction ----------
  //
  // Not persisted: it is rebuilt from YNAB's own month figures each time,
  // so there is nothing here that could drift out of date with the budget.

  let rebuilt = null;
  let problemsOnly = false;

  const rebuildButton = button("Rebuild from history", { onClick: rebuild });
  const csvButton = button("Save CSV", { small: true, onClick: saveCsv });
  csvButton.disabled = true;
  const problemsToggle = checkbox("Only months with something to check", false, (value) => {
    problemsOnly = value;
    renderReconstruction();
  });

  const reconStats = el("div", { class: "stat-grid" });
  const reconNote = hint(
    "Rebuilds Ready to Assign month by month from income and assigned " +
    "amounts, checks it against YNAB's own figure, and finds the month it " +
    "went negative.");
  const causesCard = card();
  causesCard.hidden = true;
  const peopleCard = card();
  peopleCard.hidden = true;
  const findingsCard = card();
  findingsCard.hidden = true;
  let reconTable = buildReconTable(false);
  const reconTableSlot = el("div", {}, reconTable);

  root.append(
    sectionTitle("Reconstruction"),
    card(
      el("div", { class: "card-row" }, rebuildButton, csvButton,
        el("span", { class: "spacer" }), problemsToggle),
      reconNote),
    reconStats,
    causesCard,
    peopleCard,
    findingsCard,
    reconTableSlot);
  emptyRow(reconTable, "Press \"Rebuild from history\" to start.");

  function buildReconTable(showLater) {
    const columns = [
      { key: "month", label: "Month" },
      { key: "income", label: "Income", className: "num" },
      { key: "assigned", label: "Assigned", className: "num" },
    ];
    if (showLater) columns.push({ key: "later", label: "Assigned later", className: "num" });
    columns.push(
      { key: "other", label: "Other", className: "num" },
      { key: "ynab", label: "Ready to Assign", className: "num" },
      { key: "change", label: "Change", className: "num" },
      { key: "status", label: "Check" });
    const wrap = table(columns);
    wrap.classList.add("scroll-table");
    return wrap;
  }

  function stat(label, value, { kind = "", note = "" } = {}) {
    return el("div", { class: "stat" },
      el("span", { class: "stat-label", text: label }),
      el("span", { class: `stat-value ${kind ? `is-${kind}` : ""}`, text: value }),
      note ? el("span", { class: "stat-note", text: note }) : null);
  }

  function signed(milli) {
    return `${milli > 0 ? "+" : ""}${fmt(milli)}`;
  }

  function rowHasProblem(row) {
    return row.negative || !row.incomeMatches || Math.abs(row.other) >= 10 ||
      row.uncategorizedCount > 0;
  }

  function renderReconstruction() {
    if (!rebuilt) return;
    const thisMonth = rta.currentMonthString();
    const pastRows = rebuilt.rows.filter((row) => row.month <= thisMonth);
    const now = pastRows[pastRows.length - 1] || null;
    const firstSnapshot = rta.firstNegativeSnapshot(snapshots());

    clear(reconStats).append(
      stat("Ready to Assign now", now ? fmt(now.ynab) : "-",
        { kind: now?.negative ? "error" : "", note: now ? monthLabel(now.month) : "" }),
      stat("First went negative",
        rebuilt.firstNegative ? monthLabel(rebuilt.firstNegative.month) : "Never",
        {
          kind: rebuilt.firstNegative ? "warn" : "ok",
          note: firstSnapshot
            ? `First snapshot showing it negative: ` +
              `${new Date(firstSnapshot.timestamp).toLocaleString()}`
            : "",
        }),
      stat("Lowest point", rebuilt.lowest ? fmt(rebuilt.lowest.ynab) : "-",
        { note: rebuilt.lowest ? monthLabel(rebuilt.lowest.month) : "" }),
      stat("Negative stretches", String(rebuilt.stretches.length), {
        note: rebuilt.stretches.map((s) =>
          s.from === s.to ? monthLabel(s.from) : `${monthLabel(s.from)} to ` +
            (s.ongoing ? "now" : monthLabel(s.to))).join(", "),
      }));

    reconNote.textContent = rebuilt.deductsLater
      ? "Rebuilt as: income so far, minus assigned so far, minus anything " +
        "already assigned in a later month (this budget's figures match " +
        "that model). \"Other\" is whatever is left that YNAB counted but " +
        "this cannot see - usually cash overspending taken from the next " +
        "month's Ready to Assign."
      : "Rebuilt as: income so far, minus assigned so far. \"Other\" is " +
        "whatever is left that YNAB counted but this cannot see - usually " +
        "cash overspending taken from the next month's Ready to Assign.";

    clear(findingsCard);
    findingsCard.hidden = !rebuilt.findings.length;
    if (rebuilt.findings.length) {
      findingsCard.append(sectionTitle(`Audit (${rebuilt.findings.length})`));
      const kinds = {
        negative: ["Went negative", "error"],
        income: ["Income mismatch", "warn"],
        other: ["Other", "caution"],
        uncategorized: ["Uncategorized", "info"],
      };
      const list = el("div", { class: "rta-findings" });
      for (const finding of [...rebuilt.findings].reverse()) {
        const [label, kind] = kinds[finding.kind];
        list.append(el("div", { class: "rta-finding" },
          el("span", { class: "rta-finding-month", text: monthLabel(finding.month) }),
          pill(label, kind),
          el("span", { text: finding.text })));
      }
      findingsCard.append(list);
    }

    const fresh = buildReconTable(rebuilt.deductsLater);
    reconTableSlot.replaceChildren(fresh);
    reconTable = fresh;

    const rows = [...rebuilt.rows].reverse()
      .filter((row) => !problemsOnly || rowHasProblem(row));
    if (!rows.length) {
      emptyRow(reconTable, problemsOnly ? "Nothing to check." : "No months found.");
      return;
    }

    for (const row of rows) {
      const status = row.wentNegative ? pill("Went negative", "error")
        : row.recovered ? pill("Recovered", "ok")
        : row.negative ? pill("Negative", "warn")
        : !row.incomeMatches ? pill("Income mismatch", "warn")
        : row.month > thisMonth ? pill("Future", "muted")
        : pill("OK", "muted");
      const cells = [
        el("td", {}, (() => {
          const link = button(monthLabel(row.month), { small: true, onClick: () => showMonth(row) });
          link.classList.add("btn-link");
          link.title = "See this month line by line";
          return link;
        })()),
        el("td", { class: "num", text: fmt(row.income) }),
        el("td", { class: "num", text: fmt(row.assigned) }),
      ];
      if (rebuilt.deductsLater) {
        cells.push(el("td", { class: "num", text: fmt(row.assignedLater) }));
      }
      cells.push(
        el("td", { class: "num", text: row.other ? signed(row.other) : "-" }),
        el("td", { class: `num ${row.negative ? "is-error" : ""}`, text: fmt(row.ynab) }),
        el("td", { class: "num", text: row.change === null ? "-" : signed(row.change) }),
        el("td", {}, status));
      reconTable.tbody.append(el("tr", {}, ...cells));
    }
  }

  // YNAB's month detail does not reliably carry each category's group
  // name, which explainMonth() needs to leave out the internal Ready to
  // Assign category - filled in here from the already-loaded groups.
  // Also puts them in budget order (group, then category, as on YNAB's
  // own budget screen), which is the order the ledger lists assignments in.
  function withGroupNames(categories) {
    const groupById = new Map((state.categoryGroups || []).map((g) => [g.id, g.name]));
    const order = new Map();
    for (const group of state.categoryGroups || []) {
      for (const category of group.categories || []) order.set(category.id, order.size);
    }
    return (categories || [])
      .map((c) => ({
        ...c,
        category_group_name: c.category_group_name || groupById.get(c.category_group_id) || "",
      }))
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }

  function inMonth(list, month) {
    return list.filter((item) => rta.monthKey(item.date) === month);
  }

  // ---------- who did it ----------
  //
  // YNAB's money movement history says who assigned something only as a
  // user id - the API has no way to look up anyone's name, only "who am
  // I" (GET /user). So the signed-in user shows as "You", anyone else as
  // "Other member", and either can be matched to Person 1/2 once, in the
  // line-by-line dialog, saved in settings.userPeople.

  let myUserId;
  const movementCache = new Map();

  async function currentUserId() {
    if (myUserId === undefined) {
      try {
        myUserId = (await state.requireClient().user()).id;
      } catch {
        myUserId = null;
      }
    }
    return myUserId;
  }

  function whoName(userId) {
    const mapped = (settings.userPeople || {})[userId];
    const name = mapped === "p1" ? state.personName(1) : mapped === "p2" ? state.personName(2) : "";
    if (userId && userId === myUserId) return name ? `${name} (you)` : "You";
    if (!userId) return "Unknown";
    return name || "Other member";
  }

  /** null when the history could not be loaded at all (not the same as empty). */
  async function movementsFor(month) {
    const key = `${state.budgetId}|${month}`;
    if (!movementCache.has(key)) {
      try {
        movementCache.set(key, await state.requireClient().moneyMovements(state.budgetId, month));
      } catch {
        movementCache.set(key, null);
      }
    }
    const raw = movementCache.get(key);
    if (!raw) return { list: [], loaded: false };
    return {
      loaded: true,
      list: rta.readyToAssignMovements(raw, {
        rtaIds: rta.readyToAssignCategoryIds(state.categoryGroups),
        categoryName: (id) => state.categoryName(id, "(deleted category)"),
        whoName,
      }),
    };
  }

  /**
   * Up to two month-detail requests (cached by state.month()), plus one
   * for the month's money movement history and one, once, for who "you" is.
   */
  async function explain(row) {
    const index = rebuilt.rows.indexOf(row);
    const previous = index > 0 ? rebuilt.rows[index - 1] : null;
    const [current, before, history] = await Promise.all([
      state.month(row.month),
      previous ? state.month(previous.month) : null,
      currentUserId().then(() => movementsFor(row.month)),
    ]);
    const categories = withGroupNames(current.data.categories);
    const inflows = inMonth(rebuilt.inflows, row.month);
    const explanation = rta.explainMonth({
      row,
      previous,
      deductsLater: rebuilt.deductsLater,
      categories,
      previousCategories: withGroupNames(before?.data.categories),
      inflows,
      previousInflows: previous ? inMonth(rebuilt.inflows, previous.month) : [],
      uncategorized: inMonth(rebuilt.uncategorized, row.month),
      movements: history.list,
    });
    explanation.ledger = rta.buildLedger({
      row, previous, deductsLater: rebuilt.deductsLater, categories, inflows,
      overspent: explanation.overspent, movements: history.list,
    });
    explanation.historyLoaded = history.loaded;
    return explanation;
  }

  function timeLabel(iso) {
    const when = new Date(iso);
    return Number.isNaN(when.getTime())
      ? "" : when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function crossingText(ledger) {
    const crossing = ledger.lines.find((line) => line.wentNegative);
    if (!crossing) {
      return ledger.lines[0]?.balance < 0
        ? "Already negative going into this month."
        : "Never drops below zero within this month.";
    }
    if (crossing.kind === "movement") {
      return `Went negative on ${dateLabel(crossing.date)} at ${timeLabel(crossing.at)}, ` +
        `when ${crossing.who} assigned ${fmt(-crossing.amount)} to ${crossing.label} - ` +
        `Ready to Assign dropped to ${fmt(crossing.balance)}.`;
    }
    if (crossing.kind === "reconcile" && ledger.timed) {
      return `Went negative on money assigned before YNAB's history covers ` +
        `(${fmt(-crossing.amount)}), so there is no exact moment for it - the ` +
        "timeline below starts from there.";
    }
    return `Ran out at "${crossing.label}" - the running total drops to ` +
      `${fmt(crossing.balance)} on that line.`;
  }

  /** Match each user id seen this month to a person, once; saved for next time. */
  function whosWho(ledger, body) {
    const ids = [...new Set(ledger.lines
      .filter((line) => line.kind === "movement" && line.userId).map((line) => line.userId))];
    if (!ids.length) return null;
    const people = settings.userPeople || (settings.userPeople = {});
    const row = el("div", { class: "card-row" }, el("span", { class: "hint", text: "Who's who:" }));
    ids.forEach((id, index) => {
      const label = id === myUserId ? "You are" : `Other member${ids.length > 2 ? ` ${index}` : ""} is`;
      const choice = el("select", {},
        el("option", { value: "", text: "Not set" }),
        el("option", { value: "p1", text: state.personName(1) }),
        el("option", { value: "p2", text: state.personName(2) }));
      choice.value = people[id] || "";
      choice.addEventListener("change", () => {
        if (choice.value) people[id] = choice.value;
        else delete people[id];
        store.save();
        for (const span of body.querySelectorAll(".rta-who")) {
          if (span.dataset.user === id) span.textContent = whoName(id);
        }
      });
      row.append(el("label", { class: "rta-whos-who" }, el("span", { text: label }), choice));
    });
    return row;
  }

  function ledgerTable(ledger) {
    const wrap = table([
      { key: "date", label: "Date" },
      { key: "what", label: "What" },
      { key: "amount", label: "Amount", className: "num" },
      { key: "balance", label: "Ready to Assign", className: "num" },
    ]);
    wrap.classList.add("scroll-table");
    let section = null;
    const headings = ledger.timed
      ? {
        income: "In the order it happened (income by date, assignments by exact time)",
        movement: "In the order it happened (income by date, assignments by exact time)",
      }
      : {
        income: "Income, by date",
        assigned: "Assigned, in budget order (no history recorded for this month)",
      };
    for (const line of ledger.lines) {
      if (headings[line.kind] && section !== headings[line.kind]) {
        section = headings[line.kind];
        wrap.tbody.append(el("tr", { class: "group-row rta-ledger-group" },
          el("td", { colspan: "4", text: headings[line.kind] })));
      }
      const who = line.kind === "movement"
        ? el("span", { class: "rta-who", "data-user": line.userId || "", text: line.who })
        : null;
      const detail = [line.detail, line.accountId ? state.accountName(line.accountId) : ""]
        .filter(Boolean).join(" · ");
      const flag = line.wentNegative ? pill("Went negative here", "error")
        : line.recovered ? pill("Back above zero", "ok") : null;
      wrap.tbody.append(el("tr", { class: line.wentNegative ? "rta-cross" : "" },
        el("td", {},
          el("div", { text: line.date ? dateLabel(line.date) : "" }),
          line.at ? el("div", { class: "rta-ledger-detail", text: timeLabel(line.at) }) : null),
        el("td", {},
          el("div", { class: "rta-ledger-what" }, el("span", { text: line.label }), flag),
          who || detail
            ? el("div", { class: "rta-ledger-detail" },
              who ? "by " : "", who, who && detail ? " · " : "", detail)
            : null),
        el("td", { class: "num", text: signed(line.amount) }),
        el("td", { class: `num ${line.balance < 0 ? "is-error" : ""}`, text: fmt(line.balance) })));
    }
    return wrap;
  }

  function causeList(explanation) {
    const labels = {
      income: ["Less income", "warn"],
      assigned: ["Assigned", "error"],
      later: ["Assigned later", "caution"],
      other: ["Overspending", "caution"],
      carried: ["Carried in", "warn"],
      who: ["Who", "info"],
      uncategorized: ["Uncategorized", "info"],
    };
    const list = el("div", { class: "rta-findings" });
    if (!explanation.causes.length) {
      list.append(hint("Nothing specific stood out compared with the month before."));
    }
    for (const cause of explanation.causes) {
      const [label, kind] = labels[cause.kind];
      list.append(el("div", { class: "rta-cause" }, pill(label, kind),
        el("span", { text: cause.text })));
    }
    return list;
  }

  async function renderCauses() {
    clear(causesCard);
    // Most recent first, and only a few: each one costs month-detail
    // requests, and the oldest stretches are rarely the one being chased.
    const targets = rebuilt.rows.filter((row) => row.wentNegative).reverse().slice(0, 3);
    causesCard.hidden = !targets.length;
    if (!targets.length) return;
    causesCard.append(sectionTitle("Why it went negative"));
    for (const row of targets) {
      const slot = el("div", { class: "rta-cause-month" },
        el("div", { class: "rta-finding-month", text: monthLabel(row.month) }),
        hint("Working it out..."));
      causesCard.append(slot);
      try {
        const explanation = await explain(row);
        const lineByLine = button("See it line by line", { small: true, onClick: () => showMonth(row) });
        lineByLine.classList.add("btn-link");
        slot.replaceChildren(
          el("div", { class: "card-row" },
            el("span", { class: "rta-finding-month", text: monthLabel(row.month) }),
            lineByLine),
          hint(explanation.headline),
          explanation.ledger.timed ? hint(crossingText(explanation.ledger)) : null,
          causeList(explanation));
      } catch (error) {
        slot.replaceChildren(
          el("div", { class: "rta-finding-month", text: monthLabel(row.month) }),
          hint(`Could not load the month's details: ${error.shortMessage || error.message}`));
      }
    }
  }

  // ---------- by person ----------

  function personLabel(who) {
    return who === "p1" ? state.personName(1) : who === "p2" ? state.personName(2) : "Shared";
  }

  async function renderPeople() {
    clear(peopleCard);
    peopleCard.hidden = false;
    peopleCard.append(sectionTitle("By person"));
    if (!state.peopleNamed) {
      peopleCard.append(hint(
        "Name both people on the Setup page (with their category group " +
        "prefix and account tag) to compare each person's accounts with " +
        "their categories."));
      return;
    }

    let people;
    try {
      const month = await state.month(rta.currentMonthString());
      people = rta.byPerson({
        accounts: state.accounts,
        categories: withGroupNames(month.data.categories),
        settings: {
          ...state.withPeople({}),
          accountOwners: store.get("splitSheet.accountOwners", {}) || {},
        },
      });
    } catch (error) {
      peopleCard.append(hint(
        `Could not load this month's categories: ${error.shortMessage || error.message}`));
      return;
    }

    peopleCard.append(hint(
      "What is in each person's own accounts (not credit cards - credit is " +
      "shared) against what is sitting in their categories right now. Below " +
      "zero means their categories hold more than their accounts have, so " +
      "some of it is the other person's money."));

    const peopleTable = table([
      { key: "who", label: "Person" },
      { key: "accounts", label: "In their accounts", className: "num" },
      { key: "available", label: "In their categories", className: "num" },
      { key: "gap", label: "Difference", className: "num" },
    ]);
    for (const person of people) {
      const link = button(personLabel(person.who), { small: true, onClick: () => showPerson(person) });
      link.classList.add("btn-link");
      peopleTable.tbody.append(el("tr", {},
        el("td", {}, link),
        el("td", { class: "num", text: fmt(person.accounts) }),
        el("td", { class: "num", text: fmt(person.available) }),
        el("td", { class: "num" },
          pill(signed(person.gap), person.gap < -9 ? "error" : person.gap > 9 ? "ok" : "muted"))));
    }
    peopleCard.append(peopleTable);

    for (const person of people) {
      if (person.gap >= -9) continue;
      peopleCard.append(el("p", { class: "status-line is-error" },
        `${personLabel(person.who)} has ${fmt(person.accounts)} but ` +
        `${fmt(person.available)} sitting in their categories - ` +
        `${fmt(-person.gap)} of it is the other person's money.`));
    }
  }

  function showPerson(person) {
    customDialog(personLabel(person.who), (body) => {
      body.append(hint(
        `${fmt(person.accounts)} in their accounts, ${fmt(person.available)} in ` +
        `their categories, difference ${signed(person.gap)}. Anything that ` +
        "should be here but is not needs its tag, name or group prefix " +
        "set on Setup."));

      body.append(sectionTitle(`Accounts (${person.accountList.length})`));
      const accountTable = table([
        { key: "name", label: "Account" },
        { key: "balance", label: "Balance", className: "num" },
      ]);
      if (!person.accountList.length) emptyRow(accountTable, "No accounts matched.");
      for (const account of person.accountList) {
        accountTable.tbody.append(el("tr", {},
          el("td", { text: account.name }),
          el("td", { class: "num", text: fmt(account.balance) })));
      }
      body.append(accountTable);

      body.append(sectionTitle(`Categories with money in them (${person.categoryList.length})`));
      const categoryTable = table([
        { key: "name", label: "Category" },
        { key: "available", label: "Available", className: "num" },
      ]);
      categoryTable.classList.add("scroll-table");
      if (!person.categoryList.length) emptyRow(categoryTable, "No categories matched.");
      for (const category of person.categoryList) {
        categoryTable.tbody.append(el("tr", {},
          el("td", {}, el("div", { text: category.name }),
            el("div", { class: "rta-ledger-detail", text: category.group })),
          el("td", {
            class: `num ${category.available < 0 ? "is-error" : ""}`,
            text: fmt(category.available),
          })));
      }
      body.append(categoryTable);
      return { value: () => true };
    }, { confirmText: "Done", cancelText: "", hideCancel: true, wide: true });
  }

  async function showMonth(row) {
    const uncategorized = inMonth(rebuilt.uncategorized, row.month);
    const explanation = await app.run(() => explain(row), { log });

    customDialog(monthLabel(row.month), (body) => {
      if (explanation) {
        body.append(sectionTitle("What moved it"), hint(explanation.headline),
          causeList(explanation));
      }
      if (explanation) {
        const ledger = explanation.ledger;
        body.append(
          sectionTitle("Line by line"),
          hint(crossingText(ledger)));
        if (!ledger.timed) {
          body.append(hint(explanation.historyLoaded
            ? "YNAB has no record of when or by whom money was assigned this " +
              "month (it only started keeping that history in 2026), so " +
              "assignments are listed after income, in budget order."
            : "Could not load YNAB's assignment history for this month, so " +
              "assignments are listed after income, in budget order."));
        }
        const people = whosWho(ledger, body);
        if (people) body.append(people);
        body.append(ledgerTable(ledger));
      } else {
        body.append(hint(`Ready to Assign: ${fmt(row.ynab)}. ` +
          "The month's details could not be loaded, so there is no line-by-line view."));
      }

      if (uncategorized.length) {
        body.append(
          sectionTitle(`Uncategorized (${uncategorized.length})`),
          hint("Not counted in Ready to Assign until categorized."));
        const uncatTable = table([
          { key: "date", label: "Date" },
          { key: "payee", label: "Payee" },
          { key: "account", label: "Account" },
          { key: "amount", label: "Amount", className: "num" },
        ]);
        for (const t of uncategorized) {
          uncatTable.tbody.append(el("tr", {},
            el("td", { text: dateLabel(t.date) }),
            el("td", { text: t.payee_name || "(no payee)" }),
            el("td", { text: state.accountName(t.account_id) }),
            el("td", { class: "num", text: fmt(t.amount) })));
        }
        body.append(uncatTable);
      }
      return { value: () => true };
    }, { confirmText: "Done", cancelText: "", hideCancel: true, wide: true });
  }

  async function rebuild() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }

    log.clearLog();
    log.write("Rebuilding Ready to Assign from history...", "head");

    const result = await app.run(async () => {
      const [months, { list }] = await Promise.all([
        state.requireClient().months(state.budgetId),
        state.loadAllTransactions(),
      ]);
      return rta.reconstruct({
        months,
        transactions: list,
        rtaIds: rta.readyToAssignCategoryIds(state.categoryGroups),
      });
    }, { log, buttons: [rebuildButton] });

    if (!result) return;
    rebuilt = result;
    csvButton.disabled = false;
    renderReconstruction();
    renderCauses();
    renderPeople();
    log.write(
      rebuilt.firstNegative
        ? `First went negative in ${monthLabel(rebuilt.firstNegative.month)}.`
        : "Ready to Assign never went negative in any month.",
      rebuilt.firstNegative ? "error" : "ok");
    log.write(`${rebuilt.findings.length} audit finding(s).`, "muted");
  }

  function saveCsv() {
    if (!rebuilt) return;
    download(`ready-to-assign-${rta.currentMonthString()}.csv`,
      rta.reconstructionCsv(rebuilt.rows), "text/csv");
  }

  // ---------- history ----------

  const historyTable = table([
    { key: "when", label: "Taken" },
    { key: "month", label: "Month" },
    { key: "rta", label: "Ready to Assign", className: "num" },
    { key: "delta", label: "Change", className: "num" },
    { key: "flagged", label: "Flagged" },
  ]);
  historyTable.classList.add("scroll-table");

  root.append(sectionTitle("History"), historyTable, log);

  function renderHistory() {
    const list = snapshots();
    clear(historyTable.tbody);
    if (!list.length) {
      emptyRow(historyTable, "No snapshots yet.");
      return;
    }
    for (const snapshot of [...list].reverse()) {
      historyTable.tbody.append(el("tr", {},
        el("td", { text: new Date(snapshot.timestamp).toLocaleString() }),
        el("td", { text: snapshot.month }),
        el("td", { class: "num", text: fmt(snapshot.toBeBudgeted) }),
        el("td", {
          class: "num",
          text: snapshot.delta === null
            ? "-" : `${snapshot.delta >= 0 ? "+" : ""}${fmt(snapshot.delta)}`,
        }),
        el("td", { text: snapshot.flagged.length ? String(snapshot.flagged.length) : "-" })));
    }
  }

  // ---------- run ----------

  async function takeSnapshot() {
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }

    log.clearLog();
    log.write("Taking a snapshot...", "head");

    // Same snapshotRta() a plain budget refresh runs on its own - calling
    // it here too instead of duplicating the fetch means there is only one
    // place that decides what a snapshot actually contains.
    const result = await app.run(() => state.snapshotRta(),
      { log, buttons: [snapshotButton] });

    if (!result) return;

    renderLatest(result);
    renderHistory();
    log.write(result.summary, result.delta ? "ok" : "muted");
    state.recordRun("rtaTracker");
  }

  async function clearHistory() {
    if (!snapshots().length) return;
    const confirmed = await confirmDialog("Clear history",
      `Remove all ${snapshots().length} recorded snapshot(s)? The next ` +
      "snapshot will start fresh, reading every transaction again to " +
      "build its own delta baseline.", { confirmText: "Clear" });
    if (!confirmed) return;

    settings.snapshots = [];
    settings.serverKnowledge = null;
    store.save();
    renderLatest(null);
    renderHistory();
    log.write("History cleared.", "muted");
  }

  // ---------- first paint ----------

  renderLatest(lastSnapshot());
  renderHistory();

  return root;
}
