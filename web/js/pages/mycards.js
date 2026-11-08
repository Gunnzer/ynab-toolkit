// My cards (at explicit user request: "a my card page where you can add and
// setup your cards and you'll see an image of the card with details like
// fee, upcoming fee increase, rewards per group or type... Remove the card
// add from the other page, they should all be based on this new page").
// The one place cards are added, set up and removed; Best card, Welcome
// bonuses and the Tier list all read the same cardRewards.wallet.

import { CARDS, CATALOGUE_CHECKED, NETWORKS, POINT_TYPES, PURCHASES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue } from "../tools/card_feed.js";
import {
  centsPerPoint, daysSince, groupName, groupUnit, shortName, transferRatio, walletCards,
} from "../tools/card_rewards.js";
import { FACES, LIGHT_FACES, cardFace, earnLines, feeInfo, walletFees } from "../tools/my_cards.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, dateLabel, el, field, hint,
  pageHeading, pill, sectionTitle, select, textInput, todayIso,
} from "../ui.js";

const NETWORK_MARK = { amex: "AMEX", visa: "VISA", mastercard: "Mastercard" };
const FACE_LABELS = {
  blue: "Blue", navy: "Navy", sky: "Light blue", gold: "Gold", silver: "Silver", black: "Black",
  charcoal: "Charcoal", red: "Red", green: "Green", teal: "Teal", orange: "Orange", plum: "Plum", rose: "Rose",
};

export function myCardsPage(app) {
  const store = app.state.store;
  const settings = store.section("cardRewards");
  if (!Array.isArray(settings.wallet)) settings.wallet = [];
  if (!settings.values || typeof settings.values !== "object") settings.values = {};
  if (typeof settings.preferred !== "string") settings.preferred = "";

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "My cards",
    "The credit cards you carry: add them here once, set up the ones with " +
    "choices (like Tangerine's categories), and see what each costs and " +
    "earns. Which card to use, Sign-up bonuses and Card rankings all use this list."));

  // ---------- adding ----------
  const addSelect = el("select", { "aria-label": "Card to add" });
  const addButton = button("Add card", {
    accent: true,
    onClick: () => {
      if (!addSelect.value) return;
      settings.wallet.push({ id: addSelect.value });
      store.save();
      renderAll();
    },
  });
  addSelect.addEventListener("change", () => { addButton.disabled = !addSelect.value; });
  const feedStatus = el("p", { class: "hint" });
  const updateButton = el("button", {
    type: "button",
    class: "reward-quiet",
    text: "Check for updates",
    onClick: () => refreshCatalogue(true),
  });
  const addCard = card(
    sectionTitle("Add a card"),
    el("div", { class: "card-row reward-add" },
      el("div", { class: "reward-add-select" }, addSelect),
      addButton,
      button("Add one by hand...", { onClick: () => editCustom(null) })),
    el("div", { class: "card-row reward-feed" }, feedStatus, updateButton),
    hint("A card that is missing can be added by hand, or ask for it to be added to the built-in list."));

  const summary = el("div");
  const grid = el("div", { class: "mycards-grid" });

  // ---------- points ----------
  const preferredSelect = el("select", { "aria-label": "Preferred points" });
  preferredSelect.addEventListener("change", () => {
    settings.preferred = preferredSelect.value;
    store.save();
    renderAll();
  });
  const preferredHint = el("p", { class: "hint" });
  const pointsCard = card(
    sectionTitle("Points"),
    el("label", { class: "field-label", text: "Preferred" }),
    el("div", { class: "reward-preferred" }, preferredSelect),
    preferredHint,
    el("div", { class: "reward-points-more" },
      hint("What a point is worth decides the ranking and the % back shown here."),
      el("button", { type: "button", class: "reward-quiet", text: "Point values...", onClick: () => editValues() })));

  root.append(summary, grid, addCard, pointsCard);

  let feed = null;

  async function refreshCatalogue(force = false) {
    updateButton.disabled = true;
    feedStatus.textContent = "Getting the latest card details...";
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    feed = await loadCatalogue({ fetchJson: browserFetchJson, storage, force });
    updateButton.disabled = false;
    paintFeed();
    renderAll();
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
    if (feed.source === "saved-fallback") parts.push(`${feed.error} Using the copy saved on this device.`);
    feedStatus.textContent = parts.join(" ");
  }

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const money = (n) => `$${Number(n).toLocaleString("en-CA", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const pct = (n) => `${Number(n.toFixed(2))}%`;

  function renderAll() {
    const cards = walletCards(settings.wallet);
    // With no cards, adding one is the only thing to do, so it comes first.
    if (settings.wallet.length) root.append(addCard, pointsCard);
    else root.insertBefore(addCard, summary);
    pointsCard.hidden = !settings.wallet.length;
    renderSummary(cards);
    renderGrid(cards);
    renderAddList();
    renderPreferred(cards);
  }

  function renderSummary(cards) {
    clear(summary);
    if (!cards.length) {
      summary.append(card(hint(!CARDS.length && !feed
        ? "Getting the latest card details..."
        : "No cards yet. Add the ones you carry, and they show up here with what each costs and earns.")));
      return;
    }
    const fees = walletFees(cards, localToday());
    const lines = [`${cards.length} card${cards.length === 1 ? "" : "s"}, ${fees.now ? `${money(fees.now)} a year in fees` : "no annual fees"}.`];
    if (fees.changes.length) {
      lines.push(`Going up to ${money(fees.next)} a year: ` + fees.changes.map((c) =>
        `${shortName(c.card)} ${c.diff >= 0 ? "+" : ""}${money(c.diff)} from ${dateLabel(c.from)}`).join(", ") + ".");
    }
    summary.append(el("div", { class: "card mycards-summary" }, lines.map((t, i) => el("p", { class: i ? "hint" : "", text: t }))));
  }

  function renderGrid(cards) {
    clear(grid);
    settings.wallet.forEach((entry, index) => {
      const resolved = cards.find((c) => c.id === entry.id);
      if (resolved) grid.append(cardTile(entry, resolved, index));
      else if (CARDS.length) grid.append(goneTile(entry, index));
    });
  }

  function renderAddList() {
    const held = new Set(settings.wallet.map((e) => e.id));
    clear(addSelect);
    const available = CARDS.filter((c) => !held.has(c.id))
      // Short names, sorted within each bank (asked live: "where are the
      // amex gold and platinum?" when the full names sorted them last).
      .sort((a, b) => a.issuer.localeCompare(b.issuer) || shortName(a).localeCompare(shortName(b)));
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
      groupNode.append(el("option", { value: c.id, text: shortName(c), title: c.name }));
    }
    addSelect.value = "";
    addButton.disabled = true;
  }

  // ---------- one card ----------

  function cardFaceNode(c) {
    const face = cardFace(c);
    return el("div", {
      class: `card-face${LIGHT_FACES.has(face) ? " is-light" : ""}`,
      "data-face": face,
      role: "img",
      "aria-label": `${shortName(c)}, ${NETWORKS[c.network] || ""}`,
    },
    el("div", { class: "card-face-top" },
      el("span", { class: "card-face-issuer", text: c.custom ? "Your card" : c.issuer }),
      el("span", { class: "card-face-points", text: groupName(c.points) })),
    el("div", { class: "card-face-chip", "aria-hidden": "true" }),
    el("div", { class: "card-face-bottom" },
      el("span", { class: "card-face-name", text: shortName(c), title: c.name }),
      el("span", { class: `card-face-network is-${c.network}`, text: NETWORK_MARK[c.network] || "" })));
  }

  function feeFacts(c) {
    const { fee, change } = feeInfo(c, localToday());
    const facts = [fact("Annual fee", fee ? `${money(fee)} a year` : "No annual fee")];
    if (change) {
      const when = change.upcoming ? `from ${dateLabel(change.from)}` : `since ${dateLabel(change.from)}`;
      facts.push(el("div", { class: "mycard-fee-change" },
        pill(change.diff >= 0 ? `Going up to ${money(change.fee)}` : `Going down to ${money(change.fee)}`, "caution"),
        el("span", { class: "hint", text: change.detail || when })));
    }
    facts.push(fact("Foreign currency", c.fxFee ? `${pct(c.fxFee * 100)} fee` : "No foreign transaction fee"));
    const moves = settings.preferred && c.points !== settings.preferred && transferRatio(c.points, settings.preferred) > 0;
    const unit = groupUnit(c.points);
    facts.push(fact("Earns", unit === "percent"
      ? "Cash back"
      : `${groupName(c.points)}, ${centsPerPoint(c.points, settings.values)}¢ each` +
        (moves ? `, counted as ${groupName(settings.preferred)}` : "")));
    return facts;
  }

  function fact(label, value) {
    return el("div", { class: "mycard-fact" },
      el("span", { class: "mycard-fact-label", text: label }),
      el("span", { class: "mycard-fact-value", text: value }));
  }

  function rewardList(c) {
    const cash = groupUnit(c.points) === "percent";
    return el("div", { class: "mycard-earn" },
      earnLines(c, settings.values).map((line) => el("div", { class: "mycard-earn-row" },
        el("div", { class: "mycard-earn-rate" },
          el("span", { text: cash ? pct(line.back) : line.rate }),
          cash ? "" : el("span", { class: "hint", text: `${pct(line.back)} back` })),
        el("div", { class: "mycard-earn-what" },
          el("div", { text: line.what }),
          line.conditions.map((t) => el("div", { class: "hint", text: t }))))));
  }

  function setup(entry, resolved) {
    const extras = [];
    if (resolved.picks) {
      const chosen = new Set(entry.picks || []);
      const boxes = el("div", { class: "reward-picks" });
      const paintBoxes = () => {
        for (const box of boxes.querySelectorAll("input")) {
          box.disabled = !box.checked && chosen.size >= resolved.picks.count;
        }
      };
      for (const id of resolved.picks.from) {
        boxes.append(checkbox(PURCHASES.find((p) => p.id === id)?.label || id, chosen.has(id), (on) => {
          if (on) chosen.add(id); else chosen.delete(id);
          entry.picks = resolved.picks.from.filter((p) => chosen.has(p));
          store.save();
          paintBoxes();
          renderAll();
        }));
      }
      paintBoxes();
      extras.push(el("div", { class: "field-label", text: resolved.picks.label }), boxes);
    }
    for (const flag of resolved.flags || []) {
      extras.push(checkbox(flag.label, entry.flags?.[flag.id], (on) => {
        entry.flags = { ...(entry.flags || {}), [flag.id]: on };
        store.save();
        renderAll();
      }));
    }
    return extras.length ? el("div", { class: "mycard-setup" }, sectionLabel("Set up"), extras) : "";
  }

  function sectionLabel(text) {
    return el("div", { class: "mycard-section-label", text });
  }

  function cardTile(entry, resolved, index) {
    const notes = resolved.notes || [];
    return el("section", { class: "card mycard" },
      cardFaceNode(resolved),
      el("div", { class: "mycard-head" },
        el("div", { class: "reward-name" },
          el("span", { class: "reward-title", text: resolved.name, title: resolved.name }),
          resolved.custom ? pill("Yours", "muted") : null),
        el("div", { class: "mycard-actions" },
          resolved.custom ? button("Edit", { small: true, onClick: () => editCustom(entry) }) : null,
          button("Remove", { small: true, onClick: () => remove(resolved.name, index) }))),
      el("div", { class: "mycard-facts" }, feeFacts(resolved)),
      sectionLabel("Rewards"),
      rewardList(resolved),
      setup(entry, resolved),
      notes.length
        ? el("details", { class: "mycard-notes" },
          el("summary", { text: `Notes (${notes.length})` }),
          notes.map((n) => hint(n)))
        : "",
      hint(resolved.checked ? `Checked ${dateLabel(resolved.checked)} against ${resolved.source}.` : `${resolved.source}.`));
  }

  // A card dropped from the downloaded list (discontinued, usually). Kept
  // in the wallet so it comes back if the list gets it again.
  function goneTile(entry, index) {
    return el("section", { class: "card mycard" },
      el("div", { class: "mycard-head" },
        el("div", { class: "reward-name" }, el("span", { class: "reward-title", text: entry.id })),
        el("div", { class: "mycard-actions" }, button("Remove", { small: true, onClick: () => remove(entry.id, index) }))),
      hint("No longer in the card list, so it is left out of Which card to use."));
  }

  async function remove(name, index) {
    if (!(await confirmDialog("Remove card", `Remove ${name} from your cards?`, { confirmText: "Remove" }))) return;
    settings.wallet.splice(index, 1);
    store.save();
    renderAll();
  }

  // ---------- points ----------

  function ratioLabel(ratio) {
    return ratio === 1 ? "1 to 1" : `1 to ${ratio}`;
  }

  function renderPreferred(cards) {
    clear(preferredSelect);
    preferredSelect.append(el("option", { value: "", text: "No preference" }));
    const held = [...new Set(cards.map((c) => c.points))].filter((p) => POINT_TYPES[p]);
    const rest = Object.keys(POINT_TYPES).filter((p) => !held.includes(p));
    for (const points of [...held, ...rest]) {
      preferredSelect.append(el("option", { value: points, text: groupName(points) }));
    }
    if (settings.preferred && !POINT_TYPES[settings.preferred] && CARDS.length) settings.preferred = "";
    preferredSelect.value = settings.preferred || "";
    const preferred = settings.preferred;
    if (!preferred) {
      preferredHint.textContent = "Pick the points you collect. Cards whose points " +
        "can be moved into them are counted as them, at the transfer rate and their value.";
      return;
    }
    const moved = cards.filter((c) => c.points !== preferred && transferRatio(c.points, preferred) > 0);
    const name = groupName(preferred);
    preferredHint.textContent = moved.length
      ? moved.map((c) => `${shortName(c)} earns ${groupName(c.points)}, counted as ${name} ` +
        `(${ratioLabel(transferRatio(c.points, preferred))}).`).join(" ") + ` On a tie, the ${name} card wins.`
      : `None of your other cards' points move to ${name}, so this only breaks ties in its favour.`;
  }

  async function editValues() {
    const held = [...new Set(walletCards(settings.wallet).map((c) => c.points))]
      .filter((points) => groupUnit(points) !== "percent");
    const others = Object.keys(POINT_TYPES)
      .filter((points) => !held.includes(points) && groupUnit(points) !== "percent");
    const result = await customDialog("Point values", (body) => {
      body.append(hint("What one point is worth to you, in cents. Leave a box " +
        "blank for the cautious value: the low end of published estimates " +
        "for a normal redemption, such as Aeroplan on an economy flight. " +
        "Business-class flights can be worth about twice as much; gift cards " +
        "and merchandise less. Cash back is always worth what it says."));
      const inputs = {};
      const list = el("div", { class: "reward-values" });
      const addRow = (points) => {
        const typical = centsPerPoint(points, {});
        const input = textInput(settings.values[points] ?? "", { type: "number", placeholder: `${typical}` });
        input.min = "0";
        input.step = "0.01";
        input.setAttribute("inputmode", "decimal");
        inputs[points] = input;
        list.append(el("label", { class: "reward-value-row" },
          el("span", { class: "reward-value-name" },
            el("span", { text: groupName(points) }),
            el("span", {
              class: "hint",
              text: settings.preferred && points !== settings.preferred && transferRatio(points, settings.preferred) > 0
                ? `Counted as ${groupName(settings.preferred)} while that is preferred`
                : `Cautious value ${typical}¢`,
            })),
          el("span", { class: "reward-value-input" }, input, el("span", { class: "hint", text: "¢" }))));
      };
      held.forEach(addRow);
      if (others.length) {
        list.append(el("div", { class: "field-label reward-values-more", text: "Other kinds of points" }));
        others.forEach(addRow);
      }
      body.append(list);
      return {
        value: () => Object.fromEntries(Object.entries(inputs)
          .filter(([, input]) => input.value !== "" && Number(input.value) >= 0)
          .map(([points, input]) => [points, Number(input.value)])),
      };
    }, { confirmText: "Save" });
    if (!result) return;
    settings.values = result;
    store.save();
    renderAll();
  }

  // ---------- a card typed in by hand ----------

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
      const fee = textInput(draft.annualFee ?? "", { type: "number", placeholder: "0" });
      fee.min = "0";
      fee.step = "0.01";
      const face = select(FACES.map((value) => ({ value, label: FACE_LABELS[value] || value })),
        FACES.includes(draft.face) ? draft.face : "charcoal", () => {});
      let fx = draft.fxFee === undefined ? true : draft.fxFee > 0;
      const error = el("p", { class: "hint is-error" });

      const rates = {};
      const rateGrid = el("div", { class: "card-grid reward-rate-grid" });
      for (const p of PURCHASES.filter((x) => x.id !== "other")) {
        const input = textInput(draft.rates?.[p.id] ?? "", { type: "number", placeholder: "Same as base" });
        input.min = "0";
        input.step = "0.01";
        rates[p.id] = input;
        rateGrid.append(field(p.label, input));
      }

      body.append(
        el("div", { class: "card-grid" },
          field("Card name", name),
          field("Network", network),
          field("Points it earns", points),
          pointsField,
          field("Everything else earns", base),
          field("Annual fee", fee),
          field("Colour", face)),
        checkbox("Charges a foreign transaction fee", fx, (on) => { fx = on; }),
        sectionTitle("Better rates"),
        hint("Points per $1, or the percent for cash back. Leave a box blank " +
          "if it earns the same as everything else."),
        rateGrid,
        error);

      return {
        validate: () => {
          if (!name.value.trim()) error.textContent = "Give the card a name.";
          else if (!(Number(base.value) > 0)) error.textContent = "Everything else needs a rate above 0.";
          else if (points.value === "other" && !pointsName.value.trim()) error.textContent = "Name the points it earns.";
          else if (fee.value !== "" && !(Number(fee.value) >= 0)) error.textContent = "The annual fee needs to be a number.";
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
          annualFee: Number(fee.value) || 0,
          face: face.value,
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
    renderAll();
  }

  renderAll();
  refreshCatalogue();
  return root;
}
