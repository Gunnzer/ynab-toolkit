// Card Rewards: pick what you are buying and see which of your cards earns
// the most for it, as a percent back, best first. Asks follow-up
// questions (which store, does it take Amex, is a cap used up) until it is
// at least 90% sure. Standalone: reads nothing from YNAB. The card details
// are checked for on this site each time the page opens (tools/card_feed.js).

import { CARDS, CATALOGUE_CHECKED, OFFERS, PURCHASES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue } from "../tools/card_feed.js";
import { merchantByName, normalise, searchMerchants } from "../tools/merchants.js";
import {
  TARGET_CONFIDENCE, UNSURE, centsPerPoint, explain,
  formatEarned, formatRate, formatValue, formatWorth, groupName, groupUnit,
  asPreferred, capAnswerUntil, offerAtShop, offersFor, purchaseLabel, recommend, savedCapAnswers, shortName,
  walletCards,
} from "../tools/card_rewards.js";
import {
  button, card, clear, confirmDialog, customDialog, el, field, hint, icon,
  pageHeading, pill, sectionTitle, select, textInput,
} from "../ui.js";

export function cardRewardsPage(app) {
  const store = app.state.store;
  const settings = store.section("cardRewards");
  if (!Array.isArray(settings.wallet)) settings.wallet = [];
  // Every visit starts with no category chosen (at explicit user request),
  // like the shop and the answers: today's purchase is a new one.
  settings.purchase = "";
  store.save();
  if (!settings.values || typeof settings.values !== "object") settings.values = {};
  if (typeof settings.preferred !== "string") settings.preferred = "";
  // Cap answers ("past your $25,000 this year?") are about the card, not the
  // purchase, so they are kept until the cap's month or year ends (at
  // explicit user request) instead of being asked every visit.
  if (!settings.capAnswers || typeof settings.capAnswers !== "object") settings.capAnswers = {};
  for (const [id, entry] of Object.entries(settings.capAnswers)) {
    if (!(entry?.until >= localToday())) delete settings.capAnswers[id];
  }
  // What you answer at a shop (takes Amex, which currency...) is about the
  // shop, not this one purchase, so it is remembered per shop and filled in
  // the next time that shop is picked (at explicit user request: "once I
  // enter it one time it should save"):
  // { "<normalised name>": { answers: { <question id>: <option id> }, on, name?, purchase? } }.
  // A shop added with the Add button (never by just typing, at explicit user
  // request, so nothing is added by accident) also keeps its name and
  // purchase, so search can offer it.
  if (!settings.shops || typeof settings.shops !== "object") settings.shops = {};
  // Saved before every answer was kept: only whether it took Amex.
  for (const [key, entry] of Object.entries(settings.shopAmex || {})) {
    if (!settings.shops[key]) {
      const { value, ...rest } = entry || {};
      settings.shops[key] = { ...rest, answers: value ? { amex: value } : {} };
    }
  }
  delete settings.shopAmex;
  const shopKey = (m) => normalise(m.name);
  const savedFor = (m) => (m ? settings.shops[shopKey(m)]?.answers || {} : {});
  const typedShops = () => Object.values(settings.shops)
    .filter((entry) => entry?.name && PURCHASES.some((p) => p.id === entry.purchase))
    .map((entry) => typedShop(entry.name, entry.purchase));
  // A shop you add is a Canadian one like the list's (bookings aside), so
  // it charges Canadian dollars.
  const typedShop = (name, purchase) =>
    ({ name, purchase, answers: purchase === "travel" ? {} : { currency: "cad" }, typed: true });

  // Answers belong to one purchase, so they are not saved: tomorrow's
  // groceries may be at a different store.
  // Answers for this purchase only. Saved cap answers are added on top in
  // allAnswers(); an answer given here wins.
  let answers = {};
  let last = null;
  // The shop picked from the search, if any. Page state like the answers.
  let shop = null;
  // "Answer it" pressed on the optional question shown once sure enough.
  let showOptional = false;
  // Whether the folded "Answers (n)" list is open, for this visit.
  let answersOpen = false;

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Which card to use",
    "Search for the shop (or pick what you are buying) and see which of your " +
    "cards gives you the most back for it. Points are turned into money " +
    "at a cautious value per point (the low end of published estimates, " +
    "such as Aeroplan on an economy flight), which you can change under " +
    "Point values on My cards, so every card is compared as a percent back, best first. " +
    "Where the answer depends on something it does not know yet (which " +
    "store, whether a cap is used up), it asks, until it is at least 90% " +
    "sure. Your cards are set up on My cards. Card details are re-checked twice a week, and this page fetches " +
    "the latest each time it opens, like exchange rates. Nothing here reads or changes your " +
    "budget."));

  const purchaseSelect = select(
    [{ value: "", label: "Choose one..." }, ...PURCHASES.map((p) => ({ value: p.id, label: p.label }))],
    settings.purchase,
    (value) => {
      settings.purchase = value;
      store.save();
      answers = {};
      // Picking a category by hand means it is not about that shop any more.
      setShop(null);
      render();
    });

  // ---------- shop search ----------

  // The placeholder can be picked to start with, never chosen again.
  purchaseSelect.options[0].disabled = true;
  purchaseSelect.setAttribute("aria-label", "Category");
  // Some phone browsers put a field's last value back on refresh (reported
  // live: still on Gas after a refresh), so it is told not to, and set
  // again once the page is on screen and whenever it is shown again.
  purchaseSelect.setAttribute("autocomplete", "off");
  const keepCategory = () => {
    if (!purchaseSelect.isConnected || purchaseSelect.value === settings.purchase) return;
    purchaseSelect.value = settings.purchase;
    render();
  };
  requestAnimationFrame(keepCategory);
  window.addEventListener("pageshow", keepCategory);

  const shopInput = textInput("", { placeholder: "e.g. Costco, Esso, Dollarama, Netflix" });
  shopInput.setAttribute("autocomplete", "off");
  shopInput.setAttribute("enterkeyhint", "search");
  shopInput.setAttribute("aria-label", "Search shops");
  const shopClear = el("button", {
    type: "button",
    class: "reward-shop-clear",
    title: "Clear the shop",
    "aria-label": "Clear the shop",
    hidden: true,
    onClick: () => {
      setShop(null);
      answers = {};
      // The shop chose the category, so clearing it clears that too.
      settings.purchase = "";
      purchaseSelect.value = "";
      shopInput.focus();
      render();
    },
  }, icon("x", { size: 16 }));
  const shopList = el("div", { class: "reward-shop-list" });
  let found = [];

  shopInput.addEventListener("input", () => {
    if (shop && shopInput.value !== shop.name) shop = null;
    shopClear.hidden = !shopInput.value;
    paintShops();
  });
  shopInput.addEventListener("keydown", (event) => {
    // On a phone, Enter in a field outside a form acts as "Next" and jumps
    // to the next field on the page, which here is far down in Your cards
    // (reported live: Enter took you to the bottom). It always stays put:
    // the top match, or just closing the keyboard.
    if (event.key === "Enter") {
      event.preventDefault();
      if (found.length) pickShop(found[0]);
      else shopInput.blur();
    } else if (event.key === "Escape") {
      clear(shopList);
    }
  });

  function paintShops() {
    clear(shopList);
    found = shop ? [] : searchMerchants(shopInput.value, 6, typedShops());
    if (!shop && shopInput.value.trim() && !found.length) {
      const typed = shopInput.value.trim();
      shopList.append(el("div", { class: "reward-shop-missing" },
        hint("Not in the list: pick what you are buying below, or"),
        button(`Add "${typed}"`, { small: true, onClick: () => addShop(typed) })));
    }
    if (shop?.typed) {
      shopList.append(el("div", { class: "reward-shop-missing" },
        hint("One of your shops."),
        el("button", {
          type: "button",
          class: "btn btn-small btn-link",
          text: "Remove it",
          onClick: () => removeShop(shop),
        })));
    }
    for (const m of found) {
      shopList.append(el("button", {
        type: "button",
        class: "reward-shop",
        onClick: () => pickShop(m),
      }, el("span", { text: m.name }), el("span", { class: "hint", text: purchaseLabel(m.purchase) })));
    }
  }

  function setShop(m) {
    shop = m;
    shopInput.value = m ? m.name : "";
    shopClear.hidden = !m;
    found = [];
    paintShops();
  }

  // A shop sets the purchase and answers what it already settles (which
  // chain, which station), so those questions are never asked.
  function pickShop(m) {
    setShop(m);
    settings.purchase = m.purchase;
    purchaseSelect.value = m.purchase;
    store.save();
    answers = { ...m.answers, ...savedFor(m) };
    shopInput.blur();
    render();
  }

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
  // "Done", not "Next": see the Enter rule in main.js.
  amountInput.setAttribute("enterkeyhint", "done");

  // Compact (at explicit user request: "make the other inputs more compact").
  const pickCard = el("div", { class: "card reward-pick-card" },
    el("div", { class: "reward-shop-search" },
      el("label", { class: "field-label", text: "Shop" }),
      el("div", { class: "reward-shop-field" }, shopInput, shopClear),
      shopList),
    el("div", { class: "card-grid reward-pick" },
      field("Category", purchaseSelect),
      field("Amount", amountInput)));
  // The questions live with "Where are you shopping?" (at explicit user
  // request): they are about the shop, and the ranked list below already
  // shows the best card, so a separate "Best card" box only repeated it.
  const askHost = el("div", { class: "reward-ask" });
  pickCard.append(askHost);
  root.append(pickCard);

  const resultsHost = el("div", { class: "reward-groups" });
  // Cards are added and set up on My cards (at explicit user request:
  // "Remove the card add from the other page, they should all be based on
  // this new page"); this page only points there.
  const goToMyCards = () => { location.hash = "#/mycards"; };
  const noCards = card(
    sectionTitle("Add your cards first"),
    hint("Add the credit cards you carry on My cards, and the best one for each purchase shows up here."),
    el("div", { class: "card-row" }, button("Go to My cards", { accent: true, onClick: goToMyCards })));
  const walletNote = el("p", { class: "hint reward-wallet-note" });
  // Special events and offers from the card details, below the results
  // (at explicit user request), with an "Offer" tag on what they are about.
  const offersHost = el("div");
  let offers = [];
  root.append(resultsHost, offersHost, walletNote);

  let feed = null;

  async function refreshCatalogue(force = false) {
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    feed = await loadCatalogue({ fetchJson: browserFetchJson, storage, force });
    render();
  }

  function amount() {
    const value = Number(settings.amount);
    return value > 0 ? value : 0;
  }

  function render() {
    showOptional = false;
    purchaseSelect.classList.toggle("is-empty", !purchaseSelect.value);
    const cards = walletCards(settings.wallet);
    last = cards.length && settings.purchase ? recommend(cards, settings.purchase, allAnswers(), {
      // Always by value, in one list (at explicit user request, after a
      // raw-points view put a card worth 1% above one worth 3%: "super
      // confusing"). Points still show on every card, under the value.
      measure: "value",
      grouped: false,
      values: settings.values,
      preferred: settings.preferred,
    }) : null;
    paint();
  }

  // Redraw without working the ranking out again (an amount change only
  // changes the points shown, never the ranking).
  function paint() {
    // With no cards yet, adding some is the only useful thing to do.
    if (settings.wallet.length) noCards.remove();
    else root.insertBefore(noCards, pickCard);
    paintWalletNote();
    offers = offersFor(OFFERS, offerCards(), localToday());
    renderAsk();
    renderResults();
    renderOffers();
  }

  /** Your cards as offers see them, with or without a purchase picked. */
  function offerCards() {
    return last
      ? last.groups.flatMap((g) => g.cards.map((stat) => stat.card))
      : asPreferred(walletCards(settings.wallet), settings.preferred);
  }

  function renderOffers() {
    clear(offersHost);
    if (!settings.wallet.length) return;
    const names = Object.fromEntries(offerCards().map((c) => [c.id, shortName(c)]));
    offersHost.append(card(
      sectionTitle("Offers and events"),
      offers.length
        ? offers.map(({ offer, status, cardIds }) => el("div", {
          class: "reward-offer",
          id: `reward-offer-${offer.id}`,
        },
        el("div", { class: "reward-offer-head" },
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
        })))
        : hint("No special events or offers for your cards were found when card " +
          `details were last checked${CATALOGUE_CHECKED ? ` (${shortDate(CATALOGUE_CHECKED)})` : ""}. ` +
          "They are looked for every week along with the card details.")));
  }

  /** A small tag that jumps down to the offer it is about. */
  function offerTag(offer, text = "Offer") {
    return el("button", {
      type: "button",
      class: "reward-offer-tag",
      title: offer.title,
      text: `${text} \u2193`,
      onClick: () => {
        const target = document.getElementById(`reward-offer-${offer.id}`);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("is-flash");
        void target.offsetWidth;
        target.classList.add("is-flash");
      },
    });
  }

  function offerForCard(id) {
    return offers.find((o) => o.cardIds.includes(id))?.offer;
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

    body.push(el("div", { class: "reward-sure" },
      el("div", { class: "reward-sure-head" },
        pill(`${pct}% sure`, kind),
        el("span", { class: "hint", text: "of the top card" })),
      el("div", {
        class: `reward-meter is-${kind}`,
        role: "progressbar",
        "aria-label": "How sure",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(pct),
      }, el("span", { style: `width: ${pct}%` }))));

    const questionBlock = (q) => [
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
        }))];

    if (last.next) {
      body.push(...questionBlock(last.next));
    } else if (last.optional && showOptional) {
      body.push(...questionBlock(last.optional));
    } else if (last.optional) {
      // Sure enough to go with, but say what the rest of the doubt is
      // (reported live: "90% sure" with no reason looked like it did not
      // know the shop), and let it be answered anyway.
      body.push(el("div", { class: "reward-optional" },
        el("p", { class: "hint", text: `Sure enough to go with. Still open: ${last.optional.text}` }),
        el("button", {
          type: "button",
          class: "reward-quiet",
          text: "Answer it",
          onClick: () => {
            showOptional = true;
            renderAsk();
          },
        })));
    } else {
      body.push(hint(last.confidence >= 1 - 1e-9
        ? "Sure: nothing left to ask."
        : last.confidence >= TARGET_CONFIDENCE
          ? "Sure enough: no more questions."
          : !shop
            ? "Pick the shop to be surer: whether Amex is taken depends on the shop."
            : "Nothing left to ask would change this, so this is as sure as it gets."));
    }

    // Answers the shop filled in are not your answers, so they are not
    // chips you can clear. Which store or station is already in the shop's
    // name; currency and Amex are not, so those are shown as known (asked
    // live: "why is it not saying that Esso takes Amex and is in CAD?").
    const fromShop = ({ question }) =>
      shop && shop.answers[question.id] !== undefined && shop.answers[question.id] === answers[question.id];
    // With no shop picked, Amex is left open rather than asked (see
    // allAnswers()), so it is nobody's answer and gets no chip.
    const assumed = ({ question }) => question.id === "amex" && answers.amex === undefined;
    const yours = last.asked.filter((entry) => !fromShop(entry) && !assumed(entry));
    const known = last.asked.filter((entry) => fromShop(entry) && ["currency", "amex"].includes(entry.question.id));
    // Answers fold away behind one line (at explicit user request: "the
    // your answers section is getting long"), open only when asked for.
    const answerRows = [];
    if (known.length) {
      answerRows.push(el("div", { class: "reward-asked reward-known" },
        el("span", { class: "hint", text: `Known for ${shop.name}:` }),
        known.map(({ question, answer: text }) => el("span", {
          class: "reward-chip is-fixed",
          title: "Filled in from the shop.",
          text: question.id === "currency" ? `Charged in ${text}` : text,
        }))));
    }
    const savedUntil = (id) => (answers[id] === undefined ? settings.capAnswers[id]?.until : null);
    if (yours.length) {
      answerRows.push(el("div", { class: "reward-asked" },
        el("span", { class: "hint", text: "Your answers:" }),
        yours.map(({ question, answer: text }) => el("button", {
          type: "button",
          class: "reward-chip",
          title: `${question.text} Click to ask again.`,
          onClick: () => {
            delete answers[question.id];
            const savedShop = shop && settings.shops[shopKey(shop)];
            if (savedShop?.answers?.[question.id] !== undefined) {
              delete savedShop.answers[question.id];
              // A shop you added stays; a listed one with nothing left to
              // remember goes.
              if (!shop.typed && !Object.keys(savedShop.answers).length) delete settings.shops[shopKey(shop)];
              store.save();
            }
            if (settings.capAnswers[question.id]) {
              delete settings.capAnswers[question.id];
              store.save();
            }
            render();
          },
        }, el("span", {
          text: savedUntil(question.id)
            ? `${text}, until ${shortDate(savedUntil(question.id))}`
            : shop && savedFor(shop)[question.id] === answers[question.id]
              ? `${text}, saved for ${shop.name}`
              : text,
        }), icon("x", { size: 14 }))),
        button("Start over", {
          small: true,
          onClick: () => {
            // Back to what the shop itself settles, forgetting what was
            // saved for it (an added shop itself stays).
            const savedShop = shop && settings.shops[shopKey(shop)];
            if (savedShop) {
              if (shop.typed) savedShop.answers = {};
              else delete settings.shops[shopKey(shop)];
              store.save();
            }
            answers = shop ? { ...shop.answers } : {};
            render();
          },
        })));
    }
    if (answerRows.length) {
      const count = known.length + yours.length;
      const fold = el("details", { class: "reward-answers" },
        el("summary", { text: `Answers (${count})` }),
        ...answerRows);
      fold.open = answersOpen;
      fold.addEventListener("toggle", () => { answersOpen = fold.open; });
      body.push(fold);
    }

    askHost.append(...body);
  }

  function answer(id, value) {
    const question = last?.questions.find((q) => q.id === id);
    if (question?.cap) {
      // Remembered; the page answer is not needed on top of it.
      settings.capAnswers[id] = { value, until: capAnswerUntil(question.per, localToday()) };
      store.save();
      const { [id]: _, ...rest } = answers;
      answers = rest;
    } else {
      answers = { ...answers, [id]: value };
      if (shop && value !== UNSURE) {
        const entry = settings.shops[shopKey(shop)] || {};
        settings.shops[shopKey(shop)] = {
          ...entry,
          answers: { ...(entry.answers || {}), [id]: value },
          on: localToday(),
          ...(shop.typed ? { name: shop.name, purchase: shop.purchase } : {}),
        };
        store.save();
      }
    }
    render();
  }

  function allAnswers() {
    // Without a shop there is nobody to ask "does it take Amex?" about (at
    // explicit user request: "if I don't have a place listed don't ask"),
    // so it is left as not sure: never asked, still counted in how sure.
    const open = !shop && answers.amex === undefined ? { amex: UNSURE } : {};
    return { ...savedCapAnswers(settings.capAnswers, localToday()), ...open, ...answers };
  }

  /** Today as a local "YYYY-MM-DD" (toISOString would give the UTC date). */
  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** "2026-12-31" -> "Dec 31". */
  function shortDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  }

  function renderResults() {
    clear(resultsHost);
    if (!last) {
      resultsHost.append(card(hint(!CARDS.length && !feed
        ? "Getting the latest card details..."
        : !settings.wallet.length
          ? "Add the cards you carry on My cards, and the best one for each " +
            "purchase shows up here."
          : "Pick a shop or a category, and your cards show up here, best first.")));
      return;
    }
    const spend = amount();
    const what = purchaseLabel(settings.purchase).toLowerCase();
    const shopOffer = shop && offers.find(({ offer }) => offerAtShop(offer, shop.name))?.offer;
    for (const group of last.groups) {
      // Numbered best first; the top three are tinted gold, silver and
      // bronze (at explicit user request). A card not accepted here gets no
      // number, since it is not an option at all.
      let rank = 0;
      resultsHost.append(el("section", { class: "card reward-group" },
        el("div", { class: "reward-group-head" },
          el("h3", { class: "section-title", text: shop ? `Your cards at ${shop.name}` : `Your cards for ${what}` }),
          shopOffer ? offerTag(shopOffer, "Offer here") : "",
          el("span", { class: "hint", text: "Best first, by what you get back, using cautious point values" })),
        group.cards.some((stat) => stat.accepted)
          ? ""
          : el("p", { class: "reward-answer-none", text: "None of your cards are accepted here." }),
        group.cards.map((stat) => resultRow(stat, stat.accepted ? ++rank : 0, spend))));
    }
  }

  /** What a card gives back, as a percent of the purchase: "10%". */
  function bigNumber(stat) {
    return formatValue(stat.card.points, stat.rate, settings.values);
  }

  // The ranked number with a word under it, because "10%" alone did not
  // say what it was a percent of (reported live): by value it is what
  // comes back per dollar spent, like a cash back rate.
  function rateCell(stat) {
    if (!stat.accepted) return el("div", { class: "reward-rate" }, el("span", { text: "-" }));
    return el("div", { class: "reward-rate" },
      el("span", { text: bigNumber(stat) }),
      el("span", { class: "reward-rate-unit", text: "back" }));
  }

  /** "2" -> "2\u00a2", "0.67" -> "0.67\u00a2". */
  function cents(points) {
    return `${Math.round(centsPerPoint(points, settings.values) * 100) / 100}\u00a2`;
  }

  /**
   * Under the percent: the points and the working ("1.5x Aeroplan \u00d7 2\u00a2
   * = 3\u00a2 per $1"), where moved points came from, and what this amount
   * earns. Cash back just says so.
   */
  function detailLine(stat, spend) {
    const c = stat.card;
    const cash = groupUnit(c.points) === "percent";
    const typeName = groupName(c.points);
    const parts = [];
    // Cash back reads in the same order as points (what it earns per $1,
    // then what this amount earns), at explicit user request: it used to
    // say "$3.00 back on $150.00", backwards next to "2,250 points, worth $2.48".
    const perDollar = Math.round(stat.rate * centsPerPoint(c.points, settings.values) * 100) / 100;
    parts.push(cash
      ? `${formatRate(c.points, stat.rate)} ${typeName.toLowerCase()} = ${perDollar}\u00a2 per $1`
      : `${formatRate(c.points, stat.rate)} ${typeName} \u00d7 ${cents(c.points)} = ${perDollar}\u00a2 per $1`);
    if (c.convertedFrom) parts.push(movedNote(c));
    if (spend) {
      parts.push(cash
        ? `${formatWorth(c.points, stat.rate, spend, settings.values)} cash back`
        : `${formatEarned(c.points, stat.rate, spend)}, worth ${formatWorth(c.points, stat.rate, spend, settings.values)}`);
    }
    return parts;
  }

  function movedNote(c) {
    return `Earns ${groupName(c.convertedFrom)}, moved to ${groupName(c.points)} ` +
      `at ${ratioLabel(c.ratio)}`;
  }

  function ratioLabel(ratio) {
    return ratio === 1 ? "1 to 1" : `1 to ${Math.round(ratio * 100) / 100}`;
  }

  /** One line per part: the working, then what this purchase earns. */
  function detailLines(parts, className) {
    return parts.map((text) => el("div", { class: className, text }));
  }

  function resultRow(stat, rank, spend) {
    const lines = explain(stat, settings.purchase, allAnswers());
    const detail = stat.accepted ? detailLine(stat, spend) : [];
    const medal = ["", "gold", "silver", "bronze"][rank] || "";
    return el("div", {
      class: `reward-row${rank === 1 ? " is-best" : ""}${medal ? ` is-${medal}` : ""}${stat.accepted ? "" : " is-out"}`,
    },
      el("span", {
        class: `reward-rank${medal ? " reward-medal" : ""}`,
        "aria-label": rank ? `Number ${rank}` : "Not accepted",
      }, el("span", { text: rank ? String(rank) : "" })),
      rateCell(stat),
      el("div", { class: "reward-body" },
        el("div", { class: "reward-name" },
          cardName(stat.card),
          stat.accepted ? null : pill("Not accepted", "error"),
          offerForCard(stat.card.id) ? offerTag(offerForCard(stat.card.id)) : null),
        detailLines(detail, "reward-detail-line"),
        lines.map((line) => el("div", { class: "hint", text: line }))));
  }

  function paintWalletNote() {
    clear(walletNote);
    const n = settings.wallet.length;
    if (!n) return;
    walletNote.append(
      `Comparing your ${n} card${n === 1 ? "" : "s"} from My cards. `,
      el("button", { type: "button", class: "reward-quiet", text: "Change them", onClick: goToMyCards }));
    if (feed && !feed.ok && !CARDS.length) walletNote.append(` ${feed.error}`);
  }

  async function addShop(typed) {
    const result = await customDialog("Add a shop", (body) => {
      const name = textInput(typed, { placeholder: "e.g. Bob's Corner Grocer" });
      const purchase = select(
        [{ value: "", label: "Choose one..." }, ...PURCHASES.map((p) => ({ value: p.id, label: p.label }))],
        settings.purchase, () => {});
      purchase.options[0].disabled = true;
      const amex = select([
        { value: "", label: "Not sure" },
        { value: "yes", label: "Takes Amex" },
        { value: "no", label: "No Amex" },
      ], "", () => {});
      const error = el("p", { class: "hint is-error" });
      body.append(
        el("div", { class: "card-grid" },
          field("Name", name),
          field("Category", purchase),
          field("Amex", amex)),
        error);
      return {
        validate: () => {
          const text = name.value.trim();
          if (!text) error.textContent = "Give the shop a name.";
          else if (!purchase.value) error.textContent = "Pick a category.";
          else if (merchantByName(text)) error.textContent = `${merchantByName(text).name} is already in the list.`;
          else return true;
          return false;
        },
        value: () => ({ name: name.value.trim(), purchase: purchase.value, amex: amex.value }),
      };
    }, { confirmText: "Add shop" });
    if (!result) return;
    const m = typedShop(result.name, result.purchase);
    settings.shops[shopKey(m)] = {
      name: m.name,
      purchase: m.purchase,
      on: localToday(),
      answers: result.amex ? { amex: result.amex } : {},
    };
    store.save();
    pickShop(m);
  }

  async function removeShop(m) {
    const ok = await confirmDialog("Remove shop", `Remove ${m.name} from your shops?`, { confirmText: "Remove" });
    if (!ok) return;
    delete settings.shops[shopKey(m)];
    store.save();
    answers = {};
    setShop(null);
    render();
  }

  render();
  refreshCatalogue();
  return root;
}
