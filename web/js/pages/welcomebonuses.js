// Welcome Bonuses (at explicit user request, a separate tool under Card
// Rewards): which card's sign-up offer is worth the most in its first year,
// and how a bonus you are working towards is going. Offers come from the
// same card details file as Card Rewards; tracked bonuses are saved here.

import { CARDS, NETWORKS, POINT_TYPES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue, useSavedCatalogue } from "../tools/card_feed.js";
import { shortName, walletCards } from "../tools/card_rewards.js";
import { bonusPlan, bonusProfile, rentToClose, spendItems } from "../tools/card_spending.js";
import { readyToAssignCategoryIds } from "../tools/rta_tracker.js";
import {
  CHEXY_FEE, NO_FILTERS, addMonths, filterOffers, offerDeadline, progress, rankOffers, spentOnAccount,
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
  // YNAB transactions, loaded once per visit: for linked bonuses, and a
  // year of card spending for whether each offer is reachable.
  let ynab = null;
  let spending = null;
  // What goes through Chexy a month, when typed (blank = what went through
  // Chexy in YNAB). Labelled as Chexy, not rent (at explicit user request:
  // "what if I just want to put the amount that's going through chexy").
  if (!(Number(settings.rent) >= 0)) settings.rent = "";

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Bonuses",
    "Which card's sign-up bonus is worth the most in its first year: the bonus " +
    "at the same point values as Best card, less the first year's " +
    "fee. Track a bonus you are working towards to see how much is left to " +
    "spend and by when. Offers are re-checked twice a week with the card details."));

  const trackHost = el("div");
  const offersHost = el("div");
  root.append(trackHost, offersHost);

  const today = localToday();
  // A card you are tracking a bonus for is one you have, even before it is
  // added under Card Rewards' Your cards.
  const held = () => [...(rewards.wallet || []).map((w) => w.id), ...settings.tracked.map((t) => t.cardId)]
    .filter(Boolean);

  // ---------- offers ----------

  let currentProfile = null;
  const planFor = (c) => (currentProfile && c.welcome?.minSpend
    ? bonusPlan(c, currentProfile, { minSpend: c.welcome.minSpend, months: c.welcome.months })
    : null);

  function renderOffers() {
    clear(offersHost);
    currentProfile = profile();
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
        el("span", { class: "hint", text: "Best first year first: the bonus at your point values, less the first year's fee" })),
      all.length ? filterBar(all) : "",
      spending ? rentField() : "",
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
      // No label above each: the first option already says what it is
      // ("Any network"), and the filters stay compact (at explicit user request).
      node.setAttribute("aria-label", label);
      return node;
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

  // ---------- reaching an offer with your own spending ----------
  // At explicit user request (2026-11-17: "how do I know if the bonuses make
  // sense with and without Chexy?"): each offer says whether your card
  // spending reaches its minimum in time, how many rent payments through
  // Chexy would close the gap, and what it is worth after the rewards your
  // other cards would have earned on that spending.

  function profile() {
    if (!spending || !CARDS.length) return null;
    return bonusProfile(spending, walletCards(rewards.wallet || []), {
      rent: Number(settings.rent) || 0, values: rewards.values || {}, preferred: rewards.preferred || "",
    });
  }

  function rentField() {
    const found = profile()?.foundRent || 0;
    const input = el("input", {
      type: "number", min: "0", step: "1", inputmode: "decimal", enterkeyhint: "done",
      placeholder: found ? String(Math.round(found)) : "e.g. 2000",
      "aria-label": "Through Chexy a month",
    });
    input.value = settings.rent === "" ? "" : String(settings.rent);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      settings.rent = input.value.trim() && n > 0 ? n : "";
      store.save();
      renderOffers();
      renderTracked();
    });
    return el("div", { class: "bonus-rent" },
      el("label", { class: "bonus-rent-field" },
        el("span", { class: "field-label", text: "Through Chexy a month" }), input),
      hint(found
        ? `${money(Math.round(found))} a month went through Chexy in YNAB. Type a different amount to try it.`
        : "Type what you could pay through Chexy a month to see each offer with it."));
  }

  function planLines(c, net, plan) {
    if (!plan) return "";
    const worth = (cost) => `Worth about ${money(Math.round(net - cost))}` +
      (cost >= 1 ? ` after ${money(Math.round(cost))} your other cards would have earned on it.` : ".");
    const w = plan.without;
    const r = plan.withRent;
    const lines = [w.reachable
      ? { ok: true, lead: "Without Chexy:", text: `Reachable. ${worth(w.cost)}` }
      : { ok: false, lead: "Without Chexy:", text: `${money(Math.round(w.short))} short. Your cards see about ${money(Math.round(plan.monthly))} a month besides Chexy.` }];
    // Rent is offered when it is needed, or when it is the cheaper way there
    // (rent off a 4% card can cost less than moving everyday spending).
    if (r && (!w.reachable || (r.payments > 0 && r.cost + 0.5 < w.cost))) {
      lines.push(r.reachable
        ? { ok: true, lead: "With Chexy:", text: `${r.payments} Chexy payment${r.payments === 1 ? "" : "s"}. ${worth(r.cost)}` }
        : { ok: false, lead: "Even with Chexy:", text: `${money(Math.round(r.short))} short in ${plan.months} month${plan.months === 1 ? "" : "s"}.` });
    }
    return el("div", { class: "bonus-plan" }, lines.map((line) => el("div", {
      class: `bonus-plan-line ${line.ok ? "is-ok" : "is-short"}`,
    }, el("strong", { text: line.lead }), " ", el("span", { text: line.text }))));
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
    const deadline = offerDeadline(c, today);
    return el("div", { class: `bonus-row${have || dismissed ? " is-held" : ""}` },
      el("div", { class: "bonus-value" },
        el("span", { text: money(Math.round(net)) }),
        el("span", { class: "reward-rate-unit", text: "first year" })),
      el("div", { class: "reward-body" },
        el("div", { class: "reward-name" },
          el("span", { class: "reward-title", text: shortName(c), title: c.name }),
          have ? pill("You have it", "muted") : null,
          deadlinePill(deadline),
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
            `First year fee ${fee ? money(fee) : "$0"}${fee !== (Number(c.annualFee) || 0) ? `, then ${money(Number(c.annualFee) || 0)}` : ""}.`,
        }),
        deadlineLine(deadline),
        planLines(c, net, planFor(c)),
        el("div", { class: "card-row bonus-actions" },
          el("span", { class: "hint", text: `Source: ${w.source}.` }),
          // A card you already have can be tracked too (asked live: "I should
          // be able to track cards I already have no?"): a new card is in
          // the Wallet the day it arrives, while its bonus is still running.
          dismissed
            ? button("Bring back", { small: true, onClick: () => setDismissed(false) })
            : settings.tracked.some((t) => t.cardId === c.id)
              ? pill("Tracking", "info")
              : button("Track it", { small: true, onClick: () => editTracked(null, c) }))));
  }

  // Every offer says when it ends, or that no end is announced, and how
  // long you have to spend after opening (at explicit user request: "there
  // should be deadlines on the sign up bonus page").
  function deadlinePill(d) {
    if (!d.ends || d.daysLeft === null || d.daysLeft < 0) return null;
    if (d.daysLeft === 0) return pill("Ends today", "error");
    return pill(d.soon ? `Ends in ${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"}` : `Until ${shortDate(d.ends)}`, d.soon ? "error" : "caution");
  }

  function deadlineLine(d) {
    const apply = d.ends
      ? `Apply by ${longDate(d.ends)}${d.daysLeft > 0 ? ` (${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left)` : d.daysLeft === 0 ? " (today)" : ""}.`
      : "No end date announced, so it can change at any time.";
    const spend = d.months
      ? ` Then spend ${money(d.minSpend)} within ${d.months} month${d.months === 1 ? "" : "s"} of opening.`
      : "";
    return el("div", { class: `bonus-deadline${d.soon ? " is-soon" : ""}` },
      icon("clock", { size: 14 }),
      el("span", { text: apply + spend }));
  }

  // ---------- tracking ----------

  function renderTracked() {
    clear(trackHost);
    const rows = settings.tracked.map(trackedRow);
    trackHost.append(card(
      el("div", { class: "reward-group-head" },
        el("h3", { class: "section-title", text: "Working towards" })),
      rows.length ? rows : hint("Got a new card? Track its bonus here to see how much is left to spend and by when."),
      el("div", { class: "bonus-track-row" },
        button("Track a bonus...", { accent: !rows.length, small: true, onClick: () => editTracked(null, null) }))));
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
      const known = profile();
      const rent = known ? rentToClose(CARDS.find((c) => c.id === t.cardId) || null, known, p.left) : null;
      lines.push(rent
        ? `That's ${rent.payments} Chexy payment${rent.payments === 1 ? "" : "s"}` +
          (known.viaChexy
            ? (rent.cost >= 1 ? `, giving up about ${money(Math.round(rent.cost))} your other cards would have earned on it.` : ".")
            : `, about ${money(Math.round(rent.cost))} in Chexy's fees after what the card earns.`)
        : `Putting the rest through Chexy would cost about ${money(p.chexyFee)} in fees (${+(CHEXY_FEE * 100).toFixed(2)}%).`);
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
      accountId: walletAccount(fromCard?.id),
    };
    const creditAccounts = (state.accounts || []).filter((a) => a.type === "creditCard" && !a.closed && !a.deleted);
    // Cards in the Wallet with an offer, so "Track a bonus..." can fill one in.
    const fromWallet = existing || fromCard ? [] : (rewards.wallet || [])
      .map((w) => CARDS.find((c) => c.id === w.id))
      .filter((c) => c?.welcome && !settings.tracked.some((t) => t.cardId === c.id));
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
      const pick = fromWallet.length
        ? select([{ value: "", label: "Another card" }, ...fromWallet.map((c) => ({ value: c.id, label: shortName(c) }))], "", (id) => {
          const c = CARDS.find((x) => x.id === id);
          base.cardId = c ? c.id : "";
          if (!c) return;
          name.value = shortName(c);
          minSpend.value = c.welcome.minSpend ?? "";
          months.value = c.welcome.months ?? 3;
          const linked = walletAccount(c.id);
          if (linked && creditAccounts.some((a) => a.id === linked)) {
            account.value = linked;
            spentField.hidden = true;
          }
        })
        : null;
      const error = el("p", { class: "hint is-error" });
      body.append(
        pick ? field("From your Wallet", pick) : "",
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

  /** The YNAB account a Wallet card is linked to, if any. */
  function walletAccount(cardId) {
    return (cardId && (rewards.wallet || []).find((w) => w.id === cardId)?.accountId) || "";
  }

  async function removeTracked(t) {
    if (!(await confirmDialog("Stop tracking", `Stop tracking the ${t.name} bonus?`, { confirmText: "Remove" }))) return;
    settings.tracked = settings.tracked.filter((x) => x.id !== t.id);
    store.save();
    renderTracked();
  }

  // ---------- data ----------

  async function loadYnab() {
    if (!(state.token && state.budgetId && state.hasBudgetData)) return;
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    const yearAgo = isoDate(start);
    const since = [yearAgo, ...settings.tracked.filter((t) => t.accountId).map((t) => t.opened)].sort()[0];
    try {
      ynab = (await state.transactions(since)).list;
    } catch {
      // Offline or signed out: fall back to the amounts typed in.
      ynab = null;
      spending = null;
      return;
    }
    // A year of credit card spending, the kind a new card could take over.
    const cards = new Set((state.accounts || [])
      .filter((a) => !a.deleted && a.on_budget !== false && (a.type === "creditCard" || a.type === "lineOfCredit"))
      .map((a) => a.id));
    const names = new Map(state.flatCategories(true).map((i) => [i.category.id, i.category.name]));
    spending = cards.size
      ? spendItems(ynab, {
        accountIds: cards, since: yearAgo, until: today,
        categoryName: (id) => names.get(id) || "",
        exclude: readyToAssignCategoryIds(state.categoryGroups),
      })
      : null;
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function shortDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  }

  function longDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
  }

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  // The saved copy at once, then the latest whenever the page opens (at
  // most every FEED_MAX_AGE_MS, so hopping between the card tabs is free).
  useSavedCatalogue(storage);
  renderTracked();
  renderOffers();
  (async () => {
    await loadCatalogue({ fetchJson: browserFetchJson, storage });
    renderTracked();
    renderOffers();
    await loadYnab();
    renderTracked();
    renderOffers();
  })();

  return root;
}
