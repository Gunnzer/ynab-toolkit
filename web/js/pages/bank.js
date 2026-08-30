// Bank Import: turn a bank export into a CSV that YNAB can import.
//
// Everything happens in the page. The file is read with FileReader and never
// uploaded anywhere.

import * as bank from "../tools/bank_convert.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, download, el,
  emptyRow, field, hint, logPane, pageHeading, pickFile,
  sectionTitle, select, table, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Choose a bank export to begin. Nothing is uploaded: the file is read in " +
  "this page and the result is saved straight back to your computer.";

// A day of 23 (not 5) so the three examples actually look different from
// each other - a day <= 12 leaves MM/dd and dd/MM identical-looking, which
// defeats the point of showing an example at all.
const DATE_FORMATS = [
  { value: "yyyy-MM-dd", label: "2025-03-23 (ISO)" },
  { value: "MM/dd/yyyy", label: "03/23/2025 (US)" },
  { value: "dd/MM/yyyy", label: "23/03/2025 (UK)" },
];

// Matches the "Read 03/05/2025 as" field label below - both halves need to
// be <= 12 here on purpose, since the whole point of this control is
// resolving a date that's genuinely ambiguous between the two orders.
const DATE_ORDERS = [
  { value: "monthFirst", label: "March 5th (month first)" },
  { value: "dayFirst", label: "3rd May (day first)" },
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
    "Reads a CSV, TSV, semicolon, QFX or OFX export from your bank and " +
    "writes the four columns YNAB wants, tidying up payee names on the way."));

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

  // ---------- mapping ----------

  // Two explicit 3-column rows (not the general auto-fit card-grid, which
  // would wrap to 2 or 1 per row on a narrower window) - the required
  // fields together, and the three optional ones together, at explicit
  // user request. The fixed 3-up count is a desktop-window-narrowing
  // concern, not a phone one - .map-grid-3 carries the 3-column rule in
  // app.css instead of inline, so the phone breakpoint there can drop it
  // back to one column without three squeezed-to-illegible selects.
  const mapHost = el("div", { class: "card-grid map-grid-3" });
  const optionalMapHost = el("div", { class: "card-grid map-grid-3" });
  const optionsHost = el("div", { class: "stack" });

  const COLUMN_FIELDS = [
    ["dateColumn", "Date", true],
    ["payeeColumn", "Payee", true],
    ["amountColumn", "Amount", false],
  ];
  const OPTIONAL_COLUMN_FIELDS = [
    ["memoColumn", "Memo (optional)", false],
    ["outflowColumn", "Outflow (optional)", false],
    ["inflowColumn", "Inflow (optional)", false],
  ];

  // Row 3 (the third actual transaction, not the header) if there are that
  // many, otherwise whatever the last row is - enough rows in to have moved
  // past a possible short first entry, without requiring the file to be
  // large. Returns null for an empty file so callers can skip showing
  // anything rather than printing "e.g. undefined".
  function sampleRow() {
    const rows = parsed?.rows || [];
    return rows.length ? rows[Math.min(2, rows.length - 1)] : null;
  }

  function renderMapping() {
    clear(mapHost);
    clear(optionalMapHost);
    clear(optionsHost);

    const headers = parsed?.headers || [];
    const options = [{ value: "", label: headers.length ? "(not used)" : "(load a file first)" }]
      .concat(headers.map((header) => ({ value: header, label: header })));
    const row = sampleRow();

    for (const [host, fields] of [[mapHost, COLUMN_FIELDS], [optionalMapHost, OPTIONAL_COLUMN_FIELDS]]) {
      for (const [key, label] of fields) {
        const current = headers.includes(settings[key]) ? settings[key] : "";
        const example = hint("");

        function paintExample(column) {
          example.textContent = row && column ? `e.g. "${row[column]}"` : "";
        }

        const node = select(options, current, (value) => {
          settings[key] = value;
          store.save();
          paintExample(value);
        });
        node.disabled = !headers.length;
        paintExample(current);
        host.append(el("div", {},
          el("label", { class: "field-label", text: label }), node, example));
      }
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
  //
  // Used to be its own section with its own floating title, which read
  // strangely once the rules table itself moved into a dialog - there was
  // no content left under the title to anchor it to. Folded into one
  // "Conversion setup" card together with the column mapping instead, with
  // Payee rules listed first and Columns below it, at explicit user request.

  const rulesButton = button("Rules (0)", { small: true, onClick: openRulesDialog });
  // Set while the dialog is open, so a mutation from inside it (edit, move,
  // remove) can repaint the dialog's own table too, not just the button's
  // count - the same rules() array backs both, there is only ever one list.
  let dialogRefresh = null;

  const mappingCard = card(
    sectionTitle("Conversion setup"),
    el("div", { class: "section-head" },
      sectionTitle("Payee rules"),
      el("span", { class: "spacer" }),
      rulesButton,
      button("Add rule", { small: true, onClick: () => editRule(null) }),
      button("Test a name", { small: true, onClick: testRule })),
    hint("Rules run top to bottom and the first match wins. Patterns are " +
      "regular expressions; use $<name> in the replacement to bring a named " +
      "group through."),
    sectionTitle("Columns"),
    hint("Map the columns in your file onto YNAB's four. Use Outflow and " +
      "Inflow instead of Amount if your bank splits them into two columns."),
    mapHost,
    optionalMapHost,
    optionsHost);
  root.append(mappingCard);

  function rules() {
    return settings.payeeRules || (settings.payeeRules = []);
  }

  function renderRules() {
    const count = rules().length;
    rulesButton.textContent = `Rules (${count})`;
    if (dialogRefresh) dialogRefresh();
  }

  // Edit and Remove each open their own dialog (a form, or a confirm), but
  // every dialog in this app shares one <dialog> element - there is no
  // stacking, so a second dialog opened while the rules dialog is still
  // open corrupts both (confirmed live: confirming a nested Remove silently
  // closed the rules dialog too, since its listeners were still attached to
  // the same shared form). Closing the rules dialog first, the same way
  // Escape does (a "cancel" event, which is what its own close logic
  // already listens for), avoids the corruption - editing or removing a
  // rule now steps out of the list dialog rather than nesting inside it.
  function closeOpenDialog() {
    const node = document.getElementById("dialog");
    if (node?.open) node.dispatchEvent(new Event("cancel"));
  }

  function openRulesDialog() {
    customDialog("Payee rules", (body) => {
      const dialogTable = table([
        { key: "on", label: "On", className: "check" },
        { key: "label", label: "Rule" },
        { key: "pattern", label: "Matches" },
        { key: "replacement", label: "Becomes" },
        { key: "actions", label: "" },
      ]);
      dialogTable.classList.add("scroll-table");

      function renderDialogTable() {
        clear(dialogTable.tbody);
        const list = rules();
        if (!list.length) {
          emptyRow(dialogTable,
            "No rules. Payee names will be used exactly as the bank wrote them.");
          return;
        }

        list.forEach((rule, index) => {
          const box = el("input", { type: "checkbox" });
          box.checked = rule.enabled !== false;
          box.addEventListener("change", () => {
            rule.enabled = box.checked;
            store.save();
          });

          dialogTable.tbody.append(el("tr", {},
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
                button("Edit", { small: true, onClick: () => { closeOpenDialog(); editRule(index); } }),
                button("Remove", {
                  small: true, danger: true,
                  onClick: () => { closeOpenDialog(); removeRule(index); },
                })))));
        });
      }

      dialogRefresh = renderDialogTable;
      renderDialogTable();
      body.append(dialogTable);
      return { value: () => true };
    }, { confirmText: "Done", cancelText: "", hideCancel: true, wide: true })
      .finally(() => { dialogRefresh = null; });
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

  // Regex is the only thing this actually needs, but writing one is not
  // something most people setting up a bank import want to learn. "Contains
  // this text" is a plain-text mode that covers the common case (rename any
  // payee containing some text to something cleaner) without exposing regex
  // syntax at all - it just escapes the text into a literal-match pattern
  // behind the scenes. "Regular expression" stays available for the cases
  // that genuinely need it (the two built-in Interac rules, which pull a
  // name out with a capture group, could not be written any other way).
  const RULE_MODES = [
    { value: "simple", label: "Contains this text" },
    { value: "advanced", label: "Regular expression (advanced)" },
  ];

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function editRule(index) {
    const existing = index === null ? null : rules()[index];
    // A brand new rule defaults to the friendlier Simple mode. An existing
    // rule with no explicit mode is either legacy data or was written as
    // regex before this toggle existed - either way its pattern is a real
    // regex, not literal text, so it needs Advanced to edit correctly;
    // only a rule explicitly saved as "simple" opens back into Simple.
    const initialMode = !existing ? "simple" : existing.mode === "simple" ? "simple" : "advanced";

    const result = await customDialog(
      existing ? "Edit rule" : "Add rule",
      (body) => {
        const label = textInput(existing?.label || "", { placeholder: "What this rule is for" });

        const modeSelect = select(RULE_MODES, initialMode, () => paintMode());

        const matchInput = textInput(
          initialMode === "simple" ? (existing?.matchText || "") : "",
          { placeholder: "Text that appears anywhere in the payee, for example AMZN MKTP" });
        const renameInput = textInput(
          initialMode === "simple" ? (existing?.replacement || "") : "",
          { placeholder: "What to rename it to, for example Amazon" });

        const pattern = textInput(initialMode === "advanced" ? (existing?.pattern || "") : "", {
          placeholder: "Regular expression, for example ^amzn mktp",
        });
        const replacement = textInput(
          initialMode === "advanced" ? (existing?.replacement || "") : "", {
            placeholder: "Replacement text, for example Amazon",
          });
        pattern.className = "mono";
        replacement.className = "mono";

        const titleCase = el("input", { type: "checkbox" });
        titleCase.checked = existing ? existing.titleCase !== false : true;
        const cleanName = el("input", { type: "checkbox" });
        cleanName.checked = existing ? existing.cleanName !== false : true;

        const simpleFields = el("div", { class: "stack" },
          field("Payee contains", matchInput),
          field("Rename to", renameInput));
        const advancedFields = el("div", { class: "stack" },
          field("Pattern", pattern),
          field("Replacement", replacement),
          el("label", { class: "checkbox" }, titleCase,
            el("span", { text: "Title Case any captured name" })),
          el("label", { class: "checkbox" }, cleanName,
            el("span", { text: "Trim trailing reference codes from captured names" })));

        const sampleInput = textInput("", {
          placeholder: "Try a payee name, for example AMZN MKTP US*1AB2C3",
        });
        const preview = el("p", { class: "hint" });

        const error = el("p", { class: "hint is-error" });

        function draftRule() {
          return modeSelect.value === "simple"
            ? {
              pattern: escapeRegExp(matchInput.value.trim()),
              replacement: renameInput.value,
              titleCase: false, cleanName: false,
            }
            : {
              pattern: pattern.value, replacement: replacement.value,
              titleCase: titleCase.checked, cleanName: cleanName.checked,
            };
        }

        function paintPreview() {
          if (!sampleInput.value.trim()) return preview.textContent = "";
          let compiled;
          try {
            ({ compiled } = bank.compileRules([draftRule()]));
          } catch {
            return preview.textContent = "";
          }
          const { payee, changed } = bank.applyPayeeRules(sampleInput.value, compiled);
          preview.textContent = changed
            ? `Becomes: ${payee}` : "Does not match this sample.";
        }

        function paintMode() {
          const simple = modeSelect.value === "simple";
          simpleFields.hidden = !simple;
          advancedFields.hidden = simple;
          paintPreview();
        }

        for (const input of [matchInput, renameInput, pattern, replacement, sampleInput]) {
          input.addEventListener("input", paintPreview);
        }

        body.append(
          field("Name", label),
          field("Match", modeSelect),
          simpleFields,
          advancedFields,
          field("Try it", sampleInput),
          preview,
          error);
        paintMode();

        return {
          validate: () => {
            if (modeSelect.value === "simple") {
              if (!matchInput.value.trim()) {
                error.textContent = "Enter the text to match.";
                return false;
              }
              return true;
            }
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
          value: () => {
            const simple = modeSelect.value === "simple";
            const draft = draftRule();
            return {
              enabled: existing ? existing.enabled !== false : true,
              mode: modeSelect.value,
              label: label.value.trim() || (simple ? matchInput.value.trim() : pattern.value.trim()),
              matchText: simple ? matchInput.value.trim() : undefined,
              pattern: draft.pattern,
              replacement: draft.replacement,
              titleCase: draft.titleCase,
              cleanName: draft.cleanName,
            };
          },
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
  const SAVE_FORMATS = [
    { value: "csv", label: "CSV", ext: "csv" },
    { value: "qfx", label: "QFX", ext: "qfx" },
  ];
  const saveFormatSelect = select(SAVE_FORMATS, settings.saveFormat || "qfx", (value) => {
    settings.saveFormat = value;
    store.save();
  });
  const saveButton = button("Save file...", { onClick: saveCsv });
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

  // Pushing straight to YNAB is turned off for now - flip this back on when
  // it's wanted again rather than deleting the feature underneath it.
  const SHOW_PUSH_TO_YNAB = false;

  // Used to be its own sticky pageActions() bar floating below the setup
  // card, which read as disconnected from the settings it acts on once
  // Payee rules and Columns were merged into one card. Appended to the
  // bottom of that same card instead, at explicit user request - a plain
  // card-row, not pageActions(), since pageActions() gives itself its own
  // sticky card chrome that would look like a card nested inside a card here.
  mappingCard.append(el("div", { class: "card-row" },
    convertButton, saveButton, el("div", { class: "narrow" }, saveFormatSelect), summary));
  if (SHOW_PUSH_TO_YNAB) {
    mappingCard.append(el("div", { class: "card-row" },
      el("span", { class: "field-label", text: "Push to" }),
      el("div", { class: "narrow" }, accountSelect),
      pushButton, undoButton, undoLabel));
  }

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
    const file = await pickFile(
      ".csv,.txt,.tsv,.qfx,.ofx,text/csv,text/plain");
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

    const isOfx = /\.(qfx|ofx)$/i.test(file.name) || bank.looksLikeOfx(text);

    try {
      parsed = isOfx ? bank.parseOfx(text) : bank.parseDelimited(text);
    } catch (error) {
      parsed = null;
      renderMapping();
      return log.write(`ERROR: ${error.message}`, "error");
    }

    sourceName = file.name;
    fileLabel.textContent =
      `${file.name}: ${parsed.rows.length} row(s), ${parsed.headers.length} column(s).`;

    if (isOfx) {
      // QFX/OFX already names its own fields - there is no header row to
      // guess from, so the mapping is set directly instead of guessed.
      Object.assign(settings, {
        dateColumn: "Date", payeeColumn: "Payee", memoColumn: "Memo",
        amountColumn: "Amount", outflowColumn: "", inflowColumn: "",
        dateFormat: settings.dateFormat || "yyyy-MM-dd",
      });
      store.save();
      log.write("Read as a QFX/OFX file - columns are already known.");
    } else {
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
    const format = SAVE_FORMATS.find((f) => f.value === saveFormatSelect.value) || SAVE_FORMATS[0];
    const base = sourceName.replace(/\.[^.]+$/, "") || "bank-export";
    const filename = `${base}-ynab.${format.ext}`;

    let text;
    let mime;
    if (format.value === "qfx") {
      const accountName = (state.accounts || [])
        .find((a) => a.id === accountSelect.value)?.name || base;
      text = bank.toOfx(converted.rows, { accountName });
      mime = "application/x-ofx";
    } else {
      text = bank.toCsv(converted.rows);
      mime = "text/csv";
    }

    download(filename, text, mime);
    log.write(`Saved ${filename}. Import it in YNAB under File Import on ` +
      "the account.", "ok");
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
