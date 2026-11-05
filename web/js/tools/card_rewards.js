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

const ALL = PURCHASES.map((p) => p.id);

// Purchases nearly always made at home, in Canadian dollars.
const EVERYDAY = (p) => Object.fromEntries(
  ["groceries", "gas", "ev", "transit", "bills", "drugstore", "delivery", "streaming"]
    .map((id) => [id, p]));

export const QUESTIONS = [
  {
    id: "store",
    unsure: "Store not sure",
    text: "Where are you buying groceries?",
    appliesTo: ["groceries"],
    options: [
      // Loblaw's grocery banners do not take American Express (reported
      // live; Shoppers Drug Mart, also Loblaw's, does).
      { id: "loblaw", chip: "Loblaw store", label: "Superstore, No Frills, Loblaws, Zehrs, Fortinos, Provigo or Maxi", prior: 0.3, blocks: ["amex"] },
      { id: "sobeys", chip: "Sobeys store", label: "Sobeys, Safeway, IGA, FreshCo or Foodland", prior: 0.2 },
      { id: "grocer", chip: "Other grocer", label: "Another grocery store (Metro, Food Basics, Save-On-Foods, a local grocer)", prior: 0.3 },
      // Costco and Walmart code as a warehouse club or discount store, not
      // a supermarket, so no card's grocery rate applies there.
      { id: "costco", chip: "Costco", label: "Costco", prior: 0.1, category: "other", only: ["mastercard"] },
      { id: "walmart", chip: "Walmart or similar", label: "Walmart, Giant Tiger or a dollar store", prior: 0.1, category: "other" },
    ],
  },
  {
    id: "pharmacy",
    unsure: "Drugstore not sure",
    text: "Which drugstore?",
    appliesTo: ["drugstore"],
    options: [
      { id: "shoppers", chip: "Shoppers", label: "Shoppers Drug Mart or Pharmaprix", prior: 0.45 },
      { id: "other-pharmacy", chip: "Other drugstore", label: "Another drugstore (Rexall, London Drugs, Jean Coutu, independent)", prior: 0.55 },
    ],
  },
  {
    id: "station",
    unsure: "Station not sure",
    text: "Which gas station?",
    appliesTo: ["gas"],
    options: [
      { id: "esso", chip: "Esso or Mobil", label: "Esso or Mobil", prior: 0.2 },
      { id: "costco", chip: "Costco gas", label: "Costco gas", prior: 0.1, only: ["mastercard"] },
      { id: "other-station", chip: "Other station", label: "Another station (Petro-Canada, Shell, Canadian Tire, Husky)", prior: 0.7 },
    ],
  },
  {
    id: "booking",
    unsure: "Booking not sure",
    text: "What are you booking, and with whom?",
    appliesTo: ["travel"],
    options: [
      { id: "air-canada", chip: "Air Canada direct", label: "Air Canada or Air Canada Vacations, booked directly", prior: 0.3 },
      { id: "expedia", chip: "Expedia For TD", label: "Anything through Expedia For TD", prior: 0.05 },
      { id: "other-travel", chip: "Other travel", label: "Another airline, a hotel, or another travel site", prior: 0.65 },
    ],
  },
  {
    id: "currency",
    unsure: "Currency not sure",
    text: "What currency is it charged in?",
    appliesTo: ALL,
    options: [
      { id: "cad", chip: "CAD", label: "Canadian dollars", prior: { ...EVERYDAY(0.99), default: 0.93, travel: 0.75 } },
      { id: "usd", chip: "USD", label: "US dollars", prior: { ...EVERYDAY(0.008), default: 0.05, travel: 0.15 } },
      { id: "foreign", chip: "Other currency", label: "Another currency", prior: { ...EVERYDAY(0.002), default: 0.02, travel: 0.1 } },
    ],
  },
  {
    id: "amex",
    unsure: "Amex not sure",
    text: "Does this place take American Express?",
    appliesTo: ALL,
    options: [
      {
        id: "yes", chip: "Takes Amex", label: "Yes",
        prior: {
          default: 0.85, groceries: 0.97, delivery: 0.99, streaming: 0.99,
          drugstore: 0.97, travel: 0.97, gas: 0.92, transit: 0.92, bills: 0.92,
        },
      },
      {
        id: "no", chip: "No Amex", label: "No",
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything wrong with a downloaded catalogue, as sentences; empty when it
 * is safe to use. The app runs this on every download and keeps its last
 * good copy rather than use a file that fails, and the tests run it on the
 * shipped file, so a bad monthly update fails the deploy instead of
 * reaching anyone.
 */
export function validateCatalogue(data) {
  const problems = [];
  if (!data || typeof data !== "object") return ["It is not a catalogue at all."];
  if (!DATE.test(data.checked || "")) problems.push("`checked` is not a YYYY-MM-DD date.");
  const types = data.pointTypes && typeof data.pointTypes === "object" ? data.pointTypes : null;
  if (!types) problems.push("`pointTypes` is missing.");
  for (const [id, type] of Object.entries(types || {})) {
    if (!type?.name || !["points", "percent"].includes(type.unit)) problems.push(`Point type ${id} needs a name and a unit.`);
    if (type?.cents !== undefined && !(typeof type.cents === "number" && type.cents >= 0 && type.cents < 100)) {
      problems.push(`Point type ${id} has an odd value in cents.`);
    }
    for (const [to, ratio] of Object.entries(type?.transfers || {})) {
      if (!types[to] || to === id || !(typeof ratio === "number" && ratio > 0 && ratio <= 10)) {
        problems.push(`Point type ${id} has an odd transfer to ${to}.`);
      }
    }
  }
  if (!Array.isArray(data.cards) || !data.cards.length) {
    problems.push("There are no cards.");
    return problems;
  }

  const purchases = new Set(ALL);
  const ids = new Set();
  for (const card of data.cards) {
    const name = card?.id || "(a card with no id)";
    if (!card?.id || ids.has(card.id)) problems.push(`${name} is missing an id or listed twice.`);
    ids.add(card?.id);
    if (!card?.name || !card?.issuer) problems.push(`${name} needs a name and an issuer.`);
    if (!["amex", "visa", "mastercard"].includes(card?.network)) problems.push(`${name} has an unknown network.`);
    if (!types?.[card?.points]) problems.push(`${name} earns an unknown point type.`);
    if (!(card?.base > 0)) problems.push(`${name} needs a base rate above 0.`);
    if (!(card?.annualFee >= 0) || !(card?.fxFee >= 0 && card?.fxFee < 0.1)) problems.push(`${name} has odd fees.`);
    if (!DATE.test(card?.checked || "") || card.checked > data.checked) {
      problems.push(`${name} needs a checked date no later than the catalogue's.`);
    }
    if (!card?.source) problems.push(`${name} needs a source.`);
    if (!Array.isArray(card?.earn)) {
      problems.push(`${name} has no earn rules.`);
      continue;
    }
    for (const rule of card.earn) {
      if (!(rule?.rate > 0) || !Array.isArray(rule?.on) || !rule.on.length) {
        problems.push(`${name} has a rule with no rate or no purchases.`);
        continue;
      }
      for (const on of rule.on) {
        if (on === "picks" && !card.picks) problems.push(`${name} uses picks without offering any.`);
        else if (on !== "*" && on !== "picks" && !purchases.has(on)) problems.push(`${name}: unknown purchase ${on}.`);
      }
      for (const [key, allowed] of Object.entries(rule.when || {})) {
        if (key === "flag") {
          if (!card.flags?.some((f) => f.id === allowed)) problems.push(`${name}: unknown flag ${allowed}.`);
          continue;
        }
        const question = QUESTIONS.find((q) => q.id === key);
        if (!question || !Array.isArray(allowed)) {
          problems.push(`${name}: unknown question ${key}.`);
          continue;
        }
        for (const value of allowed) {
          if (!question.options.some((o) => o.id === value)) problems.push(`${name}: ${key} has no answer ${value}.`);
        }
      }
      if (rule.cap && !(rule.cap.key && rule.cap.spend > 0 && rule.cap.label &&
        ["month", "year"].includes(rule.cap.per))) {
        problems.push(`${name} has an incomplete cap.`);
      }
    }
    for (const id of card.picks?.from || []) {
      if (!purchases.has(id)) problems.push(`${name}: unknown pick ${id}.`);
    }
  }
  return problems;
}

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
    const base = entry.custom ? normaliseCustom(entry) : CARDS.find((card) => card.id === entry.id);
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
        per: rule.cap.per,
        unsure: `${shortName(card)} cap not sure`,
        text: `This ${rule.cap.per}, have you already put ${spend} of ${rule.cap.label} ` +
          `on your ${shortName(card)}?`,
        appliesTo: [purchase],
        options: [
          { id: "under", chip: `${shortName(card)} under cap`, label: "No, still under", prior: 1 - over },
          { id: "over", chip: `${shortName(card)} past cap`, label: "Yes, I'm past it", prior: over },
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

/**
 * Cents one point (or one percent, for cash back) is worth: the holder's
 * own value first, then the data file's typical value. Cash back is always
 * worth exactly what it says.
 */
export function centsPerPoint(points, values = {}) {
  if (groupUnit(points) === "percent") return 1;
  const own = Number(values?.[points]);
  if (values?.[points] !== undefined && values?.[points] !== "" && own >= 0) return own;
  const typical = Number(POINT_TYPES[points]?.cents);
  return typical >= 0 && POINT_TYPES[points]?.cents !== undefined ? typical : 1;
}

/** What a rate is worth, as a percent of the purchase ("10%"). */
export function formatValue(points, rate, values) {
  const pct = rate * centsPerPoint(points, values);
  const rounded = pct >= 10 ? Math.round(pct * 10) / 10 : Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

/** What a rate is worth on an amount: "$8.50". */
export function formatWorth(points, rate, amount, values) {
  if (!(amount > 0)) return "";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" })
    .format(amount * rate * centsPerPoint(points, values) / 100);
}

/** How many `to` points one `from` point becomes; 0 when it cannot move. */
export function transferRatio(from, to) {
  if (!from || !to) return 0;
  if (from === to) return 1;
  const ratio = Number(POINT_TYPES[from]?.transfers?.[to]);
  return ratio > 0 ? ratio : 0;
}

/**
 * Cards as they earn for someone who moves every point they can into
 * `preferred`: a card whose points transfer there is treated as earning
 * the preferred points, at its rates times the transfer ratio, and keeps
 * where they came from (`convertedFrom`, `ratio`) for the page to say so.
 */
export function asPreferred(cards, preferred) {
  if (!preferred) return cards;
  return cards.map((card) => {
    const ratio = transferRatio(card.points, preferred);
    if (!ratio || card.points === preferred) return card;
    return {
      ...card,
      points: preferred,
      convertedFrom: card.points,
      ratio,
      base: card.base * ratio,
      earn: card.earn.map((rule) => ({ ...rule, rate: rule.rate * ratio })),
    };
  });
}

function evaluate(cards, purchase, answers, questions, view) {
  const all = scenarios(questions, purchase, answers);
  const outcomes = all.map((s) => ({
    p: s.p,
    // Which cards are past one of their own caps in this scenario. That
    // lower rate is explained by the cap's own line, so it is left out of
    // the card's "could be x to y" range, which is for doubts about the
    // shop itself. Per card: another card's cap says nothing about this one.
    capped: cards.map((card) => Object.entries(s.answers)
      .some(([id, value]) => id.startsWith(`cap:${card.id}:`) && value === "over")),
    earn: cards.map((card) => earnFor(card, purchase, s.answers, questions)),
  }));
  // What one unit of each card's rate counts for: 1 when comparing raw
  // points, the point's worth in cents when comparing value.
  const factor = cards.map((card) => (view.measure === "value" ? centsPerPoint(card.points, view.values) : 1));

  const stats = cards.map((card, i) => {
    let pAccepted = 0;
    let expected = 0;
    const rates = new Map();
    const uncapped = new Set();
    for (const o of outcomes) {
      const e = o.earn[i];
      if (!e.accepted) continue;
      pAccepted += o.p;
      expected += o.p * e.rate * factor[i];
      rates.set(e.rate, (rates.get(e.rate) || 0) + o.p);
      if (!o.capped[i]) uncapped.add(e.rate);
    }
    let shownRate = card.base;
    let best = -1;
    for (const [rate, p] of rates) {
      if (p > best + 1e-12 || (Math.abs(p - best) <= 1e-12 && rate > shownRate)) {
        best = p;
        shownRate = rate;
      }
    }
    const values = uncapped.size ? [...uncapped] : [...rates.keys()];
    return {
      card,
      index: i,
      accepted: pAccepted >= 0.5,
      pAccepted,
      expected,
      rate: shownRate,
      score: shownRate * factor[i],
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  });

  const byType = new Map();
  for (const stat of stats) {
    const key = view.grouped ? stat.card.points : "all";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(stat);
  }
  const groups = [...byType.entries()].map(([points, list]) => {
    const preferred = (stat) => Number(Boolean(view.preferred) && stat.card.points === view.preferred);
    list.sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.expected - a.expected ||
      b.score - a.score || preferred(b) - preferred(a) || a.card.name.localeCompare(b.card.name));
    return view.grouped
      ? { points, name: groupName(points), unit: groupUnit(points), cards: list }
      : { points: null, name: "Your cards", unit: null, cards: list };
  });
  // Preferred points lead when grouped: that is the program being chosen
  // between; everything else is the comparison.
  const first = (group) => Number(Boolean(view.preferred) && group.points === view.preferred);
  groups.sort((a, b) => first(b) - first(a) ||
    Number(b.cards[0].accepted) - Number(a.cards[0].accepted) ||
    b.cards[0].score - a.cards[0].score || b.cards[0].expected - a.cards[0].expected ||
    a.name.localeCompare(b.name));

  let sure = 0;
  for (const o of outcomes) {
    const right = groups.every((group) => {
      const top = group.cards[0];
      const actual = o.earn[top.index];
      if (!top.accepted) return group.cards.every((c) => !o.earn[c.index].accepted);
      if (!actual.accepted || actual.rate !== top.rate) return false;
      const topScore = actual.rate * factor[top.index];
      return group.cards.every((c) => !o.earn[c.index].accepted ||
        o.earn[c.index].rate * factor[c.index] <= topScore + 1e-9);
    });
    if (right) sure += o.p;
  }

  // Rounded so that a sum of products that is 1 or 0.9 on paper is too.
  const confidence = Math.min(1, Math.round(sure * 1e9) / 1e9);
  return { groups, confidence: groups.length ? confidence : 0 };
}

/**
 * The whole answer for a purchase: cards ranked (best first) and how sure
 * that is, plus the question to ask next - null once it is at least
 * TARGET_CONFIDENCE sure, or when no question left could change anything.
 * Once sure enough, the question that would still help is `optional`.
 *
 * view: { measure: "value" | "points", grouped, values, preferred }
 *   value ranks by what the points are worth (centsPerPoint), points by the
 *   raw number. grouped keeps one list per point type; ungrouped is one
 *   list. How sure always means "the top of each list shown is right".
 *   preferred: a point type id; cards whose points move there count as it
 *   (asPreferred), and its group comes first.
 */
export function recommend(cards, purchase, answers = {}, view = {}) {
  const settings = {
    measure: view.measure === "points" ? "points" : "value",
    grouped: view.grouped !== false,
    values: view.values || {},
    preferred: view.preferred && POINT_TYPES[view.preferred] ? view.preferred : "",
  };
  cards = asPreferred(cards, settings.preferred);
  const questions = questionsFor(purchase, cards);
  const now = evaluate(cards, purchase, answers, questions, settings);

  // The most useful question left. Asked when under TARGET_CONFIDENCE;
  // past it, only offered (`optional`), so someone who wants to be fully
  // sure can still answer it.
  let best = null;
  if (cards.length && now.confidence < 1 - 1e-9) {
    let bestGain = 1e-6;
    for (const q of questions) {
      if (answers[q.id] !== undefined) continue;
      let after = 0;
      for (const { option, p } of weighted(q, purchase)) {
        after += p * evaluate(cards, purchase, { ...answers, [q.id]: option.id }, questions, settings).confidence;
      }
      const gain = after - now.confidence;
      if (gain > bestGain + 1e-9) {
        bestGain = gain;
        best = q;
      }
    }
  }
  const sureEnough = now.confidence >= TARGET_CONFIDENCE - 1e-9;
  const next = sureEnough ? null : best;
  const optional = sureEnough ? best : null;

  const asked = questions.filter((q) => answers[q.id] !== undefined).map((q) => ({
    question: q,
    answer: answers[q.id] === UNSURE
      ? q.unsure || "Not sure"
      : (() => {
        const option = q.options.find((o) => o.id === answers[q.id]);
        return option?.chip || option?.label || answers[q.id];
      })(),
  }));

  return { ...now, next, optional, asked, questions, view: settings };
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
      "depending on the questions not answered yet.");
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
  // Past a cap you said was used up: say why the rate is low.
  const used = card.earn.find((rule) => rule.cap && rule.rate > stat.rate &&
    ruleCovers(rule, card, purchase) && answers[capQuestionId(card, rule.cap)] === "over");
  if (used) {
    lines.push(`Past its $${used.cap.spend.toLocaleString("en-CA")} ${used.cap.per === "month" ? "monthly" : "yearly"} ` +
      `cap, so ${formatRate(card.points, stat.rate)} instead of ${formatRate(card.points, used.rate)}.`);
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

// Longest first, so "SimplyCash Preferred Card from American Express" loses
// the whole "from American Express" before "American Express" alone is
// considered.
const SHORTEN = [
  [/\s+Card\s+from\s+American\s+Express$/i, " (Amex)"],
  [/\s+from\s+American\s+Express$/i, " (Amex)"],
  [/^American\s+Express\s+/i, "Amex "],
  [/^Scotiabank\s+/i, "Scotia "],
  [/\s+American\s+Express(\s+Card)?$/i, " Amex"],
  [/\s+Visa\s+Infinite\+?/i, " VI"],
  [/\s+Mastercard$/i, ""],
  [/\s+(Credit\s+)?Card$/i, ""],
];

/**
 * A name that fits one line on a phone: the card's own `short` from the
 * data file when it has one, otherwise the issuer's long form trimmed
 * ("American Express Aeroplan Card" -> "Amex Aeroplan"). The full name is
 * still shown on hover and in Details. Cards entered by hand keep their
 * own name.
 */
export function shortName(card) {
  if (card?.short) return card.short;
  // A name typed in by hand is already the name its owner wants.
  if (card?.custom) return String(card.name || "");
  let name = String(card?.name || "").trim();
  for (const [pattern, replacement] of SHORTEN) name = name.replace(pattern, replacement).trim();
  return name || String(card?.name || "");
}

/**
 * The last day a cap answer holds: the end of the calendar month for a
 * monthly cap, the end of the calendar year for a yearly one. `today` is a
 * local "YYYY-MM-DD". (Some cards count by statement or card year; the
 * calendar is the closest thing everyone shares.)
 */
export function capAnswerUntil(per, today) {
  const [y, m] = today.split("-").map(Number);
  if (per === "month") {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  return `${y}-12-31`;
}

/**
 * Saved cap answers still in force today, as plain answers
 * ({ questionId: "under" | "over" }). Saved ones look like
 * { questionId: { value, until } }; anything odd or past its date is dropped.
 */
export function savedCapAnswers(saved, today) {
  const out = {};
  for (const [id, entry] of Object.entries(saved || {})) {
    if (!id.startsWith("cap:") || !entry || !["under", "over"].includes(entry.value)) continue;
    if (typeof entry.until !== "string" || entry.until < today) continue;
    out[id] = entry.value;
  }
  return out;
}
