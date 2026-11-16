// Points (at explicit user request, 2026-11-16: the points calculator "on its
// own tab and more detailed, like when booking flights with Aeroplan to see if
// it's good or when converting Amex points or using PC Optimum"): your
// balances, whether a redemption is a good use of points, where movable
// points are best sent, and PC Optimum bonus redemption tiers.

import { OFFERS, POINT_TYPES } from "../tools/card_catalogue.js";
import { browserFetchJson, loadCatalogue, useSavedCatalogue } from "../tools/card_feed.js";
import {
  UNSURE, centsPerPoint, groupName, groupUnit, recommend, shortName, transferRatio, walletCards,
} from "../tools/card_rewards.js";
import { balancesWorth, redemption, tierPlan, transferOptions, transferable } from "../tools/points_calc.js";
import { clear, el, hint, pageHeading, pill, sectionTitle, textInput } from "../ui.js";
import { editPointValues } from "./point_values.js";

// What paying cash instead would be, per program, for what it earns.
const CASH_INSTEAD = {
  aeroplan: { purchase: "travel", answers: { booking: "air-canada", currency: "cad" }, what: "the flight" },
  bonvoy: { purchase: "hotels", answers: { booking: "marriott", currency: "cad" }, what: "the stay" },
  pc: { purchase: "groceries", answers: { store: "loblaw", currency: "cad" }, what: "the shop" },
  scene: { purchase: "groceries", answers: { store: "sobeys", currency: "cad" }, what: "the shop" },
};

export function cardPointsPage(app) {
  const store = app.state.store;
  const settings = store.section("cardRewards");
  if (!Array.isArray(settings.wallet)) settings.wallet = [];
  if (!settings.values || typeof settings.values !== "object") settings.values = {};
  if (!settings.balances || typeof settings.balances !== "object") settings.balances = {};

  const root = el("div", { class: "page-body" });
  root.append(pageHeading(
    "Points",
    "Your points balances and what they are worth, whether a redemption is a good " +
    "use of points (an Aeroplan flight, a Marriott night, a PC Optimum event), and " +
    "where points that move are best sent. Everything uses your point values."));

  const balancesCard = el("div", { class: "card points-card" });
  const redeemCard = el("div", { class: "card points-card" });
  const moveCard = el("div", { class: "card points-card" });
  const pcCard = el("div", { class: "card points-card" });
  root.append(balancesCard, redeemCard, moveCard, pcCard);

  const cash = (n) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const whole = (n) => Math.round(n).toLocaleString("en-CA");
  const cents = (n) => `${Number(n.toFixed(2))}¢`;
  const isPoints = (p) => POINT_TYPES[p] && groupUnit(p) !== "percent";
  const save = () => store.save();

  function numberInput(value, placeholder, onInput, label) {
    const input = textInput(value ?? "", { type: "number", placeholder });
    input.min = "0";
    input.step = "any";
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("enterkeyhint", "done");
    if (label) input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function field(label, input, note = "") {
    return el("label", { class: "points-field" },
      el("span", { class: "field-label", text: label }), input, note ? el("span", { class: "hint", text: note }) : "");
  }

  function typeSelect(types, value, onChange, label) {
    const node = el("select", { "aria-label": label }, types.map((p) => el("option", { value: p, text: groupName(p) })));
    node.value = types.includes(value) ? value : types[0];
    node.addEventListener("change", () => onChange(node.value));
    return node;
  }

  function held() {
    return [...new Set(walletCards(settings.wallet).map((c) => c.points))].filter(isPoints);
  }

  function renderAll() {
    renderBalances();
    renderRedeem();
    renderMove();
    renderPc();
  }

  // ---------- your points ----------
  function renderBalances() {
    clear(balancesCard);
    const types = [...new Set([...held(), ...Object.keys(settings.balances).filter(isPoints)])];
    const totalNode = el("strong");
    const paintTotal = () => { totalNode.textContent = cash(balancesWorth(settings.balances, settings.values).total); };
    const list = el("div", { class: "mycards-balance-list" });
    for (const points of types) {
      const out = el("span", { class: "mycards-balance-worth" });
      const paint = () => {
        const n = Number(settings.balances[points]) || 0;
        const ratio = settings.preferred && points !== settings.preferred ? transferRatio(points, settings.preferred) : 0;
        out.textContent = `${cash(n * centsPerPoint(points, settings.values) / 100)} at ${cents(centsPerPoint(points, settings.values))}` +
          (ratio && n ? `, or ${whole(n * ratio)} ${groupName(settings.preferred)} worth ` +
            `${cash(n * ratio * centsPerPoint(settings.preferred, settings.values) / 100)}` : "");
      };
      const input = numberInput(settings.balances[points], "0", (value) => {
        const n = Number(value);
        if (value.trim() === "" || !(n >= 0)) delete settings.balances[points];
        else settings.balances[points] = n;
        save();
        paint();
        paintTotal();
        renderMove();
        renderPc();
      }, `${groupName(points)} balance`);
      input.step = "1";
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
      save();
      renderBalances();
    });
    paintTotal();
    balancesCard.append(
      el("div", { class: "points-head" }, sectionTitle("Your points"),
        el("button", { type: "button", class: "reward-quiet", text: "Point values", onClick: async () => {
          if (await editPointValues(store)) renderAll();
        } })),
      types.length ? list : hint("Add your cards on Wallet, or pick a kind of points below, to track a balance."),
      el("div", { class: "mycards-balance-foot" },
        types.length ? el("span", { class: "hint" }, "About ", totalNode, " in all, at your point values.") : "",
        others.length ? addSelect : ""));
  }

  // ---------- is this redemption good? ----------
  const redeem = { points: "", cash: "", fees: "", type: "" };

  function bestCardFor(type) {
    const cards = walletCards(settings.wallet);
    const how = CASH_INSTEAD[type] || { purchase: "travel", answers: { booking: "other-travel", currency: "cad" }, what: "it" };
    if (!cards.length) return { rate: 0, card: null, what: how.what };
    const top = recommend(cards, how.purchase, { amex: UNSURE, ...how.answers },
      { measure: "value", grouped: false, values: settings.values, preferred: settings.preferred }).groups[0]?.cards[0];
    if (!top?.accepted) return { rate: 0, card: null, what: how.what };
    return { rate: top.rate * centsPerPoint(top.card.points, settings.values) / 100, card: top.card, what: how.what };
  }

  function renderRedeem() {
    clear(redeemCard);
    const types = Object.keys(POINT_TYPES).filter(isPoints);
    if (!types.includes(redeem.type)) redeem.type = types.includes("aeroplan") ? "aeroplan" : types[0];
    const result = el("div", { class: "points-result" });
    const paint = () => {
      clear(result);
      const yours = centsPerPoint(redeem.type, settings.values);
      const best = bestCardFor(redeem.type);
      const r = redemption({ points: redeem.points, cash: redeem.cash, fees: redeem.fees, backRate: best.rate, yours });
      if (!r.verdict) {
        result.append(hint("Type the points it costs and the cash price for the same thing."));
        return;
      }
      const label = { good: ["Good use of points", "ok"], close: ["About even", "caution"], poor: ["Poor: pay cash, keep the points", "warn"] }[r.verdict];
      result.append(
        el("div", { class: "points-big" }, el("span", { class: "points-value", text: `${cents(r.fair)} a point` }), pill(label[0], label[1])),
        el("p", { class: "points-line", text: `Your ${groupName(redeem.type)} points are worth ${cents(yours)} to you, so this ` +
          (r.verdict === "good" ? "beats that." : r.verdict === "close" ? "is close to it." : "falls short of it.") }),
        el("p", { class: "hint", text: `Points save ${cash(r.saved)} of cash${Number(redeem.fees) > 0 ? " after the taxes and fees" : ""}: ` +
          `${cents(r.cents)} a point.` + (best.card
          ? ` Paying cash for ${best.what} with your ${shortName(best.card)} would earn about ${cash(r.saved * best.rate)} back, so the fair value is ${cents(r.fair)}.`
          : "") }));
      // Short on points: what could move here.
      const sources = Object.keys(POINT_TYPES).filter((p) => p !== redeem.type && transferRatio(p, redeem.type) > 0);
      for (const from of sources) {
        const ratio = transferRatio(from, redeem.type);
        const have = Number(settings.balances[redeem.type]) || 0;
        const need = Math.max(0, Number(redeem.points) - have);
        if (!need) continue;
        result.append(hint(`Short by ${whole(need)}? ${groupName(from)} moves at 1 to ${ratio}: about ${whole(Math.ceil(need / ratio))} of them.`));
      }
    };
    const type = typeSelect(types, redeem.type, (value) => { redeem.type = value; paint(); }, "Kind of points");
    const points = numberInput(redeem.points, "e.g. 25000", (v) => { redeem.points = v; paint(); }, "Points it costs");
    const price = numberInput(redeem.cash, "e.g. 560", (v) => { redeem.cash = v; paint(); }, "Cash price");
    const fees = numberInput(redeem.fees, "0", (v) => { redeem.fees = v; paint(); }, "Taxes and fees paid in cash");
    redeemCard.append(sectionTitle("Is this a good use of points?"),
      hint("For a flight, a hotel night or anything else you could buy either way: the points it costs against the cash price."),
      el("div", { class: "points-grid" },
        field("Points", type),
        field("Points it costs", points),
        field("Cash price ($)", price, "The same thing paid in cash"),
        field("Taxes and fees ($)", fees, "Paid in cash on the points booking")),
      result);
    paint();
  }

  // ---------- where to move points ----------
  const move = { from: "", amount: "" };

  function renderMove() {
    clear(moveCard);
    const froms = transferable();
    if (!froms.length) return;
    if (!froms.includes(move.from)) move.from = froms[0];
    const table = el("div", { class: "points-options" });
    const paint = () => {
      clear(table);
      const amount = move.amount !== "" ? Number(move.amount) : Number(settings.balances[move.from]) || 10000;
      const options = transferOptions(move.from, amount, { values: settings.values });
      options.forEach((o, i) => table.append(el("div", { class: `points-option${i === 0 ? " is-best" : ""}` },
        el("div", {},
          el("div", { class: "points-option-name", text: o.kind === "keep"
            ? `Keep as ${groupName(o.to)}` : `Move to ${groupName(o.to)}` }),
          el("div", { class: "hint", text: o.kind === "keep"
            ? `A statement credit or travel at ${cents(Number(POINT_TYPES[o.to].cents) || 0)}`
            : `1 to ${o.ratio}: ${whole(o.points)} points at ${cents(centsPerPoint(o.to, settings.values))}` })),
        el("div", { class: "points-option-worth" }, el("strong", { text: cash(o.worth) }), i === 0 ? pill("Best", "ok") : ""))));
      const running = OFFERS.filter((offer) => offer.points?.includes(move.from) && offer.ends >= todayIso());
      for (const offer of running) table.append(hint(`Running now: ${offer.title}, until ${offer.ends}. Not counted above.`));
    };
    const from = typeSelect(froms, move.from, (value) => { move.from = value; move.amount = ""; renderMove(); }, "Points to move");
    const amount = numberInput(move.amount, String(Number(settings.balances[move.from]) || 10000), (v) => { move.amount = v; paint(); }, "How many");
    moveCard.append(sectionTitle("Where to send points"),
      hint("Points that move to other programs, and what each choice is worth at your point values."),
      el("div", { class: "points-grid" }, field("Points", from), field("How many", amount, "Blank uses your balance")),
      table);
    paint();
  }

  // ---------- PC Optimum bonus redemption ----------
  const tier = { points: "", dollars: "" };

  function renderPc() {
    clear(pcCard);
    if (!POINT_TYPES.pc) return;
    const balance = Number(settings.balances.pc) || 0;
    const result = el("div", { class: "points-result" });
    const paint = () => {
      clear(result);
      const standard = Number(POINT_TYPES.pc.cents) || 0.1;
      const plan = tierPlan(balance, tier.points, tier.dollars);
      if (!plan) {
        result.append(hint(`Type an event's tier, like 150,000 points for $225. At the standard ${cents(standard)}, ` +
          `your ${whole(balance)} points are ${cash(balance * standard / 100)}.`));
        return;
      }
      result.append(
        el("div", { class: "points-big" }, el("span", { class: "points-value", text: `${cents(plan.cents)} a point` }),
          pill(plan.cents > standard ? `${Number((plan.cents / standard).toFixed(2))}x the standard` : "No better than usual",
            plan.cents > standard ? "ok" : "muted")),
        el("p", { class: "points-line", text: plan.times
          ? `Your ${whole(balance)} points cover it ${plan.times === 1 ? "once" : `${plan.times} times`}: ${cash(plan.dollars)} off.`
          : `Your ${whole(balance)} points are not enough for this tier yet.` }),
        plan.short ? hint(`${whole(plan.short)} more points for ${plan.times ? "another" : "it"}.`) : "",
        hint(`At the standard ${cents(standard)}, the same points would be ${cash(balance * standard / 100)}.`));
    };
    const pts = numberInput(tier.points, "e.g. 150000", (v) => { tier.points = v; paint(); }, "Tier points");
    const dollars = numberInput(tier.dollars, "e.g. 225", (v) => { tier.dollars = v; paint(); }, "Tier dollars off");
    pcCard.append(sectionTitle("PC Optimum bonus redemption"),
      hint(`Shoppers bonus redemption events give more per point at set tiers. Your balance comes from Your points (${whole(balance)}).`),
      el("div", { class: "points-grid" }, field("Tier points", pts), field("Dollars off ($)", dollars)),
      result);
    paint();
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  // The saved copy at once, then the latest whenever the page opens (at
  // most every FEED_MAX_AGE_MS, so hopping between the card tabs is free).
  useSavedCatalogue(storage);
  renderAll();
  loadCatalogue({ fetchJson: browserFetchJson, storage }).then(renderAll);
  return root;
}
