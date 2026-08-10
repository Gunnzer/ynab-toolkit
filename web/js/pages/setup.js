// Setup: token, budget, tool switches and backups.
//
// Looking at the budget itself belongs on the Budget page. This one is only
// about getting connected and staying that way.

import { estimateStorage } from "../store.js";
import {
  button, card, checkbox, clear, confirmDialog, download, el, field, hint,
  logPane, pageHeading, pickFile, sectionTitle, textInput,
} from "../ui.js";

const LOG_EMPTY =
  "Nothing here yet. Paste a token and press Connect, and your budgets will " +
  "show up in this space.";

export function setupPage(app) {
  const state = app.state;
  const store = state.store;
  const root = el("div", { class: "page-body" });
  const log = logPane(LOG_EMPTY);

  root.append(pageHeading(
    "Setup",
    "Connect to YNAB and pick a budget. Everything runs in your browser: " +
    "your token is never sent anywhere except api.ynab.com."));

  // ---------- token ----------

  const tokenInput = textInput(state.token, {
    type: "password", placeholder: "Paste your YNAB token",
  });
  tokenInput.classList.add("grow");

  const showToken = checkbox("Show", false, (checked) => {
    tokenInput.type = checked ? "text" : "password";
  });

  const rememberBox = checkbox(
    "Remember on this device", store.get("rememberToken"), (checked) => {
      store.set("rememberToken", checked);
      if (checked && state.token) {
        store.saveToken(state.token);
        log.write("Token saved in this browser.", "ok");
      } else if (!checked) {
        store.clearToken();
        log.write("Saved token removed from this browser.", "muted");
      }
      renderRememberNote();
    });

  const rememberNote = hint("");
  function renderRememberNote() {
    rememberNote.textContent = store.get("rememberToken")
      ? "Stored in this browser's local storage as plain text. Anyone with " +
        "access to this device and browser profile could read it. Leave this " +
        "off on a shared computer."
      : "The token is kept in memory for this tab only, and is forgotten " +
        "when you close it.";
  }
  renderRememberNote();

  const connectButton = button("Connect", { accent: true, onClick: connect });
  const budgetStatus = el("p", { class: "hint" });

  root.append(card(
    el("div", { class: "card-row" },
      el("label", { class: "field-label", style: "margin:0", text: "Access token" }),
      tokenInput, showToken),
    el("div", { class: "card-row" },
      connectButton,
      button("Get a token", {
        onClick: () => window.open(
          "https://app.ynab.com/settings/developer", "_blank", "noopener"),
      }),
      button("Forget token", { onClick: forgetToken })),
    rememberBox,
    rememberNote));

  // ---------- budget ----------

  const budgetSelect = el("select", { disabled: true });
  budgetSelect.addEventListener("change", onBudgetChange);

  root.append(card(
    el("div", { class: "card-row" },
      el("label", { class: "field-label", style: "margin:0", text: "Budget" }),
      el("div", { class: "grow" }, budgetSelect),
      button("Reload data", { onClick: loadBudgetData }),
      button("View budget", { onClick: () => app.go("budget") })),
    budgetStatus));

  // ---------- activity ----------

  root.append(sectionTitle("Activity"), log);

  // ---------- people ----------
  //
  // Defined once here because Shared Expenses and Bill Splitting both mean the
  // same two people. Those pages show these values but cannot edit them.

  // Share of shared expenses: one number (person1Ratio), person 2 always
  // gets the remainder, so it lives under Shared Expenses' own settings
  // even though it is edited here, next to the account tag.
  const sharedSettings = store.section("sharedExpenses");
  let person1ShareInput = null;
  let person2ShareDisplay = null;
  const shareError = hint("");
  shareError.hidden = true;

  function paintPerson2Share() {
    const raw = person1ShareInput.value.trim();
    // Empty is not the same as 0: Number("") is 0, so this has to be
    // checked first or a blank field would silently read as "person 1
    // gets nothing" instead of "not set".
    if (raw === "") {
      shareError.hidden = true;
      person2ShareDisplay.value = "";
      return;
    }
    const value = Number(raw);
    const valid = Number.isFinite(value) && value >= 0 && value <= 100;
    shareError.hidden = valid;
    if (!valid) {
      shareError.textContent = "Enter a number between 0 and 100.";
      shareError.className = "hint is-error";
    }
    person2ShareDisplay.value = valid ? String(100 - value) : "";
  }

  function personFields(which) {
    const saved = state.person(which);
    const write = (key) => (value) => {
      store.set(`people.person${which}.${key}`, value.trim());
      app.buildNav();
    };
    const fields = [
      field(`Person ${which} name`,
        textInput(saved.name, {
          placeholder: `Person ${which}`, onInput: write("name"),
        })),
      field("Category group starts with",
        textInput(saved.groupPrefix, {
          placeholder: "same as the name", onInput: write("groupPrefix"),
        })),
      field("Account tag",
        textInput(saved.accountTag, {
          placeholder: "none", onInput: write("accountTag"),
        })),
    ];

    if (which === 1) {
      person1ShareInput = textInput(
        String((sharedSettings.person1Ratio ?? 0.35) * 100), {
          type: "number",
          onInput: () => {
            const raw = person1ShareInput.value.trim();
            const value = Number(raw);
            if (raw !== "" && Number.isFinite(value) && value >= 0 && value <= 100) {
              sharedSettings.person1Ratio = value / 100;
              store.save();
            }
            paintPerson2Share();
          },
        });
      person1ShareInput.min = "0";
      person1ShareInput.max = "100";
      fields.push(field("Share of shared expenses (%)", person1ShareInput), shareError);
    } else {
      person2ShareDisplay = textInput("", {});
      person2ShareDisplay.disabled = true;
      fields.push(field("Share of shared expenses (%)", person2ShareDisplay));
    }

    return el("div", { class: "stack" }, ...fields);
  }

  root.append(card(
    sectionTitle("The two people"),
    hint("Used by Shared Expenses and Bill Splitting. Bill Splitting also works " +
      "out whose expense a transaction was: a category group starting with " +
      "the prefix below belongs to that person, and everything else is " +
      "shared. The account tag is the letter in brackets in front of an " +
      "account name, and is only consulted when a transaction has no " +
      "category group at all. Share of shared expenses is Shared " +
      "Expenses' own split - person 2 always gets the remainder."),
    el("div", { class: "card-grid" }, personFields(1), personFields(2)),
    hint("Renaming someone here changes how Bill Splitting classifies " +
      "transactions, not just the column headings.")));
  paintPerson2Share();

  // ---------- tools ----------

  const toolsCard = card(sectionTitle("Tools"),
    hint("Hide the tools you do not use. Nothing is deleted and their " +
      "settings are kept, so you can switch them back on any time."));

  import("../main.js").then(({ TOGGLEABLE }) => {
    for (const page of TOGGLEABLE) {
      toolsCard.append(
        checkbox(page.title, app.toolEnabled(page.key), (checked) => {
          const enabled = { ...(store.get("tools.enabled", {}) || {}) };
          enabled[page.key] = checked;
          store.set("tools.enabled", enabled);
          app.buildNav();
        }),
        hint("      " + page.blurb));
    }
  });
  root.append(toolsCard);

  // ---------- backup ----------

  const storageNote = hint("");
  estimateStorage()?.then((estimate) => {
    if (!estimate?.usage) return;
    storageNote.textContent =
      `Currently using about ${Math.max(1, Math.round(estimate.usage / 1024))} KB ` +
      "of browser storage.";
  });

  root.append(card(
    sectionTitle("Your settings"),
    hint("Settings live in this browser only. Clearing browsing data will " +
      "erase them, so save a backup file and keep it somewhere safe. The " +
      "same file restores everything here or in another browser."),
    el("div", { class: "card-row" },
      button("Back up settings", { accent: true, onClick: exportSettings }),
      button("Restore from file", { onClick: importSettings }),
      button("Reset everything", { danger: true, onClick: resetAll })),
    hint("Backups contain your settings and category mappings. They never " +
      "contain your access token."),
    storageNote));

  // ---------- behaviour ----------

  function setBudgetStatus() {
    let text;
    let className = "hint";
    if (!state.token) {
      text = "Not connected. Paste a token above and press Connect.";
    } else if (!state.budgetId) {
      text = "Connected. Choose a budget to load its categories.";
      className = "hint is-warn";
    } else if (!state.hasBudgetData) {
      text = `Budget '${state.budgetName}' is selected, but its categories ` +
        "are not loaded yet.";
      className = "hint is-warn";
    } else {
      text = `Ready. '${state.budgetName}' is loaded - the tools can now ` +
        "pick categories from it.";
      className = "hint is-ok";
    }
    budgetStatus.textContent = text;
    budgetStatus.className = className;
  }

  function renderBudgets(budgets, selectedIndex) {
    clear(budgetSelect);
    budgets.forEach((budget) => {
      budgetSelect.append(el("option", { value: budget.id, text: budget.name }));
    });
    budgetSelect.disabled = budgets.length === 0;
    if (selectedIndex >= 0) budgetSelect.selectedIndex = selectedIndex;
  }

  async function connect() {
    const token = tokenInput.value.trim();
    if (!token) {
      log.write("Paste your YNAB personal access token first.", "warn");
      return;
    }

    state.token = token;
    state.connection = "connecting";
    state.notify();
    log.clearLog();
    log.write("Connecting to YNAB...", "head");

    const result = await app.run(async () => {
      const client = state.client();
      // Budgets and the chosen budget's data in ONE go: chaining two
      // requests through separate calls is how the desktop version once
      // ended up showing "categories not loaded" forever.
      const budgets = await client.budgets();
      const savedId = state.budgetId;
      let index = budgets.findIndex((budget) => budget.id === savedId);
      const fellBack = index < 0 && budgets.length > 0;
      if (index < 0 && budgets.length) index = 0;

      let data = null;
      if (index >= 0) {
        const budgetId = budgets[index].id;
        const [groups, accounts, transactions] = await Promise.all([
          client.categories(budgetId),
          client.accounts(budgetId),
          // Every tool reads transactions from this same fetch for the
          // rest of the session, rather than each asking YNAB on its own.
          client.transactions(budgetId),
        ]);
        data = { groups, accounts, transactions };
      }
      return { budgets, index, fellBack, data };
    }, { log, buttons: [connectButton] });

    if (!result) {
      state.connection = "failed";
      state.notify();
      setBudgetStatus();
      return;
    }

    const { budgets, index, fellBack, data } = result;
    state.budgets = budgets;
    state.connection = "connected";
    log.write(`Connected. Found ${budgets.length} budget(s).`, "ok");

    if (store.get("rememberToken")) store.saveToken(state.token);

    const savedId = state.budgetId;
    if (index < 0) {
      renderBudgets(budgets, -1);
    } else {
      if (fellBack && savedId) {
        log.write(
          `The remembered budget is no longer on this account. Falling back ` +
          `to '${budgets[index].name}'; check your category mappings.`, "warn");
      } else if (fellBack && budgets.length > 1) {
        log.write(
          `No budget was remembered, so '${budgets[index].name}' was picked ` +
          `from your ${budgets.length} budgets. Choose a different one above ` +
          "if that is wrong; it will be remembered from then on.", "warn");
      }
      renderBudgets(budgets, index);
      state.setBudget(budgets[index].id, budgets[index].name);
    }

    if (data) {
      state.categoryGroups = data.groups;
      state.accounts = data.accounts;
      state.cacheTransactions(data.transactions);
      const visible = state.flatCategories(false).length;
      const total = state.flatCategories(true).length;
      log.write(
        `Loaded ${state.groups().length} group(s), ${visible} visible ` +
        `categories (${total - visible} hidden), ${data.accounts.length} ` +
        `account(s), ${data.transactions.length} transaction(s).`, "ok");
    }

    // So a plain page reload can reuse this instead of fetching again.
    state.persistSession();
    state.notify();
    setBudgetStatus();
  }

  async function onBudgetChange() {
    const budget = state.budgets[budgetSelect.selectedIndex];
    if (!budget || budget.id === state.budgetId) return;
    state.setBudget(budget.id, budget.name);
    state.notify();
    await loadBudgetData();
  }

  async function loadBudgetData() {
    if (!state.budgetId) return log.write("Select a budget first.", "warn");
    if (!state.token) return log.write("Connect with a token first.", "warn");

    log.write(`Loading data for '${state.budgetName}'...`, "head");
    const result = await app.run(async () => state.reloadAll(), { log });

    if (!result) return;
    const visible = state.flatCategories(false).length;
    log.write(`Loaded ${state.groups().length} group(s), ${visible} ` +
      `visible categories, ${result.transactions.length} transaction(s).`, "ok");
    state.notify();
    setBudgetStatus();
  }

  function forgetToken() {
    store.clearToken();
    store.set("rememberToken", false);
    state.token = "";
    state.connection = "idle";
    state.budgets = [];
    state.categoryGroups = [];
    state.accounts = [];
    state.clearSession();
    tokenInput.value = "";
    clear(budgetSelect);
    budgetSelect.disabled = true;
    state.notify();
    setBudgetStatus();
    log.write("Token cleared.", "muted");
    app.refresh();
  }

  function exportSettings() {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`ynab-toolkit-settings-${stamp}.json`,
      JSON.stringify(store.exportData(), null, 2));
    log.write("Settings saved to a file. Keep it somewhere safe.", "ok");
  }

  async function importSettings() {
    const file = await pickFile("application/json,.json");
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      log.write("That file is not valid JSON.", "error");
      return;
    }
    const result = store.importData(payload);
    log.write(result.message, result.ok ? "ok" : "error");
    if (result.ok) {
      state.categoryGroups = [];
      state.accounts = [];
      state.notify();
      app.refresh();
    }
  }

  async function resetAll() {
    const confirmed = await confirmDialog("Reset everything",
      "This clears every setting, mapping and undo record in this browser, " +
      "and forgets your token.\n\nBack up first if you might want any of it " +
      "back. Continue?",
      { confirmText: "Reset", cancelText: "Keep my settings" });
    if (!confirmed) return;
    store.reset();
    state.token = "";
    state.budgets = [];
    state.categoryGroups = [];
    state.accounts = [];
    state.connection = "idle";
    state.clearSession();
    state.notify();
    app.go("setup");
  }

  // ---------- first paint ----------

  setBudgetStatus();
  if (state.budgets.length) {
    const index = state.budgets.findIndex((b) => b.id === state.budgetId);
    renderBudgets(state.budgets, index);
  }
  if (state.token) log.write("Loaded your saved token from this browser.", "muted");

  return root;
}
