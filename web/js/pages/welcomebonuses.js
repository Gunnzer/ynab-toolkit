// Welcome Bonuses (at explicit user request, a separate tool under Card
// Rewards): which card's sign-up offer is worth the most in its first year,
// and how a bonus you are working towards is going. Offers come from the
// same card details file as Card Rewards; tracked bonuses are saved here.

import { CARDS, NETWORKS, POINT_TYPES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue } from "../tools/card_feed.js";
import { shortName } from "../tools/card_rewards.js";
import {
  CHEXY_FEE, NO_FILTERS, addMonths, filterOffers, progress, rankOffers, spentOnAccount,
} from "../tools/welcome_bonuses.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, el, field, hint, icon, pageHeading, pill,
  sectionTitle, select, textInput,
} from "../ui.js";
import { localToday } from "./report_kit.js";

const money = (n) => new Intl.NumberFormat("en-CA", {
  style: "currency", currency: "CAD", maximumFractionDigits: n % 1 ? 2 : 0,
}).format(n);

const STATUS = {
  done: ["Done", "ok"],
  "on-track": ["On track", "info"],
  behind: ["Behind", "caution"],
  missed: ["Missed", "error"],
};

export function welcomeBonusesPage(app) {
  const state = app.state;
  const store = state.store;
  const settings = store.section("welcomeBonuses");
  if (!Array.isArray(settings.tracked)) settings.tracked = [];
  if (typeof settings.hideHeld !== "boolean") settings.hideHeld = true;
  // Offers you are not interested in (at explicit user request), hidden
  // until brought back.
  if (!Array.isArray(settings.dismissed)) settings.dismissed = [];
  // Narrowing the Offers list (at explicit user request: "filter by point
  // types, card types, etc"), remembered.
  settings.filters = { ...NO_FILTERS, ...(settings.filters || {}) };
  let showDismissed = false;
  const rewards = store.section("cardRewards");
  // YNAB spending per account, loaded once per visit when a bonus is linked.
  let ynab = null;

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Welcome Bonuses",
    "Which card's sign-up bonus is worth the most in its first year: the bonus " +
    "at the same cautious point values as Card Rewards, less the first year's " +
    "fee. Track a bonus you are working towards to see how much is left to " +
    "spend and by when. Offers are re-checked every week with the card details."));

  const trackHost = el("div");
  const offersHost = el("div");
  root.append(trackHost, offersHost);

  const today = localToday();
  // A card you are tracking a bonus for is one you have, even before it is
  // added under Card Rewards' Your cards.
  const held = () => [...(rewards.wallet || []).map((w) => w.id), ...settings.tracked.map((t) => t.cardId)]
    .filter(Boolean);

  // ---------- offers ----------

  function renderOffers() {
    clear(offersHost);
    const all = rankOffers(CARDS, { values: rewards.values || {}, held: held(), today });
    const isDismissed = (o) => settings.dismissed.includes(o.card.id);
    const dismissedCount = all.filter(isDismissed).length;
    const narrowed = filterOffers(all, settings.filters);
    const shown = narrowed
      .filter((o) => !settings.hideHeld || !o.held)
      .filter((o) => showDismissed || !isDismissed(o));
    const filtering = Object.values(settings.filters).some(Boolean);
    const toggle = checkbox("Hide cards you have", settings.hideHeld, (on) => {
      settings.hideHeld = on;
      store.save();
      renderOffers();
    });
    offersHost.append(card(
      el("div", { class: "reward-group-head" },
        el("h3", { class: "section-title", text: "Offers" }),
        el("span", { class: "hint", text: "Best first year first: the bonus at cautious point values, less the first year's fee" })),
      all.length ? filterBar(all) : "",
      all.some((o) => o.held) ? toggle : "",
      shown.length
        ? shown.map(offerRow)
        : hint(!CARDS.length
          ? "Getting the latest card details..."
          : filtering && !narrowed.length
            ? "No offers match these filters."
            : all.length
            ? "Nothing left to show: every offer is for a card you have or one you dismissed."
            : "No welcome offers in the card list yet. They are looked up every week along with the card details."),
      dismissedCount
        ? el("button", {
          type: "button",
          class: "btn btn-small btn-link bonus-dismissed-toggle",
          text: showDismissed ? "Hide dismissed offers" : `Show dismissed offers (${dismissedCount})`,
          onClick: () => {
            showDismissed = !showDismissed;
            renderOffers();
          },
        })
        : ""));
  }

  /** Points / Network / Issuer / Fee selects, offering only what the offers have. */
  function filterBar(all) {
    const distinct = (pick) => [...new Set(all.map((o) => pick(o.card)))].filter(Boolean);
    const choose = (key, label, options) => {
      const node = select([{ value: "", label: `Any ${label.toLowerCase()}` }, ...options], settings.filters[key] || "", (value) => {
        settings.filters[key] = value;
        store.save();
        renderOffers();
      });
      node.setAttribute("aria-label", label);
      return field(label, node);
    };
    const filtering = Object.values(settings.filters).some(Boolean);
    return el("div", { class: "bonus-filters" },
      el("div", { class: "card-grid bonus-filter-grid" },
        choose("points", "Points", distinct((c) => c.points)
          .map((id) => ({ value: id, label: POINT_TYPES[id]?.name || id }))
          .sort((a, b) => a.label.localeCompare(b.label))),
        choose("network", "Network", distinct((c) => c.network)
          .map((id) => ({ value: id, label: NETWORKS[id] || id }))),
        choose("issuer", "Issuer", distinct((c) => c.issuer).sort()
          .map((name) => ({ value: name, label: name }))),
        choose("fee", "Fee", [
          { value: "none", label: "No fee" },
          { value: "first-free", label: "Free first year" },
          { value: "under-200", label: "Under $200" },
          { value: "premium", label: "$200 or more" },
        ])),
      filtering
        ? el("button", {
          type: "button",
          class: "btn btn-small btn-link",
          text: "Clear filters",
          onClick: () => {
            settings.filters = { ...NO_FILTERS };
            store.save();
            renderOffers();
          },
        })
        : "");
  }

  function offerRow({ card: c, value, fee, net, held: have }) {
    const w = c.welcome;
    const dismissed = settings.dismissed.includes(c.id);
    const setDismissed = (on) => {
      settings.dismissed = on
        ? [...new Set([...settings.dismissed, c.id])]
        : settings.dismissed.filter((id) => id !== c.id);
      store.save();
      renderOffers();
    };
    const points = w.points
      ? `${w.points.toLocaleString("en-CA")} ${POINT_TYPES[c.points]?.name || "points"}`
      : "";
    const parts = [points, w.cash ? `${money(w.cash)} cash` : ""].filter(Boolean).join(" + ");
    return el("div", { class: `bonus-row${have || dismissed ? " is-held" : ""}` },
      el("div", { class: "bonus-value" },
        el("span", { text: money(Math.round(net)) }),
        el("span", { class: "reward-rate-unit", text: "first year" })),
      el("div", { class: "reward-body" },
        el("div", { class: "reward-name" },
          el("span", { class: "reward-title", text: shortName(c), title: c.name }),
          have ? pill("You have it", "muted") : null,
          w.ends ? pill(`Until ${shortDate(w.ends)}`, "caution") : null,
          dismissed
            ? null
            : el("button", {
              type: "button",
              class: "bonus-dismiss",
              title: "Dismiss this offer",
              "aria-label": `Dismiss the ${shortName(c)} offer`,
              onClick: () => setDismissed(true),
            }, icon("x", { size: 16 }))),
        el("div", { class: "reward-detail-line", text: w.detail }),
        el("div", {
          class: "reward-detail-line",
          text: (w.points ? `${parts} (about ${money(value)}). ` : `${parts} back. `) +
            `Spend ${money(w.minSpend)} in ${w.months} month${w.months === 1 ? "" : "s"}. ` +
            `First year fee ${fee ? money(fee) : "$0"}${fee !== (Number(c.annualFee) || 0) ? `, then ${money(Number(c.annualFee) || 0)}` : ""}.`,
        }),
        el("div", { class: "card-row bonus-actions" },
          el("span", { class: "hint", text: `Source: ${w.source}.` }),
          dismissed
            ? button("Bring back", { small: true, onClick: () => setDismissed(false) })
            : have ? "" : button("Track it", { small: true, onClick: () => editTracked(null, c) }))));
  }

  // ---------- tracking ----------

  function renderTracked() {
    clear(trackHost);
    const rows = settings.tracked.map(trackedRow);
    trackHost.append(card(
      el("div", { class: "reward-group-head" },
        el("h3", { class: "section-title", text: "Working towards" })),
      rows.length ? rows : hint("Got a new card? Track its bonus here to see how much is left to spend and by when."),
      el("div", { class: "card-row" },
        button("Track a bonus...", { accent: !rows.length, onClick: () => editTracked(null, null) }))));
  }

  function spentFor(t) {
    if (!t.accountId || !ynab) return Number(t.spent) || 0;
    return spentOnAccount(ynab, t.accountId, t.opened, addMonths(t.opened, t.months));
  }

  function trackedRow(t) {
    const linked = t.accountId && ynab;
    const p = progress({ ...t, spent: spentFor(t) }, today);
    const [label, kind] = STATUS[p.status];
    const account = linked ? state.accounts.find((a) => a.id === t.accountId) : null;
    const lines = [
      `${money(p.spent)} of ${money(p.minSpend)} spent` + (linked && account ? `, from ${account.name} in YNAB` : "") + ".",
      p.status === "done"
        ? "Spent enough. The bonus usually posts within a couple of statements."
        : p.status === "missed"
          ? `The deadline was ${longDate(p.deadline)}.`
          : `${money(p.left)} to go by ${longDate(p.deadline)} (${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}), about ${money(p.perDay)} a day.`,
    ];
    if (p.status === "on-track" || p.status === "behind") {
      lines.push(`Putting the rest through Chexy for rent would cost about ${money(p.chexyFee)} in fees (${+(CHEXY_FEE * 100).toFixed(2)}%).`);
    }
    return el("div", { class: "bonus-track" },
      el("div", { class: "reward-name" },
        el("span", { class: "reward-title", text: t.name }),
        pill(label, kind)),
      el("div", {
        class: `reward-meter is-${p.status === "done" ? "ok" : p.status === "on-track" ? "ok" : p.status === "behind" ? "caution" : "warn"}`,
        role: "progressbar",
        "aria-label": `${t.name} spending`,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(p.pct * 100)),
      }, el("span", { style: `width: ${Math.round(p.pct * 100)}%` })),
      lines.map((text) => el("div", { class: "reward-detail-line", text })),
      el("div", { class: "card-row bonus-actions" },
        linked ? "" : button("Update spent", { small: true, onClick: () => updateSpent(t) }),
        button("Edit", { small: true, onClick: () => editTracked(t, null) }),
        el("button", {
          type: "button",
          class: "btn btn-small btn-link",
          text: "Remove",
          onClick: () => removeTracked(t),
        })));
  }

  async function updateSpent(t) {
    const result = await customDialog(`Spent on ${t.name}`, (body) => {
      const input = textInput(t.spent ?? "", { type: "number", placeholder: "0" });
      input.min = "0";
      input.step = "0.01";
      input.setAttribute("inputmode", "decimal");
      body.append(field("Spent so far ($)", input),
        hint("Purchases since you opened the card, refunds taken off. Your statement or the bank's app shows it."));
      return { value: () => Math.max(0, Number(input.value) || 0) };
    }, { confirmText: "Save" });
    if (result === null) return;
    t.spent = result;
    store.save();
    renderTracked();
  }

  async function editTracked(existing, fromCard) {
    const base = existing || {
      id: `bonus-${Date.now().toString(36)}`,
      cardId: fromCard?.id || "",
      name: fromCard ? shortName(fromCard) : "",
      opened: today,
      minSpend: fromCard?.welcome?.minSpend ?? "",
      months: fromCard?.welcome?.months ?? 3,
      spent: 0,
      accountId: "",
    };
    const creditAccounts = (state.accounts || []).filter((a) => a.type === "creditCard" && !a.closed && !a.deleted);
    const result = await customDialog(existing ? "Edit bonus" : "Track a bonus", (body) => {
      const name = textInput(base.name, { placeholder: "e.g. Amex Cobalt" });
      const opened = textInput(base.opened, { type: "date" });
      const minSpend = textInput(base.minSpend, { type: "number", placeholder: "e.g. 3000" });
      minSpend.min = "0";
      minSpend.setAttribute("inputmode", "decimal");
      const months = textInput(base.months, { type: "number" });
      months.min = "1";
      months.max = "24";
      const spent = textInput(base.spent || "", { type: "number", placeholder: "0" });
      spent.min = "0";
      spent.setAttribute("inputmode", "decimal");
      const spentField = field("Spent so far ($)", spent);
      const account = select(
        [{ value: "", label: "I'll type it in" }, ...creditAccounts.map((a) => ({ value: a.id, label: a.name }))],
        base.accountId || "",
        (value) => { spentField.hidden = Boolean(value); });
      spentField.hidden = Boolean(account.value);
      const error = el("p", { class: "hint is-error" });
      body.append(
        el("div", { class: "card-grid" },
          field("Card", name),
          field("Opened", opened),
          field("Spend ($)", minSpend),
          field("Months", months),
          creditAccounts.length ? field("From YNAB", account) : "",
          spentField),
        hint(creditAccounts.length
          ? "Pick the card's account in YNAB and the spending is added up for you (purchases since it opened, refunds taken off, payments left out)."
          : "Connect YNAB in Settings to have the spending added up for you."),
        error);
      return {
        validate: () => {
          if (!name.value.trim()) error.textContent = "Name the card.";
          else if (!/^\d{4}-\d{2}-\d{2}$/.test(opened.value)) error.textContent = "Pick the day the card was opened.";
          else if (!(Number(minSpend.value) > 0)) error.textContent = "How much has to be spent?";
          else if (!(Number.isInteger(Number(months.value)) && Number(months.value) >= 1 && Number(months.value) <= 24)) error.textContent = "Months should be 1 to 24.";
          else return true;
          return false;
        },
        value: () => ({
          ...base,
          name: name.value.trim(),
          opened: opened.value,
          minSpend: Number(minSpend.value),
          months: Number(months.value),
          spent: Math.max(0, Number(spent.value) || 0),
          accountId: account.value,
        }),
      };
    }, { confirmText: existing ? "Save" : "Track it" });
    if (!result) return;
    const at = settings.tracked.findIndex((t) => t.id === result.id);
    if (at >= 0) settings.tracked[at] = result; else settings.tracked.push(result);
    store.save();
    await loadYnab();
    renderTracked();
    renderOffers();
  }

  async function removeTracked(t) {
    if (!(await confirmDialog("Stop tracking", `Stop tracking the ${t.name} bonus?`, { confirmText: "Remove" }))) return;
    settings.tracked = settings.tracked.filter((x) => x.id !== t.id);
    store.save();
    renderTracked();
  }

  // ---------- data ----------

  async function loadYnab() {
    const linked = settings.tracked.filter((t) => t.accountId);
    if (!linked.length || !state.token || !state.budgetId) return;
    const since = linked.map((t) => t.opened).sort()[0];
    try {
      ynab = (await state.transactions(since)).list;
    } catch {
      // Offline or signed out: fall back to the amounts typed in.
      ynab = null;
    }
  }

  function shortDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  }

  function longDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  }

  renderTracked();
  renderOffers();
  (async () => {
    // The same downloaded card details as Card Rewards.
    if (!CARDS.length) {
      let storage = null;
      try { storage = window.localStorage; } catch { storage = null; }
      await loadCatalogue({ fetchJson: browserFetchJson, storage });
    }
    await loadYnab();
    renderTracked();
    renderOffers();
  })();

  return root;
}
