// Card Rewards: which of your cards earns the most for a purchase, grouped
// by the kind of points it earns, and which question to ask next until the
// answer is at least 90% sure.
//
// Points are compared raw (5x is 5, 4% is 4), never converted to dollars,
// at explicit user request - which is why cards are grouped by point type:
// raw numbers only compare cleanly inside one program.
//
// How sure: everything not yet known (which store, does it take Amex, is a
// cap used up) is a question with a prior. Every combination of the open
// answers is a scenario. The result shown is the most likely one; how sure
// is the share of scenarios, by probability, in which every group's top
// card really is the best of its group, really is accepted, and really
// earns the rate shown. The next question is the one whose answer is
// expected to raise that the most.

import { CARDS, POINT_TYPES, PURCHASES } from "./card_catalogue.js";

export const TARGET_CONFIDENCE = 0.9;
export const UNSURE = "unsure";

// Grocery stores that code as a supermarket. Costco and Walmart code as a
// warehouse club or discount store, so a card's grocery rate does not
// apply there - they are treated as "everything else".
const GROCERS = ["sobeys", "loblaw", "grocer"];

const ALL = PURCHASES.map((p) => p.id);

// Purchases nearly always made at home, in Canadian dollars.
const EVERYDAY = (p) => Object.fromEntries(
  ["groceries", "gas", "ev", "transit", "bills", "drugstore", "delivery", "streaming"]
    .map((id) => [id, p]));

export const QUESTIONS = [
  {
    id: "store",
    text: "Where are you buying groceries?",
    appliesTo: ["groceries"],
    options: [
      { id: "loblaw", label: "Superstore, No Frills, Loblaws, Zehrs, Fortinos, Provigo or Maxi", prior: 0.3 },
      { id: "sobeys", label: "Sobeys, Safeway, IGA, FreshCo or Foodland", prior: 0.2 },
      { id: "grocer", label: "Another grocery store (Metro, Food Basics, Save-On-Foods, a local grocer)", prior: 0.3 },
      { id: "costco", label: "Costco", prior: 0.1, category: "other", only: ["mastercard"] },
      { id: "walmart", label: "Walmart, Giant Tiger or a dollar store", prior: 0.1, category: "other" },
    ],
  },
  {
    id: "pharmacy",
    text: "Which drugstore?",
    appliesTo: ["drugstore"],
    options: [
      { id: "shoppers", label: "Shoppers Drug Mart or Pharmaprix", prior: 0.45 },
      { id: "other-pharmacy", label: "Another drugstore (Rexall, London Drugs, Jean Coutu, independent)", prior: 0.55 },
    ],
  },
  {
    id: "station",
    text: "Which gas station?",
    appliesTo: ["gas"],
    options: [
      { id: "esso", label: "Esso or Mobil", prior: 0.2 },
      { id: "costco", label: "Costco gas", prior: 0.1, only: ["mastercard"] },
      { id: "other-station", label: "Another station (Petro-Canada, Shell, Canadian Tire, Husky)", prior: 0.7 },
    ],
  },
  {
    id: "booking",
    text: "What are you booking, and with whom?",
    appliesTo: ["travel"],
    options: [
      { id: "air-canada", label: "Air Canada or Air Canada Vacations, booked directly", prior: 0.3 },
      { id: "expedia", label: "Anything through Expedia For TD", prior: 0.05 },
      { id: "other-travel", label: "Another airline, a hotel, or another travel site", prior: 0.65 },
    ],
  },
  {
    id: "currency",
    text: "What currency is it charged in?",
    appliesTo: ALL,
    options: [
      { id: "cad", label: "Canadian dollars", prior: { ...EVERYDAY(0.99), default: 0.93, travel: 0.75 } },
      { id: "usd", label: "US dollars", prior: { ...EVERYDAY(0.008), default: 0.05, travel: 0.15 } },
      { id: "foreign", label: "Another currency", prior: { ...EVERYDAY(0.002), default: 0.02, travel: 0.1 } },
    ],
  },
  {
    id: "amex",
    text: "Does this place take American Express?",
    appliesTo: ALL,
    options: [
      {
        id: "yes", label: "Yes",
        prior: {
          default: 0.85, groceries: 0.97, delivery: 0.99, streaming: 0.99,
          drugstore: 0.97, travel: 0.97, gas: 0.92, transit: 0.92, bills: 0.92,
        },
      },
      {
        id: "no", label: "No",
        prior: {
          default: 0.15, groceries: 0.03, delivery: 0.01, streaming: 0.01,
          drugstore: 0.03, travel: 0.03, gas: 0.08, transit: 0.08, bills: 0.08,
        },
        blocks: ["amex"],
      },
    ],
  },
];

// How likely a cap is already used up, before anyone says.
const CAP_PRIOR = { month: 0.07, year: 0.05 };

const CARD_INDEX = new Map(CARDS.map((card) => [card.id, card]));

export function purchaseLabel(id) {
  return PURCHASES.find((p) => p.id === id)?.label || id;
}

export function pointTypeName(id) {
  return POINT_TYPES[id]?.name || id || "Points";
}

/** "5x" for points, "4%" for cash back. */
export function formatRate(points, rate) {
  const n = Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 100) / 100);
  return POINT_TYPES[points]?.unit === "percent" ? `${n}%` : `${n}x`;
}

/** What a rate earns on an amount: "1,250 points" or "$12.50 back". */
export function formatEarned(points, rate, amount) {
  if (!(amount > 0)) return "";
  if (POINT_TYPES[points]?.unit === "percent") {
    return `${new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" })
      .format(amount * rate / 100)} back`;
  }
  return `${Math.round(amount * rate).toLocaleString("en-CA")} points`;
}

/**
 * The cards in a wallet, as catalogue cards with the holder's own choices
 * applied. A wallet entry is { id, picks?, flags? } for a catalogue card,
 * or { custom: true, ...a whole card } for one typed in by hand.
 */
export function walletCards(wallet = []) {
  const cards = [];
  for (const entry of wallet) {
    const base = entry.custom ? normaliseCustom(entry) : CARD_INDEX.get(entry.id);
    if (!base) continue;
    cards.push({
      ...base,
      chosen: (entry.picks || []).slice(0, base.picks?.count ?? 0),
      flagsOn: { ...(entry.flags || {}) },
    });
  }
  return cards;
}

/**
 * A card typed in by hand: a name, network, point type, a base rate and
 * a rate per purchase type. Missing or bad numbers fall back to the base.
 */
export function normaliseCustom(entry) {
  const base = Number(entry.base) > 0 ? Number(entry.base) : 1;
  const earn = [];
  for (const [purchase, rate] of Object.entries(entry.rates || {})) {
    const value = Number(rate);
    if (ALL.includes(purchase) && value > 0 && value !== base) {
      earn.push({ on: [purchase], rate: value });
    }
  }
  return {
    id: entry.id,
    custom: true,
    name: String(entry.name || "My card").trim() || "My card",
    issuer: "",
    network: ["amex", "visa", "mastercard"].includes(entry.network) ? entry.network : "visa",
    points: entry.points && POINT_TYPES[entry.points] ? entry.points : "custom:" + (entry.pointsName || "Points"),
    pointsName: entry.pointsName || "",
    annualFee: Number(entry.annualFee) || 0,
    fxFee: entry.fxFee === undefined ? 0.025 : Number(entry.fxFee) || 0,
    base,
    earn,
    notes: [],
    source: "Entered by you",
    checked: "",
  };
}

/** Name of a point type, including one typed in for a custom card. */
export function groupName(points) {
  if (String(points).startsWith("custom:")) return points.slice("custom:".length) || "Points";
  return pointTypeName(points);
}

/** The unit of a point type: "percent" for cash back, otherwise "points". */
export function groupUnit(points) {
  return POINT_TYPES[points]?.unit || "points";
}

function capQuestionId(card, cap) {
  return `cap:${card.id}:${cap.key}`;
}

function ruleCovers(rule, card, purchase) {
  return rule.on.some((on) => on === "*" || on === purchase ||
    (on === "picks" && card.chosen?.includes(purchase)));
}

/** Every question that could matter for this purchase with these cards. */
export function questionsFor(purchase, cards) {
  const list = QUESTIONS.filter((q) => q.appliesTo.includes(purchase));
  // A store answer can turn groceries into "everything else", so caps on
  // rules for either purchase can matter.
  const purchases = new Set([purchase]);
  for (const q of list) for (const o of q.options) if (o.category) purchases.add(o.category);

  const seen = new Set();
  for (const card of cards) {
    for (const rule of card.earn) {
      if (!rule.cap || ![...purchases].some((p) => ruleCovers(rule, card, p))) continue;
      const id = capQuestionId(card, rule.cap);
      if (seen.has(id)) continue;
      seen.add(id);
      const spend = new Intl.NumberFormat("en-CA", {
        style: "currency", currency: "CAD", maximumFractionDigits: 0,
      }).format(rule.cap.spend);
      const over = CAP_PRIOR[rule.cap.per] ?? 0.05;
      list.push({
        id,
        cap: true,
        text: `This ${rule.cap.per}, have you already put ${spend} of ${rule.cap.label} ` +
          `on your ${card.name}?`,
        appliesTo: [purchase],
        options: [
          { id: "under", label: "No, still under", prior: 1 - over },
          { id: "over", label: "Yes, I'm past it", prior: over },
        ],
      });
    }
  }
  return list;
}

function priorOf(option, purchase) {
  const prior = option.prior;
  if (typeof prior === "number") return prior;
  return prior?.[purchase] ?? prior?.default ?? 0;
}

/** Each option of a question with its probability for this purchase. */
function weighted(question, purchase) {
  const options = question.options.map((o) => ({ option: o, p: priorOf(o, purchase) }));
  const total = options.reduce((s, o) => s + o.p, 0) || 1;
  return options.filter((o) => o.p > 0).map((o) => ({ ...o, p: o.p / total }));
}

/**
 * What one card earns, and whether it is accepted, once every answer is
 * known. `answers` maps a question id to an option id.
 */
export function earnFor(card, purchase, answers, questions = QUESTIONS) {
  let category = purchase;
  let accepted = true;
  for (const q of questions) {
    if (!q.appliesTo.includes(purchase)) continue;
    const option = q.options.find((o) => o.id === answers[q.id]);
    if (!option) continue;
    if (option.category) category = option.category;
    if (option.only && !option.only.includes(card.network)) accepted = false;
    if (option.blocks?.includes(card.network)) accepted = false;
  }
  if (!accepted) return { accepted: false, rate: 0, rule: null };

  for (const rule of card.earn) {
    if (!ruleCovers(rule, card, category)) continue;
    if (!conditionsHold(rule.when, card, answers)) continue;
    if (rule.cap && answers[capQuestionId(card, rule.cap)] === "over") continue;
    return { accepted: true, rate: rule.rate, rule };
  }
  return { accepted: true, rate: card.base, rule: null };
}

function conditionsHold(when, card, answers) {
  if (!when) return true;
  for (const [key, allowed] of Object.entries(when)) {
    if (key === "flag") {
      if (!card.flagsOn?.[allowed]) return false;
    } else if (!allowed.includes(answers[key])) {
      return false;
    }
  }
  return true;
}

/** Every combination of the answers still open, with its probability. */
function scenarios(questions, purchase, answers) {
  let list = [{ answers: { ...answers }, p: 1 }];
  for (const q of questions) {
    const given = answers[q.id];
    if (given !== undefined && given !== UNSURE) continue;
    const options = weighted(q, purchase);
    const next = [];
    for (const s of list) {
      for (const { option, p } of options) {
        next.push({ answers: { ...s.answers, [q.id]: option.id }, p: s.p * p });
      }
    }
    list = next;
  }
  return list;
}

function evaluate(cards, purchase, answers, questions) {
  const all = scenarios(questions, purchase, answers);
  const outcomes = all.map((s) => ({
    p: s.p,
    earn: cards.map((card) => earnFor(card, purchase, s.answers, questions)),
  }));

  const stats = cards.map((card, i) => {
    let pAccepted = 0;
    let expected = 0;
    const rates = new Map();
    for (const o of outcomes) {
      const e = o.earn[i];
      if (!e.accepted) continue;
      pAccepted += o.p;
      expected += o.p * e.rate;
      rates.set(e.rate, (rates.get(e.rate) || 0) + o.p);
    }
    let shownRate = card.base;
    let best = -1;
    for (const [rate, p] of rates) {
      if (p > best + 1e-12 || (Math.abs(p - best) <= 1e-12 && rate > shownRate)) {
        best = p;
        shownRate = rate;
      }
    }
    const values = [...rates.keys()];
    return {
      card,
      index: i,
      accepted: pAccepted >= 0.5,
      pAccepted,
      expected,
      rate: shownRate,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  });

  const byType = new Map();
  for (const stat of stats) {
    const key = stat.card.points;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(stat);
  }
  const groups = [...byType.entries()].map(([points, list]) => {
    list.sort((a, b) => b.expected - a.expected || b.rate - a.rate ||
      a.card.name.localeCompare(b.card.name));
    return { points, name: groupName(points), unit: groupUnit(points), cards: list };
  });
  groups.sort((a, b) => Number(b.cards[0].accepted) - Number(a.cards[0].accepted) ||
    b.cards[0].rate - a.cards[0].rate || b.cards[0].expected - a.cards[0].expected ||
    a.name.localeCompare(b.name));

  let sure = 0;
  for (const o of outcomes) {
    const right = groups.every((group) => {
      const top = group.cards[0];
      const actual = o.earn[top.index];
      if (!top.accepted) return group.cards.every((c) => !o.earn[c.index].accepted);
      if (!actual.accepted || actual.rate !== top.rate) return false;
      return group.cards.every((c) => !o.earn[c.index].accepted || o.earn[c.index].rate <= actual.rate);
    });
    if (right) sure += o.p;
  }

  // Rounded so that a sum of products that is 1 or 0.9 on paper is too.
  const confidence = Math.min(1, Math.round(sure * 1e9) / 1e9);
  return { groups, confidence: groups.length ? confidence : 0 };
}

/**
 * The whole answer for a purchase: cards grouped by point type (best group
 * first, best card first within it), how sure that is, and the question to
 * ask next - null once it is at least TARGET_CONFIDENCE sure, or when no
 * question left could change anything.
 */
export function recommend(cards, purchase, answers = {}) {
  const questions = questionsFor(purchase, cards);
  const now = evaluate(cards, purchase, answers, questions);

  let next = null;
  if (cards.length && now.confidence < TARGET_CONFIDENCE - 1e-9) {
    let bestGain = 1e-6;
    for (const q of questions) {
      if (answers[q.id] !== undefined) continue;
      let after = 0;
      for (const { option, p } of weighted(q, purchase)) {
        after += p * evaluate(cards, purchase, { ...answers, [q.id]: option.id }, questions).confidence;
      }
      const gain = after - now.confidence;
      if (gain > bestGain + 1e-9) {
        bestGain = gain;
        next = q;
      }
    }
  }

  const asked = questions.filter((q) => answers[q.id] !== undefined).map((q) => ({
    question: q,
    answer: answers[q.id] === UNSURE
      ? "Not sure"
      : q.options.find((o) => o.id === answers[q.id])?.label || answers[q.id],
  }));

  return { ...now, next, asked, questions };
}

/** Why a card's rate is what it is, in words, for the result list. */
export function explain(stat, purchase, answers) {
  const lines = [];
  const card = stat.card;
  if (!stat.accepted) {
    const store = answers.store === "costco" || answers.station === "costco";
    lines.push(store ? "Costco only takes Mastercard." : `${card.network === "amex" ? "Amex" : "This card"} is not accepted here.`);
    return lines;
  }
  if (stat.min !== stat.max) {
    lines.push(`Could be ${formatRate(card.points, stat.min)} to ${formatRate(card.points, stat.max)} ` +
      "depending on the answers still open.");
  }
  if (stat.pAccepted < 0.999 && stat.pAccepted >= 0.5) {
    lines.push(`${Math.round((1 - stat.pAccepted) * 100)}% chance it is not accepted here.`);
  }
  const currency = answers.currency;
  if ((currency === "usd" || currency === "foreign") && card.fxFee > 0) {
    lines.push(`Adds a ${Math.round(card.fxFee * 1000) / 10}% foreign transaction fee.`);
  } else if ((currency === "usd" || currency === "foreign") && card.fxFee === 0) {
    lines.push("No foreign transaction fee.");
  }
  const capped = card.earn.find((rule) => rule.cap && rule.rate === stat.rate &&
    ruleCovers(rule, card, purchase));
  if (capped && answers[capQuestionId(card, capped.cap)] !== "over") {
    lines.push(`Bonus rate stops after $${capped.cap.spend.toLocaleString("en-CA")} of ` +
      `${capped.cap.label} a ${capped.cap.per}.`);
  }
  return lines;
}

/** Days since the catalogue was last checked, from "YYYY-MM-DD" dates. */
export function daysSince(checked, today) {
  if (!checked || !today) return null;
  const a = Date.UTC(...checked.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...today.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

/**
 * A card's earn rules in words, best rate first, ending with the base rate:
 * [{ rate: "5x", what: "Groceries, ...", conditions: ["..."] }]
 */
export function describeEarn(card) {
  const lines = card.earn.map((rule) => {
    const what = rule.on.map((on) => {
      if (on === "*") return "Everything";
      if (on === "picks") {
        return card.chosen?.length
          ? card.chosen.map(purchaseLabel).join(", ")
          : "The categories you choose";
      }
      return purchaseLabel(on);
    }).join(", ");
    const conditions = [];
    for (const [key, allowed] of Object.entries(rule.when || {})) {
      if (key === "flag") {
        conditions.push(card.flags?.find((f) => f.id === allowed)?.label || allowed);
        continue;
      }
      const question = QUESTIONS.find((q) => q.id === key);
      const labels = allowed.map((id) => question?.options.find((o) => o.id === id)?.label || id);
      conditions.push(key === "currency" ? `Charged in ${labels.join(" or ")}` : labels.join(" or "));
    }
    if (rule.cap) {
      conditions.push(`Up to $${rule.cap.spend.toLocaleString("en-CA")} of ${rule.cap.label} a ${rule.cap.per}`);
    }
    return { rate: formatRate(card.points, rule.rate), value: rule.rate, what, conditions };
  });
  lines.push({ rate: formatRate(card.points, card.base), value: card.base, what: "Everything else", conditions: [] });
  return lines;
}
