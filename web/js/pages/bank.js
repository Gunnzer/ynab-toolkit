// Bank Import: turn a bank export into a CSV that YNAB can import.
//
// Everything happens in the page. The file is read with FileReader and never
// uploaded anywhere.

import * as bank from "../tools/bank_convert.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, download, el,
  emptyRow, field, hint, logPane, pageActions, pageHeading, pickFile,
  sectionTitle, select, table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Choose a bank export to begin. Nothing is uploaded: the file is read in " +
  "this page and the result is saved straight back to your computer.";

const DATE_FORMATS = [
  { value: "yyyy-MM-dd", label: "2025-03-05 (ISO)" },
  { value: "MM/dd/yyyy", label: "03/05/2025 (US)" },
  { value: "dd/MM/yyyy", label: "05/03/2025 (UK)" },
];

const DATE_ORDERS = [
  { value: "monthFirst", label: "March 5th (month first)" },
  { value: "dayFirst", label: "3rd May (day first)" },
];

// What a saved bank preset carries. Payee rules stay global on purpose -
// most people write those against words in a payee name, not against a
// particular bank's export format.
const PRESET_FIELDS = [
  "dateColumn", "payeeColumn", "amountColumn", "memoColumn",
  "outflowColumn", "inflowColumn", "dateFormat", "dateOrder", "invertAmount",
];

export function bankImportPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("bankImport");

  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  let parsed = null;       // { headers, rows }
  let converted = null;    // result of bank.convert
  let sourceName = "";

  root.append(pageHeading(
    "Bank Import",
    "Reads a CSV, TSV or semicolon export from your bank and writes the " +
    "four columns YNAB wants, tidying up payee names on the way."));

  // ---------- file ----------

  const fileLabel = hint("No file chosen yet.");
  const chooseButton = button("Choose file...", { accent: true, onClick: chooseFile });

  const dropzone = el("div", { class: "dropzone" },
    el("div", { class: "card-row" },
      chooseButton,
      el("span", { class: "hint", text: "or drop one here" })),
    fileLabel);

  // A drag is only ours if it actually carries a file: dragging selected
  // text around the page should not light this up.
  const carriesFile = (event) =>
    [...(event.dataTransfer?.types || [])].includes("Files");

  let depth = 0;   // dragenter/dragleave also fire for child elements
  dropzone.addEventListener("dragenter", (event) => {
    if (!carriesFile(event)) return;
    event.preventDefault();
    depth += 1;
    dropzone.classList.add("is-dragging");
  });
  dropzone.addEventListener("dragover", (event) => {
    if (!carriesFile(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  dropzone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dropzone.classList.remove("is-dragging");
  });
  dropzone.addEventListener("drop", (event) => {
    if (!carriesFile(event)) return;
    event.preventDefault();
    depth = 0;
    dropzone.classList.remove("is-dragging");

    const files = [...(event.dataTransfer.files || [])];
    if (!files.length) return;
    if (files.length > 1) {
      log.write(`${files.length} files were dropped. Using the first, ` +
        `${files[0].name}.`, "warn");
    }
    readFile(files[0]);
  });

  root.append(card(dropzone));

  // ---------- bank presets ----------

  function presets() {
    return settings.presets || (settings.presets = {});
  }

  function presetOptions() {
    return [{ value: "", label: "(custom, not saved)" }]
      .concat(Object.keys(presets()).sort().map((name) => ({ value: name, label: name })));
  }

  const presetSelect = select(presetOptions(), settings.presetName || "",
    (name) => applyPreset(name));
  const presetSaveButton = button("Save as...", { small: true, onClick: savePreset });
  const presetDeleteButton = button("Delete", { small: true, danger: true, onClick: deletePreset });

  root.append(card(
    sectionTitle("Bank"),
    hint("Save this column mapping under a bank's name (EQ, Tangerine, ...) " +
      "so switching banks is one click instead of remapping every column."),
    el("div", { class: "card-row" },
      el("div", { class: "narrow" }, presetSelect), presetSaveButton, presetDeleteButton)));

  function applyPreset(name) {
    settings.presetName = name;
    const preset = presets()[name];
    if (preset) Object.assign(settings, preset);
    store.save();
    renderMapping();
  }

  async function savePreset() {
    const result = await customDialog("Save bank preset", (body) => {
      const nameInput = textInput(settings.presetName || "", {
        placeholder: "e.g. EQ Bank",
      });
      const error = el("p", { class: "hint is-error" });
      body.append(field("Bank name", nameInput), error);
      return {
        validate: () => {
          if (!nameInput.value.trim()) {
            error.textContent = "Give it a name.";
            return false;
          }
          return true;
        },
        value: () => nameInput.value.trim(),
      };
    }, { confirmText: "Save" });

    if (!result) return;
    const snapshot = {};
    for (const key of PRESET_FIELDS) snapshot[key] = settings[key];
    presets()[result] = snapshot;
    settings.presetName = result;
    store.save();
    presetSelect.replaceChildren(...presetOptions().map(
      (option) => el("option", { value: option.value, text: option.label })));
    presetSelect.value = result;
    log.write(`Saved the current mapping as '${result}'.`, "ok");
  }

  async function deletePreset() {
    const name = settings.presetName;
    if (!name || !presets()[name]) return;
    const confirmed = await confirmDialog("Delete bank preset",
      `Delete the saved mapping for '${name}'?`, { confirmText: "Delete" });
    if (!confirmed) return;

    delete presets()[name];
    settings.presetName = "";
    store.save();
    presetSelect.replaceChildren(...presetOptions().map(
      (option) => el("option", { value: option.value, text: option.label })));
    presetSelect.value = "";
    log.write(`Deleted '${name}'.`, "ok");
  }

  // ---------- mapping ----------

  const mapHost = el("div", { class: "card-grid" });
  const optionsHost = el("div", { class: "stack" });
  const mappingCard = card(
    sectionTitle("Columns"),
    hint("Map the columns in your file onto YNAB's four. Use Outflow and " +
      "Inflow instead of Amount if your bank splits them into two columns."),
    mapHost,
    optionsHost);
  root.append(mappingCard);

  const COLUMN_FIELDS = [
    ["dateColumn", "Date", true],
    ["payeeColumn", "Payee", true],
    ["amountColumn", "Amount", false],
    ["memoColumn", "Memo (optional)", false],
    ["outflowColumn", "Outflow (optional)", false],
    ["inflowColumn", "Inflow (optional)", false],
  ];

  function renderMapping() {
    clear(mapHost);
    clear(optionsHost);

    const headers = parsed?.headers || [];
    const options = [{ value: "", label: headers.length ? "(not used)" : "(load a file first)" }]
      .concat(headers.map((header) => ({ value: header, label: header })));

    for (const [key, label] of COLUMN_FIELDS) {
      const current = headers.includes(settings[key]) ? settings[key] : "";
      const node = select(options, current, (value) => {
        settings[key] = value;
        store.save();
      });
      node.disabled = !headers.length;
      mapHost.append(field(label, node));
    }

    const format = select(DATE_FORMATS, settings.dateFormat || "yyyy-MM-dd",
      (value) => { settings.dateFormat = value; store.save(); });

    const order = select(DATE_ORDERS, settings.dateOrder || bank.MONTH_FIRST,
      (value) => { settings.dateOrder = value; store.save(); });

    optionsHost.append(
      el("div", { class: "card-grid" },
        field("Read 03/05/2025 as", order),
        field("Date format to write", format)),
      el("div", { class: "stack", style: "gap:4px" },
        checkbox("Flip the sign of every amount", settings.invertAmount,
          (checked) => { settings.invertAmount = checked; store.save(); }),
        hint("Turn this on only if your bank writes spending as a positive " +
          "number. YNAB expects money leaving an account to be negative.")));
  }

  // ---------- payee rules ----------

  const rulesTable = table([
    { key: "on", label: "On", className: "check" },
    { key: "label", label: "Rule" },
    { key: "pattern", label: "Matches" },
    { key: "replacement", label: "Becomes" },
    { key: "actions", label: "" },
  ]);

  root.append(
    el("div", { class: "section-head" },
      sectionTitle("Payee rules"),
      el("span", { class: "spacer" }),
      button("Add rule", { small: true, onClick: () => editRule(null) }),
      button("Test a name", { small: true, onClick: testRule })),
    rulesTable,
    hint("Rules run top to bottom and the first match wins. Patterns are " +
      "regular expressions; use $<name> in the replacement to bring a named " +
      "group through."));

  function rules() {
    return settings.payeeRules || (settings.payeeRules = []);
  }

  function renderRules() {
    clear(rulesTable.tbody);
    const list = rules();
    if (!list.length) {
      emptyRow(rulesTable, "No rules. Payee names will be used exactly as the bank wrote them.");
      return;
    }

    list.forEach((rule, index) => {
      const box = el("input", { type: "checkbox" });
      box.checked = rule.enabled !== false;
      box.addEventListener("change", () => {
        rule.enabled = box.checked;
        store.save();
      });

      rulesTable.tbody.append(el("tr", {},
        el("td", { class: "check" }, box),
        el("td", { text: rule.label || "(unnamed)" }),
        el("td", { class: "mono", text: rule.pattern || "" }),
        el("td", { text: rule.replacement || "" }),
        el("td", {},
          el("div", { class: "inline" },
            button("Up", { small: true, disabled: index === 0, onClick: () => moveRule(index, -1) }),
            button("Down", {
              small: true, disabled: index === list.length - 1,
              onClick: () => moveRule(index, 1),
            }),
            button("Edit", { small: true, onClick: () => editRule(index) }),
            button("Remove", { small: true, danger: true, onClick: () => removeRule(index) })))));
    });
  }

  function moveRule(index, delta) {
    const list = rules();
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    store.save();
    renderRules();
  }

  async function removeRule(index) {
    const rule = rules()[index];
    const confirmed = await confirmDialog("Remove rule",
      `Remove '${rule.label || rule.pattern}'?`, { confirmText: "Remove" });
    if (!confirmed) return;
    rules().splice(index, 1);
    store.save();
    renderRules();
  }

  async function editRule(index) {
    const existing = index === null ? null : rules()[index];

    const result = await customDialog(
      existing ? "Edit rule" : "Add rule",
      (body) => {
        const label = textInput(existing?.label || "", { placeholder: "What this rule is for" });
        const pattern = textInput(existing?.pattern || "", {
          placeholder: "Regular expression, for example ^amzn mktp",
        });
        const replacement = textInput(existing?.replacement || "", {
          placeholder: "Replacement text, for example Amazon",
        });
        pattern.className = "mono";
        replacement.className = "mono";

        const titleCase = el("input", { type: "checkbox" });
        titleCase.checked = existing ? existing.titleCase !== false : true;
        const cleanName = el("input", { type: "checkbox" });
        cleanName.checked = existing ? existing.cleanName !== false : true;

        const error = el("p", { class: "hint is-error" });

        body.append(
          field("Name", label),
          field("Pattern", pattern),
          field("Replacement", replacement),
          el("label", { class: "checkbox" }, titleCase,
            el("span", { text: "Title Case any captured name" })),
          el("label", { class: "checkbox" }, cleanName,
            el("span", { text: "Trim trailing reference codes from captured names" })),
          error);

        return {
          validate: () => {
            if (!pattern.value.trim()) {
              error.textContent = "A pattern is required.";
              return false;
            }
            try {
              new RegExp(pattern.value, "iu");
            } catch (problem) {
              error.textContent = `That pattern is not valid: ${problem.message}`;
              return false;
            }
            return true;
          },
          value: () => ({
            enabled: existing ? existing.enabled !== false : true,
            label: label.value.trim() || pattern.value.trim(),
            pattern: pattern.value,
            replacement: replacement.value,
            titleCase: titleCase.checked,
            cleanName: cleanName.checked,
          }),
        };
      },
      { confirmText: existing ? "Save" : "Add" });

    if (!result) return;
    if (index === null) rules().push(result);
    else rules()[index] = result;
    store.save();
    renderRules();
  }

  async function testRule() {
    await customDialog("Test a payee name", (body) => {
      const input = textInput("", {
        placeholder: "Paste a payee name exactly as your bank writes it",
      });
      const answer = el("p", { class: "hint" });
      input.addEventListener("input", () => {
        const { compiled } = bank.compileRules(rules());
        const { payee, changed } = bank.applyPayeeRules(input.value, compiled);
        answer.textContent = input.value
          ? (changed ? `Becomes: ${payee}` : "No rule matches. The name is used as-is.")
          : "";
      });
      body.append(field("Payee name", input), answer);
      setTimeout(() => input.focus(), 0);
      return { value: () => true };
    }, { confirmText: "Done", cancelText: "Close" });
  }

  // ---------- convert ----------

  const convertButton = button("Convert", { accent: true, onClick: runConvert });
  const saveButton = button("Save YNAB CSV...", { onClick: saveCsv });
  const summary = hint("");

  // Pushing writes straight to YNAB over the API, same idea as Shared
  // Expenses: convert first (that is the preview), pick an account, push.
  // Saving the CSV above is untouched and still works exactly as before.
  // Pushing writes real transactions, so this never remembers or
  // pre-selects a prior account - it always starts back at "(choose an
  // account)" and has to be picked deliberately every time.
  const accountSelect = select([{ value: "", label: "(choose an account)" }], "", () => {});
  const pushButton = button("Push to YNAB...", { accent: true, onClick: pushToYnab });
  pushButton.disabled = true;
  const undoButton = button("Undo last push", { danger: true, onClick: undoLastPush });
  const undoLabel = hint("");

  root.append(pageActions(
    el("div", { class: "card-row" }, convertButton, saveButton, summary),
    el("div", { class: "card-row" },
      el("span", { class: "field-label", text: "Push to" }),
      el("div", { class: "narrow" }, accountSelect),
      pushButton, undoButton, undoLabel)));

  function lastPushes() {
    return store.get("bankImport.lastPushByBudget", {}) || {};
  }

  function paintUndoButton() {
    const backup = lastPushes()[state.budgetId];
    undoButton.disabled = !backup;
    undoLabel.textContent = backup
      ? `${backup.count} transaction(s) pushed to '${backup.accountName}' ` +
        `${new Date(backup.pushedAt).toLocaleString()}.`
      : "";
  }

  function renderAccountOptions() {
    const accounts = (state.accounts || []).filter((a) => !a.deleted && !a.closed);
    const options = [{
      value: "",
      label: accounts.length ? "(choose an account)" : "(load a budget on Setup first)",
    }].concat(accounts.map((a) => ({ value: a.id, label: a.name })));
    const current = accountSelect.value;
    accountSelect.replaceChildren(
      ...options.map((o) => el("option", { value: o.value, text: o.label })));
    accountSelect.disabled = !accounts.length;
    // Keep whatever is already chosen this visit (e.g. re-rendering right
    // before a push), but never resurrect a past visit's choice.
    accountSelect.value = accounts.some((a) => a.id === current) ? current : "";
  }

  async function pushToYnab() {
    if (!converted || !converted.rows.length) {
      return log.write("Convert a file first.", "warn");
    }
    if (!state.token) return log.write("Connect on the Setup page first.", "error");
    if (!state.budgetId) {
      return log.write("Select a budget on the Setup page first.", "error");
    }
    renderAccountOptions();
    const accountId = accountSelect.value;
    if (!accountId) return log.write("Choose an account to push to.", "error");
    const accountName = (state.accounts || []).find((a) => a.id === accountId)?.name
      || "that account";

    const confirmed = await confirmDialog("Push to YNAB",
      `Create ${converted.rows.length} transaction(s) in '${accountName}'?\n\n` +
      "YNAB recognises re-pushes of the same file and skips them, the same " +
      "way its own CSV import does.", { confirmText: "Push" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Pushing ${converted.rows.length} transaction(s) to '${accountName}'...`, "head");

    const result = await app.run(async () => {
      const client = state.requireClient();
      const transactions = bank.toYnabTransactions(converted.rows, accountId);
      return client.createTransactions(state.budgetId, transactions);
    }, { log, buttons: [convertButton, saveButton, pushButton] });

    if (!result) return;

    const createdIds = (result.transactions || []).map((t) => t.id)
      .filter(Boolean);
    const created = createdIds.length;
    const skipped = (result.duplicate_import_ids || []).length;
    state.invalidate();
    log.write(`Done. Created ${created} transaction(s).` +
      (skipped ? ` ${skipped} looked like duplicates already in YNAB and ` +
        "were skipped." : ""), "ok");

    if (created) {
      state.recordRun("bankImport");
      const all = { ...lastPushes() };
      all[state.budgetId] = {
        accountName, transactionIds: createdIds, count: created,
        pushedAt: Date.now(),
      };
      store.set("bankImport.lastPushByBudget", all);
      paintUndoButton();
    }
  }

  async function undoLastPush() {
    const backup = lastPushes()[state.budgetId];
    if (!backup) return;
    if (!state.token) return log.write("Connect on the Setup page first.", "error");

    const confirmed = await confirmDialog("Undo last push",
      `Delete the ${backup.count} transaction(s) pushed to ` +
      `'${backup.accountName}' on ${new Date(backup.pushedAt).toLocaleString()}?` +
      "\n\nThis deletes them from YNAB and cannot be undone from here.",
      { confirmText: "Delete" });
    if (!confirmed) return;

    log.clearLog();
    log.write(`Deleting ${backup.transactionIds.length} transaction(s)...`, "head");

    const result = await app.run(async ({ shouldStop }) => {
      const client = state.requireClient();
      return bank.undoPush(client, state.budgetId, backup.transactionIds, {
        log: (message, level) => log.write(message, level), shouldStop,
      });
    }, { log, buttons: [pushButton, undoButton] });

    if (!result) return;

    const all = { ...lastPushes() };
    delete all[state.budgetId];
    store.set("bankImport.lastPushByBudget", all);
    paintUndoButton();

    state.invalidate();
    log.write(`Done. Deleted ${result.deleted} transaction(s).` +
      (result.failed ? ` ${result.failed} failed.` : ""),
      result.failed ? "warn" : "ok");
  }

  const preview = table([
    { key: "Date", label: "Date" },
    { key: "Payee", label: "Payee" },
    { key: "Memo", label: "Memo" },
    { key: "Amount", label: "Amount", className: "num" },
  ]);
  preview.classList.add("scroll-table");

  root.append(sectionTitle("Preview"), preview, log);

  async function chooseFile() {
    const file = await pickFile(".csv,.txt,.tsv,text/csv,text/plain");
    if (file) readFile(file);
  }

  async function readFile(file) {
    log.clearLog();
    log.write(`Reading ${file.name} ...`, "head");

    let text;
    try {
      text = await file.text();
    } catch (error) {
      return log.write(`ERROR: could not read that file. ${error.message}`, "error");
    }

    try {
      parsed = bank.parseDelimited(text);
    } catch (error) {
      parsed = null;
      renderMapping();
      return log.write(`ERROR: ${error.message}`, "error");
    }

    sourceName = file.name;
    fileLabel.textContent =
      `${file.name}: ${parsed.rows.length} row(s), ${parsed.headers.length} column(s).`;
    log.write(`Columns found: ${parsed.headers.join(", ")}`);

    // Only guess when the saved mapping does not fit this file, so a
    // returning user keeps the mapping they set up last time.
    const fits = parsed.headers.includes(settings.dateColumn) &&
      parsed.headers.includes(settings.payeeColumn);
    if (!fits) {
      const guess = bank.guessColumns(parsed.headers);
      Object.assign(settings, guess);
      store.save();
      log.write("Guessed the column mapping from the header row. Check it below.", "warn");
    }

    renderMapping();
    converted = null;
    emptyRow(preview, "Press Convert to see the result.");
    summary.textContent = "";
    saveButton.disabled = true;
    pushButton.disabled = true;
  }

  function runConvert() {
    if (!parsed) return log.write("Choose a file first.", "warn");

    let result;
    try {
      result = bank.convert(parsed, settings);
    } catch (error) {
      converted = null;
      saveButton.disabled = true;
      return log.write(`ERROR: ${error.message}`, "error");
    }

    converted = result;
    clear(preview.tbody);
    for (const row of result.rows) {
      preview.tbody.append(el("tr", {},
        el("td", { text: row.Date }),
        el("td", { text: row.Payee }),
        el("td", { text: row.Memo }),
        el("td", { class: "num", text: row.Amount })));
    }

    for (const warning of result.warnings) log.write(warning, "warn");
    if (result.unparsedDates) {
      log.write(`${result.unparsedDates} date(s) could not be read and were ` +
        "left exactly as they were. Check those rows before importing.", "warn");
    }
    if (result.unparsedAmounts) {
      log.write(`${result.unparsedAmounts} amount(s) could not be read and ` +
        "became 0.00. Check those rows before importing.", "warn");
    }
    log.write(`Converted ${result.rows.length} row(s), renamed ` +
      `${result.renamedPayees} payee(s). Nothing has been saved yet.`, "ok");

    summary.textContent =
      `${result.rows.length} row(s) ready.` +
      (result.unparsedDates || result.unparsedAmounts ? " Some rows need a look." : "");
    saveButton.disabled = result.rows.length === 0;
    pushButton.disabled = result.rows.length === 0;
  }

  function saveCsv() {
    if (!converted || !converted.rows.length) return;
    const base = sourceName.replace(/\.[^.]+$/, "") || "bank-export";
    download(`${base}-ynab.csv`, bank.toCsv(converted.rows), "text/csv");
    log.write(`Saved ${base}-ynab.csv. Import it in YNAB under File Import ` +
      "on the account.", "ok");
    app.state.recordRun("bankImport");
  }

  // ---------- first paint ----------

  renderMapping();
  renderRules();
  renderAccountOptions();
  paintUndoButton();
  emptyRow(preview, "Choose a file and press Convert.");
  saveButton.disabled = true;
  pushButton.disabled = true;

  return root;
}
