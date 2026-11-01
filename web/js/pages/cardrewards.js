// Card Rewards: pick what you are buying and see which of your cards earns
// the most for it, grouped by the kind of points each earns. Asks follow-up
// questions (which store, does it take Amex, is a cap used up) until it is
// at least 90% sure. Standalone: reads nothing from YNAB. The card details
// are downloaded from this site at most once a day (tools/card_feed.js).

import { CARDS, CATALOGUE_CHECKED, NETWORKS, POINT_TYPES, PURCHASES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue } from "../tools/card_feed.js";
import {
  TARGET_CONFIDENCE, UNSURE, daysSince, describeEarn, explain, formatEarned,
  formatRate, groupName, purchaseLabel, recommend, shortName, walletCards,
} from "../tools/card_rewards.js";
import {
  button, card, checkbox, clear, customDialog, dateLabel, el, field, hint, icon,
  pageHeading, pill, sectionTitle, select, textInput, todayIso,
} from "../ui.js";

const NETWORK_SHORT = { amex: "Amex", visa: "Visa", mastercard: "Mastercard" };

export function cardRewardsPage(app) {
  const store = app.state.store;
  const settings = store.section("cardRewards");
  if (!Array.isArray(settings.wallet)) settings.wallet = [];
  if (!PURCHASES.some((p) => p.id === settings.purchase)) settings.purchase = "groceries";

  // Answers belong to one purchase, so they are not saved: tomorrow's
  // groceries may be at a different store.
  let answers = {};
  let last = null;

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Card Rewards",
    "Pick what you are buying and see which of your cards earns the most " +
    "for it, grouped by the kind of points each one earns. Points are " +
    "compared as they are (5x is 5, 4% is 4), so compare within a group. " +
    "Where the answer depends on something it does not know yet (which " +
    "store, whether a cap is used up), it asks, until it is at least 90% " +
    "sure. Card details are re-checked once a month and downloaded at most " +
    "once a day, like exchange rates. Nothing here reads or changes your " +
    "budget."));

  const purchaseSelect = select(
    PURCHASES.map((p) => ({ value: p.id, label: p.label })),
    settings.purchase,
    (value) => {
      settings.purchase = value;
      store.save();
      answers = {};
      render();
    });

  const amountInput = textInput(settings.amount || "", {
    type: "number",
    placeholder: "Optional",
    onInput: (value) => {
      settings.amount = value;
      store.save();
      paint();
    },
  });
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.setAttribute("inputmode", "decimal");

  const pickCard = card(
    el("div", { class: "card-grid reward-pick" },
      field("What are you buying?", purchaseSelect),
      field("How much? (CAD)", amountInput)));
  root.append(pickCard);

  const askHost = el("div");
  const resultsHost = el("div", { class: "reward-groups" });
  const walletList = el("div", { class: "reward-wallet" });
  const addSelect = el("select", { "aria-label": "Card to add" });
  addSelect.addEventListener("change", () => { addButton.disabled = !addSelect.value; });
  const addButton = button("Add card", {
    accent: true,
    onClick: () => {
      if (!addSelect.value) return;
      settings.wallet.push({ id: addSelect.value });
      store.save();
      renderWallet();
      render();
    },
  });

  const feedStatus = el("p", { class: "hint" });
  const updateButton = el("button", {
    type: "button",
    class: "reward-quiet",
    text: "Check for updates",
    onClick: () => refreshCatalogue(true),
  });
  const walletCard = card(
    sectionTitle("Your cards"),
    walletList,
    el("div", { class: "card-row reward-add" },
      el("div", { class: "reward-add-select" }, addSelect),
      addButton,
      button("Add one by hand...", { onClick: () => editCustom(null) })),
    el("div", { class: "card-row reward-feed" }, feedStatus, updateButton),
    hint("A card that is missing can be added by hand, or ask for it to be " +
      "added to the built-in list."));
  root.append(askHost, resultsHost, walletCard);

  let feed = null;

  async function refreshCatalogue(force = false) {
    updateButton.disabled = true;
    feedStatus.textContent = "Getting the latest card details...";
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    feed = await loadCatalogue({ fetchJson: browserFetchJson, storage, force });
    updateButton.disabled = false;
    paintFeed();
    renderWallet();
    render();
  }

  function paintFeed() {
    if (!feed) return;
    feedStatus.classList.toggle("is-error", !feed.ok || feed.source === "saved-fallback");
    if (!feed.ok) {
      feedStatus.textContent = `${feed.error} Check your connection and try again.`;
      return;
    }
    const age = daysSince(CATALOGUE_CHECKED, todayIso());
    const parts = [`Card details checked ${dateLabel(CATALOGUE_CHECKED)}` +
      (age !== null && age > 45 ? ` (${age} days ago, so may be out of date)` : "") + "."];
    parts.push(feed.source === "downloaded"
      ? "Downloaded just now."
      : `Downloaded ${sinceLabel(feed.fetchedAt)}.`);
    if (feed.source === "saved-fallback") parts.push(`${feed.error} Using the copy saved on this device.`);
    feedStatus.textContent = parts.join(" ");
  }

  function sinceLabel(at) {
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (minutes < 2) return "just now";
    if (minutes < 90) return `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} hours ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  function amount() {
    const value = Number(settings.amount);
    return value > 0 ? value : 0;
  }

  function render() {
    const cards = walletCards(settings.wallet);
    last = cards.length ? recommend(cards, settings.purchase, answers) : null;
    paint();
  }

  // Redraw without working the ranking out again (an amount change only
  // changes the points shown, never the ranking).
  function paint() {
    // With no cards yet, adding some is the only useful thing to do, so
    // that card comes first; once there are cards it moves to the end.
    if (settings.wallet.length) root.append(walletCard);
    else root.insertBefore(walletCard, pickCard);
    renderAsk();
    renderResults();
  }

  /** A card name on one line: short form, full name on hover. */
  function cardName(c) {
    return el("span", { class: "reward-title", text: shortName(c), title: c.name });
  }

  function renderAsk() {
    clear(askHost);
    if (!last) return;
    const pct = Math.floor(last.confidence * 100);
    const kind = last.confidence >= TARGET_CONFIDENCE ? "ok" : pct >= 70 ? "caution" : "warn";
    const body = [];
    const spend = amount();
    const top = last.groups[0]?.cards[0];

    // "Most points", not "best": points are compared raw across programs,
    // so the top card earns the biggest number, which is not always the
    // most value (10 PC Optimum points are worth a cent).
    body.push(el("div", { class: "field-label", text: `Most points for ${purchaseLabel(settings.purchase).toLowerCase()}` }));
    body.push(top?.accepted
      ? el("div", { class: "reward-answer" },
        el("div", { class: "reward-rate", text: formatRate(top.card.points, top.rate) }),
        el("div", { class: "reward-answer-body" },
          el("div", { class: "reward-name" }, cardName(top.card)),
          el("div", { class: "hint", text: [groupName(top.card.points),
            formatEarned(top.card.points, top.rate, spend)].filter(Boolean).join(", ") })))
      : el("p", { class: "reward-answer-none", text: "None of your cards are accepted here." }));

    body.push(el("div", { class: "reward-sure" },
      el("div", { class: "reward-sure-head" },
        pill(`${pct}% sure`, kind)),
      el("div", {
        class: `reward-meter is-${kind}`,
        role: "progressbar",
        "aria-label": "How sure",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(pct),
      }, el("span", { style: `width: ${pct}%` }))));

    if (last.next) {
      const q = last.next;
      body.push(
        el("p", { class: "reward-question", text: q.text }),
        el("div", { class: "reward-options" },
          q.options.map((option) => button(option.label, {
            onClick: () => answer(q.id, option.id),
          })),
          el("button", {
            type: "button",
            class: "reward-quiet",
            text: "Not sure",
            onClick: () => answer(q.id, UNSURE),
          })));
    } else {
      body.push(hint(last.confidence >= TARGET_CONFIDENCE
        ? "Sure enough: no more questions."
        : "Nothing left to ask would change this, so this is as sure as it gets."));
    }

    if (last.asked.length) {
      body.push(el("div", { class: "reward-asked" },
        el("span", { class: "hint", text: "Your answers:" }),
        last.asked.map(({ question, answer: text }) => el("button", {
          type: "button",
          class: "reward-chip",
          title: `${question.text} Click to ask again.`,
          onClick: () => {
            delete answers[question.id];
            render();
          },
        }, el("span", { text: text }), icon("x", { size: 14 }))),
        button("Start over", {
          small: true,
          onClick: () => {
            answers = {};
            render();
          },
        })));
    }

    askHost.append(card(...body));
  }

  function answer(id, value) {
    answers = { ...answers, [id]: value };
    render();
  }

  function renderResults() {
    clear(resultsHost);
    if (!last) {
      resultsHost.append(card(hint(!CARDS.length && !feed
        ? "Getting the latest card details..."
        : "Add the cards you have under \"Your cards\" below, and the best " +
          "one for each purchase shows up here.")));
      return;
    }
    const spend = amount();
    for (const group of last.groups) {
      const note = POINT_TYPES[group.points]?.note;
      resultsHost.append(el("section", { class: "card reward-group" },
        el("div", { class: "reward-group-head" },
          el("h3", { class: "section-title", text: group.name }),
          note ? el("span", { class: "hint", text: note }) : null),
        group.cards.map((stat, i) => resultRow(stat, i === 0 && stat.accepted, group.cards.length > 1, spend))));
    }
  }

  function resultRow(stat, best, labelBest, spend) {
    const lines = explain(stat, settings.purchase, answers);
    return el("div", { class: `reward-row${best ? " is-best" : ""}${stat.accepted ? "" : " is-out"}` },
      el("div", { class: "reward-rate", text: stat.accepted ? formatRate(stat.card.points, stat.rate) : "-" }),
      el("div", { class: "reward-body" },
        el("div", { class: "reward-name" },
          cardName(stat.card),
          best && labelBest ? pill("Best", "ok") : null,
          stat.accepted ? null : pill("Not accepted", "error")),
        lines.map((line) => el("div", { class: "hint", text: line }))),
      el("div", { class: "reward-earned", text: stat.accepted ? formatEarned(stat.card.points, stat.rate, spend) : "" }));
  }

  // ---------- your cards ----------

  function renderWallet() {
    clear(walletList);
    const cards = walletCards(settings.wallet);
    if (!cards.length) walletList.append(hint("No cards yet. Add the ones you carry."));

    settings.wallet.forEach((entry, index) => {
      const resolved = cards.find((c) => c.id === entry.id);
      if (resolved) walletList.append(walletRow(entry, resolved, index));
      else if (CARDS.length) walletList.append(goneRow(entry, index));
    });

    const held = new Set(settings.wallet.map((e) => e.id));
    clear(addSelect);
    const available = CARDS.filter((c) => !held.has(c.id))
      .sort((a, b) => a.issuer.localeCompare(b.issuer) || a.name.localeCompare(b.name));
    addSelect.append(el("option", {
      value: "",
      text: !CARDS.length ? "Card details not loaded yet"
        : available.length ? "Choose a card to add..." : "Every built-in card is added",
    }));
    let groupNode = null;
    let lastIssuer = null;
    for (const c of available) {
      if (c.issuer !== lastIssuer) {
        lastIssuer = c.issuer;
        groupNode = el("optgroup", { label: c.issuer });
        addSelect.append(groupNode);
      }
      groupNode.append(el("option", { value: c.id, text: c.name }));
    }
    addSelect.value = "";
    addButton.disabled = true;
  }

  // A card dropped from the downloaded list (discontinued, usually). Kept
  // in the wallet so it comes back if the list gets it again.
  function goneRow(entry, index) {
    return el("div", { class: "reward-wallet-row" },
      el("div", { class: "reward-wallet-main" },
        el("div", { class: "reward-wallet-text" },
          el("div", { class: "reward-name" }, el("span", { class: "reward-title", text: entry.id })),
          el("div", { class: "hint", text: "No longer in the card list, so it is left out of the ranking." })),
        removeButton(entry.id, index)));
  }

  function removeButton(label, index) {
    return el("button", {
      type: "button",
      class: "row-exclude-btn",
      title: `Remove ${label}`,
      "aria-label": `Remove ${label}`,
      onClick: () => {
        settings.wallet.splice(index, 1);
        store.save();
        renderWallet();
        render();
      },
    }, icon("x", { size: 16 }));
  }

  function walletRow(entry, resolved, index) {
    // One short line, so every row is the same height; the long forms are
    // in Details.
    const meta = [
      NETWORK_SHORT[resolved.network],
      groupName(resolved.points),
      resolved.annualFee ? `$${Math.round(resolved.annualFee)}/yr` : "No fee",
      resolved.fxFee ? null : "No FX fee",
    ].filter(Boolean).join(" \u00b7 ");

    const extras = [];
    if (resolved.picks) {
      const chosen = new Set(entry.picks || []);
      const boxes = el("div", { class: "reward-picks" });
      const paint = () => {
        for (const box of boxes.querySelectorAll("input")) {
          box.disabled = !box.checked && chosen.size >= resolved.picks.count;
        }
      };
      for (const id of resolved.picks.from) {
        boxes.append(checkbox(PURCHASES.find((p) => p.id === id)?.label || id, chosen.has(id), (on) => {
          if (on) chosen.add(id); else chosen.delete(id);
          entry.picks = resolved.picks.from.filter((p) => chosen.has(p));
          store.save();
          paint();
          render();
        }));
      }
      paint();
      extras.push(el("div", { class: "field-label", text: resolved.picks.label }), boxes);
    }
    for (const flag of resolved.flags || []) {
      extras.push(checkbox(flag.label, entry.flags?.[flag.id], (on) => {
        entry.flags = { ...(entry.flags || {}), [flag.id]: on };
        store.save();
        render();
      }));
    }

    return el("div", { class: "reward-wallet-row" },
      el("div", { class: "reward-wallet-main" },
        el("div", { class: "reward-wallet-text" },
          el("div", { class: "reward-name" },
            cardName(resolved),
            resolved.custom ? pill("Yours", "muted") : null),
          el("div", { class: "hint reward-meta", text: meta })),
        el("div", { class: "reward-wallet-actions" },
          button("Details", { small: true, onClick: () => showDetails(resolved) }),
          resolved.custom ? button("Edit", { small: true, onClick: () => editCustom(entry) }) : null,
          removeButton(resolved.name, index))),
      extras.length ? el("div", { class: "reward-wallet-extras" }, extras) : null);
  }

  function showDetails(resolved) {
    customDialog(resolved.name, (body) => {
      body.append(el("div", { class: "reward-detail-list" },
        describeEarn(resolved).map((line) => el("div", { class: "reward-detail" },
          el("div", { class: "reward-rate", text: line.rate }),
          el("div", {},
            el("div", { text: line.what }),
            line.conditions.map((c) => el("div", { class: "hint", text: c })))))));
      for (const note of resolved.notes || []) body.append(hint(note));
      body.append(hint([
        `${NETWORKS[resolved.network]}, earns ${groupName(resolved.points)}.`,
        resolved.fxFee ? `${Math.round(resolved.fxFee * 1000) / 10}% foreign transaction fee.` : "No foreign transaction fee.",
        resolved.checked ? `Checked ${dateLabel(resolved.checked)} against ${resolved.source}.` : resolved.source + ".",
      ].join(" ")));
    }, { confirmText: "Done", hideCancel: true });
  }

  async function editCustom(existing) {
    const draft = existing ? structuredClone(existing) : { rates: {} };
    const result = await customDialog(existing ? "Edit card" : "Add a card by hand", (body) => {
      const name = textInput(draft.name || "", { placeholder: "e.g. My store card" });
      const network = select(
        Object.entries(NETWORKS).map(([value, label]) => ({ value, label })),
        draft.network || "visa", () => {});
      const pointsName = textInput(draft.pointsName || "", { placeholder: "e.g. Air Miles" });
      const pointsField = field("Name of the points", pointsName);
      const points = select(
        [...Object.entries(POINT_TYPES).map(([value, t]) => ({ value, label: t.name })),
          { value: "other", label: "Something else..." }],
        draft.points || "other",
        (value) => { pointsField.hidden = value !== "other"; });
      pointsField.hidden = points.value !== "other";
      const base = textInput(draft.base ?? "1", { type: "number" });
      base.min = "0";
      base.step = "0.01";
      let fx = draft.fxFee === undefined ? true : draft.fxFee > 0;
      const error = el("p", { class: "hint is-error" });

      const rates = {};
      const grid = el("div", { class: "card-grid reward-rate-grid" });
      for (const p of PURCHASES.filter((x) => x.id !== "other")) {
        const input = textInput(draft.rates?.[p.id] ?? "", { type: "number", placeholder: "Same as base" });
        input.min = "0";
        input.step = "0.01";
        rates[p.id] = input;
        grid.append(field(p.label, input));
      }

      body.append(
        el("div", { class: "card-grid" },
          field("Card name", name),
          field("Network", network),
          field("Points it earns", points),
          pointsField,
          field("Everything else earns", base)),
        checkbox("Charges a foreign transaction fee", fx, (on) => { fx = on; }),
        sectionTitle("Better rates"),
        hint("Points per $1, or the percent for cash back. Leave a box blank " +
          "if it earns the same as everything else."),
        grid,
        error);

      return {
        validate: () => {
          if (!name.value.trim()) error.textContent = "Give the card a name.";
          else if (!(Number(base.value) > 0)) error.textContent = "Everything else needs a rate above 0.";
          else if (points.value === "other" && !pointsName.value.trim()) error.textContent = "Name the points it earns.";
          else return true;
          return false;
        },
        value: () => ({
          id: draft.id || `custom-${Date.now().toString(36)}`,
          custom: true,
          name: name.value.trim(),
          network: network.value,
          points: points.value === "other" ? "" : points.value,
          pointsName: points.value === "other" ? pointsName.value.trim() : "",
          base: Number(base.value),
          fxFee: fx ? 0.025 : 0,
          rates: Object.fromEntries(Object.entries(rates)
            .filter(([, input]) => Number(input.value) > 0)
            .map(([id, input]) => [id, Number(input.value)])),
        }),
      };
    }, { confirmText: existing ? "Save" : "Add card", wide: true });

    if (!result) return;
    const at = existing ? settings.wallet.indexOf(existing) : -1;
    if (at >= 0) settings.wallet[at] = result; else settings.wallet.push(result);
    store.save();
    renderWallet();
    render();
  }

  renderWallet();
  render();
  refreshCatalogue();
  return root;
}
