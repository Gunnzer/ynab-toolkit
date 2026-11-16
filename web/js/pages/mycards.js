// My cards (at explicit user request: "a my card page where you can add and
// setup your cards and you'll see an image of the card with details like
// fee, upcoming fee increase, rewards per group or type... Remove the card
// add from the other page, they should all be based on this new page").
// The one place cards are added, set up and removed; Best card, Welcome
// bonuses and the Tier list all read the same cardRewards.wallet.

import {
  CARDS, CATALOGUE_CHECKED, CATALOGUE_UPDATED, NETWORKS, OFFERS, POINT_TYPES, PURCHASES, TIERS,
} from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue, useSavedCatalogue } from "../tools/card_feed.js";
import {
  asPreferred, centsPerPoint, daysSince, groupName, groupUnit, offersFor, pickLabel, purchaseLabel, shortName,
  transferRatio, walletCards,
} from "../tools/card_rewards.js";
import { cardEarnings, spendItems } from "../tools/card_spending.js";
import { readyToAssignCategoryIds } from "../tools/rta_tracker.js";
import {
  FACES, LIGHT_FACES, OPEN_OFFER_KEY, cardFace, earnLines, feeInfo, perkGroups, walletFees,
} from "../tools/my_cards.js";
import {
  button, card, checkbox, clear, confirmDialog, customDialog, dateLabel, el, field, hint,
  icon, pageHeading, pill, sectionTitle, select, textInput, todayIso,
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
  const addButton = button("Add", {
    accent: true,
    onClick: () => {
      if (!addSelect.value) return;
      settings.wallet.push({ id: addSelect.value });
      store.save();
      renderAll();
    },
  });
  addSelect.addEventListener("change", () => { addButton.disabled = !addSelect.value; });
  const feedStatus = el("span", { class: "hint" });
  // A small refresh icon (at explicit user request: the text button that
  // read "Up to date" afterwards was "not great"): it spins while checking
  // and shows a tick for a moment when done; the date beside it is the news.
  const updateButton = el("button", {
    type: "button",
    class: "mycards-refresh",
    title: "Check for updates",
    "aria-label": "Check for updates",
    onClick: () => refreshCatalogue(true),
  }, icon("refresh", { size: 16 }));
  // Compact (at explicit user request): the picker and Add on one line, the
  // rest as small links under it, no title or help text.
  const addCard = el("div", { class: "card mycards-add" },
    el("div", { class: "mycards-add-row" }, addSelect, addButton),
    el("div", { class: "mycards-add-more" },
      el("button", { type: "button", class: "reward-quiet", text: "Add one by hand", onClick: () => editCustom(null) }),
      el("span", { class: "mycards-feed" }, feedStatus, updateButton)));

  // Offers and events, near the top and short (at explicit user request:
  // "move the offers and events to the my cards page near the top. Keep the
  // text short"): one line each, the details fold away.
  const offersHost = el("div");
  // Which offers are unfolded, kept across redraws (the page redraws once
  // the card details load).
  const openOffers = new Set();
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
  // What your points are worth (at explicit user request: "points value
  // calculator would be a good tool").
  const balancesHost = el("div", { class: "mycards-balances" });
  // One compact row (at explicit user request): the picker, then Point values.
  const pointsCard = el("div", { class: "card mycards-points" },
    el("div", { class: "mycards-points-row" },
      el("label", { class: "mycards-points-label", text: "Preferred points" }),
      preferredSelect,
      el("button", { type: "button", class: "reward-quiet", text: "Point values", onClick: () => editValues() })),
    preferredHint,
    balancesHost);

  // Add a card always stays at the top, above your cards (reported live:
  // "the add card moves to the bottom when it shouldn't").
  root.append(addCard, offersHost, summary, grid, pointsCard);

  let feed = null;

  async function refreshCatalogue(force = false) {
    // The status line stays put while checking (reported live: pressing
    // Check for updates "blinks some text"); it only says something while
    // there is nothing saved to show yet.
    updateButton.disabled = true;
    updateButton.classList.toggle("is-busy", force);
    if (!CATALOGUE_CHECKED) feedStatus.textContent = "Getting the latest card details...";
    const snapshot = () => JSON.stringify([CATALOGUE_UPDATED, CARDS, OFFERS, TIERS]);
    const before = snapshot();
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    feed = await loadCatalogue({ fetchJson: browserFetchJson, storage, force });
    updateButton.disabled = false;
    updateButton.classList.remove("is-busy");
    paintFeed();
    renderAll();
    if (force && feed.ok && feed.source === "downloaded") {
      const said = snapshot() !== before ? "Updated just now" : "Up to date";
      updateButton.replaceChildren(icon("done", { size: 16 }));
      updateButton.classList.add("is-done");
      updateButton.setAttribute("aria-label", said);
      updateButton.title = said;
      clearTimeout(updateButton.resetTimer);
      updateButton.resetTimer = setTimeout(() => {
        updateButton.replaceChildren(icon("refresh", { size: 16 }));
        updateButton.classList.remove("is-done");
        updateButton.setAttribute("aria-label", "Check for updates");
        updateButton.title = "Check for updates";
      }, 1500);
    }
  }

  function paintFeed() {
    if (!feed) return;
    feedStatus.classList.toggle("is-error", !feed.ok || feed.source === "saved-fallback");
    if (!feed.ok) {
      feedStatus.textContent = `${feed.error} Check your connection and try again.`;
      return;
    }
    // Short, so it shares a line with the links on a phone; the long form
    // is only for when something is wrong.
    // When anything last changed (offers are checked daily); the full check
    // of every card's rates is the older date, in the tooltip.
    const age = daysSince(CATALOGUE_CHECKED, todayIso());
    const [y, m, d] = String(CATALOGUE_UPDATED).split("-").map(Number);
    const parts = [`Updated ${new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` +
      (age !== null && age > 45 ? ` (rates checked ${age} days ago, so may be out of date)` : "")];
    if (feed.source === "saved-fallback") parts.push(`${feed.error} Using the copy saved on this device.`);
    feedStatus.textContent = parts.join(". ");
    feedStatus.title = `Offers and events are checked daily. Every card's rates and fees were last checked ${dateLabel(CATALOGUE_CHECKED)}.`;
  }

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const money = (n) => `$${Number(n).toLocaleString("en-CA", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const pct = (n) => `${Number(n.toFixed(2))}%`;

  function renderAll() {
    const cards = walletCards(settings.wallet);
    pointsCard.hidden = !settings.wallet.length;
    renderOffers(cards);
    renderSummary(cards);
    renderGrid(cards);
    renderAddList();
    renderPreferred(cards);
    renderBalances(cards);
  }

  // ---------- what each card really earned ----------
  // At explicit user request (2026-11-16, "is each card worth its fee?"):
  // a card linked to its YNAB account shows the last 12 months of its own
  // spending valued at its rates and your point values, against its fee.
  const state = app.state;
  let spending = null;
  const connected = () => Boolean(state.token && state.budgetId && state.hasBudgetData);
  const cardAccounts = () => (state.accounts || [])
    .filter((a) => !a.deleted && !a.closed && (a.type === "creditCard" || a.type === "lineOfCredit"));

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function loadSpending() {
    const linked = new Set(settings.wallet.map((e) => e.accountId).filter(Boolean));
    if (!connected() || !linked.size) return;
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    const since = isoDate(start);
    try {
      const { list } = await state.transactions(since);
      const names = new Map(state.flatCategories(true).map((i) => [i.category.id, i.category.name]));
      const items = spendItems(list, {
        accountIds: linked, since, until: localToday(),
        categoryName: (id) => names.get(id) || "",
        exclude: readyToAssignCategoryIds(state.categoryGroups),
      });
      const byAccount = new Map();
      for (const item of items) {
        if (!byAccount.has(item.accountId)) byAccount.set(item.accountId, []);
        byAccount.get(item.accountId).push(item);
      }
      spending = { byAccount };
    } catch {
      // Offline or signed out: the tiles just say to link or try later.
      spending = null;
    }
    renderAll();
  }

  function earningsFor(entry, resolved) {
    if (!entry.accountId || !spending) return null;
    return cardEarnings(resolved, spending.byAccount.get(entry.accountId) || [],
      { values: settings.values, preferred: settings.preferred });
  }

  const dollars = (n) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString("en-CA")}`;

  function yearBlock(entry, resolved) {
    const accounts = cardAccounts();
    if (!connected() || !accounts.length) return "";
    const link = el("select", { "aria-label": `YNAB account for ${resolved.name}` },
      el("option", { value: "", text: "Not linked" }),
      accounts.map((a) => el("option", { value: a.id, text: a.name })));
    link.value = accounts.some((a) => a.id === entry.accountId) ? entry.accountId : "";
    link.addEventListener("change", () => {
      if (link.value) entry.accountId = link.value;
      else delete entry.accountId;
      store.save();
      spending = null;
      renderAll();
      loadSpending();
    });
    const parts = [el("label", { class: "mycard-link" },
      el("span", { class: "mycard-fact-label", text: "YNAB account" }), link)];
    const result = earningsFor(entry, resolved);
    if (!entry.accountId) {
      parts.push(hint("Link the card's account to see what it earned in the last 12 months against its fee."));
    } else if (!result) {
      parts.push(hint("Adding up the last 12 months..."));
    } else if (result.spend <= 0) {
      parts.push(hint("No spending on this account in the last 12 months."));
    } else {
      const verdict = !result.fee
        ? pill("No annual fee", "muted")
        : result.net >= 0
          ? pill(`Worth it: ${dollars(result.net)} ahead`, "ok")
          : pill(`Costs ${dollars(-result.net)} more than it earns`, "warn");
      parts.push(el("div", { class: "mycard-year-verdict" }, verdict),
        el("p", {
          class: "mycard-year-line",
          text: `${dollars(result.spend)} spent, about ${dollars(result.earned)} back (${pct(result.back)})` +
            (result.fee ? `, against a ${dollars(result.fee)} fee.` : "."),
        }),
        el("details", { class: "mycard-notes" },
          el("summary", { text: "Where it earned" }),
          el("ul", {}, result.byPurchase.slice(0, 8).map((r) => el("li", {
            text: `${purchaseLabel(r.purchase)}: ${dollars(r.spend)} spent, ${dollars(r.earned)} back`,
          }))),
          result.capsHit.length ? hint(`Went past its cap on ${result.capsHit.join(", ")} at least once.`) : "",
          hint("An estimate at your point values: shops are sorted by name and YNAB category. " +
            "Sign-up bonuses, credits and statement offers are not counted.")));
    }
    return el("div", { class: "mycard-year" }, sectionLabel("Last 12 months"), parts);
  }

  // ---------- what your points are worth ----------
  function renderBalances(cards) {
    clear(balancesHost);
    if (!settings.balances || typeof settings.balances !== "object") settings.balances = {};
    const isPoints = (p) => POINT_TYPES[p] && groupUnit(p) !== "percent";
    const held = [...new Set(cards.map((c) => c.points))].filter(isPoints);
    const types = [...new Set([...held, ...Object.keys(settings.balances).filter(isPoints)])];
    const totalNode = el("strong");
    const worth = (points) => (Number(settings.balances[points]) || 0) * centsPerPoint(points, settings.values) / 100;
    const cash = (n) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const paintTotal = () => { totalNode.textContent = cash(types.reduce((n, p) => n + worth(p), 0)); };
    const list = el("div", { class: "mycards-balance-list" });
    for (const points of types) {
      const input = textInput(settings.balances[points] ?? "", { type: "number", placeholder: "0" });
      input.min = "0";
      input.step = "1";
      input.setAttribute("inputmode", "numeric");
      input.setAttribute("enterkeyhint", "done");
      input.setAttribute("aria-label", `${groupName(points)} balance`);
      const out = el("span", { class: "mycards-balance-worth" });
      const paint = () => {
        const n = Number(settings.balances[points]) || 0;
        const ratio = settings.preferred && points !== settings.preferred ? transferRatio(points, settings.preferred) : 0;
        out.textContent = `${cash(worth(points))} at ${centsPerPoint(points, settings.values)}¢` +
          (ratio && n ? `, or ${Math.round(n * ratio).toLocaleString("en-CA")} ${groupName(settings.preferred)} ` +
            `worth ${cash(n * ratio * centsPerPoint(settings.preferred, settings.values) / 100)}` : "");
      };
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (input.value.trim() === "" || !(n >= 0)) delete settings.balances[points];
        else settings.balances[points] = n;
        store.save();
        paint();
        paintTotal();
      });
      paint();
      list.append(el("label", { class: "mycards-balance-row" },
        el("span", { class: "mycards-balance-name", text: groupName(points) }), input, out));
    }
    const others = Object.keys(POINT_TYPES).filter((p) => isPoints(p) && !types.includes(p));
    const addSelect = el("select", { "aria-label": "Add another kind of points" },
      el("option", { value: "", text: "Add other points..." }),
      others.map((p) => el("option", { value: p, text: groupName(p) })));
    addSelect.addEventListener("change", () => {
      if (!addSelect.value) return;
      settings.balances[addSelect.value] = settings.balances[addSelect.value] ?? 0;
      store.save();
      renderBalances(walletCards(settings.wallet));
    });
    paintTotal();
    balancesHost.append(
      el("div", { class: "mycards-points-label", text: "What your points are worth" }),
      list,
      el("div", { class: "mycards-balance-foot" },
        el("span", { class: "hint" }, "About ", totalNode, " in all, at your point values."),
        others.length ? addSelect : ""));
  }

  function shortDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  }

  function renderOffers(cards) {
    clear(offersHost);
    const held = asPreferred(cards, settings.preferred);
    const offers = offersFor(OFFERS, held, localToday());
    if (!offers.length) return;
    const names = Object.fromEntries(held.map((c) => [c.id, shortName(c)]));
    offersHost.append(el("div", { class: "card mycards-offers" },
      sectionTitle("Offers and events"),
      offers.map(({ offer, status, cardIds }) => el("details", {
        class: "reward-offer mycards-offer",
        id: `reward-offer-${offer.id}`,
        open: openOffers.has(offer.id),
        onToggle: (event) => {
          if (event.target.open) openOffers.add(offer.id); else openOffers.delete(offer.id);
        },
      },
      el("summary", {},
        el("span", { class: "reward-offer-title", text: offer.title }),
        pill(status === "now" ? `Until ${shortDate(offer.ends)}` : `Starts ${shortDate(offer.starts)}`,
          status === "now" ? "ok" : "info")),
      offer.detail ? el("p", { class: "reward-offer-detail", text: offer.detail }) : "",
      el("p", {
        class: "hint",
        text: [
          cardIds.length ? `For your ${cardIds.map((id) => names[id]).join(", ")}` : "",
          offer.shops?.length ? `At ${offer.shops.join(", ")}` : "",
          `Source: ${offer.source}`,
        ].filter(Boolean).join(". ") + ".",
      })))));
    openRequestedOffer();
  }

  // Arrived from an "Offer" tag on Which card to use: open that one.
  function openRequestedOffer() {
    let id = null;
    try { id = sessionStorage.getItem(OPEN_OFFER_KEY); } catch { return; }
    const target = id && offersHost.querySelector(`[id="reward-offer-${CSS.escape(id)}"]`);
    if (!target) return;
    try { sessionStorage.removeItem(OPEN_OFFER_KEY); } catch { /* opened once anyway */ }
    openOffers.add(id);
    target.open = true;
    // Looked up again after a frame: the page may have redrawn by then.
    setTimeout(() => {
      const shown = offersHost.querySelector(`[id="reward-offer-${CSS.escape(id)}"]`);
      if (!shown) return;
      shown.scrollIntoView({ behavior: "smooth", block: "center" });
      shown.classList.add("is-flash");
    }, 300);
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
    const linked = settings.wallet.map((entry) => {
      const resolved = cards.find((c) => c.id === entry.id);
      return resolved ? earningsFor(entry, resolved) : null;
    }).filter((r) => r && r.spend > 0);
    if (linked.length) {
      const earned = linked.reduce((n, r) => n + r.earned, 0);
      const linkedFees = linked.reduce((n, r) => n + r.fee, 0);
      lines.push(`Last 12 months, ${linked.length === cards.length ? "your cards" : `${linked.length} linked card${linked.length === 1 ? "" : "s"}`} ` +
        `earned about ${dollars(earned)} against ${dollars(linkedFees)} in fees: ${dollars(earned - linkedFees)} ${earned >= linkedFees ? "ahead" : "behind"}.`);
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
        boxes.append(checkbox(pickLabel(resolved, id), chosen.has(id), (on) => {
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
      yearBlock(entry, resolved),
      sectionLabel("Rewards"),
      rewardList(resolved),
      setup(entry, resolved),
      perksList(resolved),
      notes.length
        ? el("details", { class: "mycard-notes" },
          el("summary", { text: `Notes (${notes.length})` }),
          notes.map((n) => hint(n)))
        : "",
      hint(resolved.checked ? `Checked ${dateLabel(resolved.checked)} against ${resolved.source}.` : `${resolved.source}.`));
  }

  // Every perk, folded away like Notes (at explicit user request: "a full
  // list of perks somewhere with either a collapse like notes or a pop up").
  function perksList(c) {
    const groups = perkGroups(c);
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    if (!count) return "";
    return el("details", { class: "mycard-notes mycard-perks" },
      el("summary", { text: `Perks (${count})` }),
      groups.map((g) => el("div", { class: "mycard-perk-group" },
        el("div", { class: "mycard-perk-label", text: g.label }),
        el("ul", {}, g.items.map((t) => el("li", { text: t }))))),
      groups.some((g) => g.kind === "insurance")
        ? hint("Insurance has conditions, limits and age rules, and travel cover usually needs the trip charged to the card. Check the card's insurance certificate before relying on it.")
        : "");
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
    preferredHint.hidden = !preferred;
    if (!preferred) {
      preferredHint.textContent = "";
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

  // The saved copy at once, then the latest whenever the page opens (at
  // most every FEED_MAX_AGE_MS, so hopping between the card tabs is free).
  try { useSavedCatalogue(window.localStorage); } catch { /* no storage */ }
  renderAll();
  refreshCatalogue().then(loadSpending);
  return root;
}
