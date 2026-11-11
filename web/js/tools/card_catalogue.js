// The Canadian credit cards Card Rewards knows about, and how each earns.
//
// The cards themselves are data, not code: web/data/cards.json, downloaded
// by the app each time Card Rewards opens (card_feed.js), like an exchange
// rate feed.
// A scheduled Claude Code task re-checks every card once a week and
// commits the file to the `card-data` branch only; the daily Pages deploy
// copies it in from there, after the tests have validated it. Nothing
// about it is ever pushed to main by that task. See CLAUDE.md, "Card
// Rewards".
//
// What is fixed here in code is what the logic depends on: the purchase
// types and the card networks. Point types live in the data file, so a new
// card can bring a new kind of points without a code change.
//
// The data file: { checked, pointTypes, cards, offers?, tiers? }
//   checked: "YYYY-MM-DD", the newest card's `checked`
//   pointTypes: { id: { name, unit: "points" | "percent", cents?, note? } }
//     cents: what one point is worth in CAD cents, at the LOW END of
//     published valuations for a normal redemption (at explicit user
//     request): Aeroplan, and Membership Rewards moved to it 1:1, at an
//     economy-flight value (1.1); Scene+ and Avion at their fixed travel
//     rate; PC Optimum at the till. Not gift cards or merchandise, which
//     are worth less still. People can change it on the page; cash back is
//     always 1 cent per percent.
//     transfers: { otherPointTypeId: ratio } - what one point becomes when
//     moved to another program in the list (Membership Rewards to Aeroplan
//     is 1). Used when someone picks preferred points on the page.
//   cards: [card]
//   offers: [offer] - special events and limited-time offers found during the
//     weekly check (at explicit user request), shown in their own section
//     below the results, with a small tag on the cards they are about.
//
//   tiers: the Tier list tab's published ranking, reviewed by the twice-weekly
//     Card Rewards check (at explicit user request) and moved only for a
//     clear reason:
//     { updated, source, tiers: [{ id, label, cards: [{ card, why }] }] },
//     best tier first; each card id at most once. People can move cards
//     between tiers on their own device.
//
// An offer:
//   id, title, detail (one or two plain sentences), starts and ends
//   ("YYYY-MM-DD", inclusive; ends is required, so an offer never lingers),
//   and what it is about, any of: cards (card ids), points (point type ids),
//   shops (shop names as in merchants.js). One with none of these is shown
//   to everyone, and so is one with everyone: true (anyone can take part
//   without the card, like a Shoppers PC Optimum event; the cards and
//   points it names are still tagged). source: named, never linked.
//
// A card:
//   id, name, issuer, network ("amex" | "visa" | "mastercard"),
//   points (a pointTypes id), annualFee and fxFee (CAD, fraction),
//   base: what every purchase earns when no rule matches,
//   earn: rules, checked in order, the first that matches wins:
//     on: purchase ids (PURCHASES), "*" for every purchase, or "picks" for
//         the categories the cardholder chose (see `picks` below)
//     rate: points per $1, or percent for cash back
//     when: answers that must hold, e.g. { store: ["loblaw"] }. A key that
//         is not asked for this purchase never holds. `flag` is a yes/no the
//         cardholder sets once on the card (see `flags`).
//     cap: { key, spend, per: "month" | "year", label } - past it the rule
//         stops matching. Rules sharing a key share the cap.
//   picks: { count, from, label, covers?, labels? } - categories the
//     cardholder chooses. An id in `from` is a purchase id, or anything
//     named in `labels` (Tangerine's "foreign" currency choice). covers maps
//     a choice to the purchases it counts for ({ transit: ["transit",
//     "parking"] }, since Tangerine's is "public transportation and
//     parking"); labels names a choice when the purchase label would not.
//   A rule may carry pick: a choice id - it only applies once that choice
//     is picked (Tangerine's 2% on foreign currency, on "*").
//   flags: [{ id, label }] - yes/no facts about the cardholder
//   notes: things the rules cannot say
//   source, checked: where the figures came from (named, never linked - the
//     privacy test allows no third party host) and when (YYYY-MM-DD)
//   perks (optional): the card's benefits beyond earning, for My cards (at
//     explicit user request: "a full list of perks") - [{ kind, text }],
//     kind one of "travel" (bags, lounges, credits, transfers), "insurance",
//     "everyday" (anything else: roadside help, gas savings, concierge).
//     One plain line each; amounts only where the issuer or two sources
//     agree, otherwise the perk without the number.
//   feeChange (optional): an announced annual fee change, for My cards -
//     { fee, from, detail? }: the new yearly fee (CAD), charged from the first
//     renewal on or after `from` ("YYYY-MM-DD"). annualFee stays the fee
//     today until the change has happened for everyone.
//   welcome (optional): the current sign-up offer, for Welcome Bonuses -
//     { points?, cash?, minSpend, months, firstYearFee?, ends?, detail,
//       source, checked }. points are the card's own points, cash is CAD;
//     minSpend (CAD) within months of opening; firstYearFee when the offer
//     changes it (0 when waived), else the card's annualFee applies; ends
//     ("YYYY-MM-DD") when the offer has a known last day; detail is one plain
//     sentence ("Up to 15,000 points: 1,250 a month for each month you spend
//     $750"). An offer paid out monthly is counted at its full amount, with
//     minSpend the total over those months.

export const PURCHASES = [
  { id: "groceries", label: "Groceries" },
  { id: "dining", label: "Restaurants, bars and coffee" },
  { id: "delivery", label: "Food delivery (Uber Eats, DoorDash, Skip)" },
  { id: "gas", label: "Gas" },
  { id: "ev", label: "EV charging" },
  { id: "transit", label: "Transit, taxis and rideshare" },
  { id: "parking", label: "Parking" },
  { id: "streaming", label: "Streaming (Netflix, Spotify, Crave)" },
  { id: "digital", label: "Apps, games and digital media" },
  { id: "bills", label: "Recurring bills (phone, internet, utilities, insurance)" },
  { id: "drugstore", label: "Drugstore" },
  { id: "wellness", label: "Gyms, spas and wellness" },
  { id: "entertainment", label: "Movies, concerts and events" },
  { id: "travel", label: "Flights and other travel" },
  { id: "hotels", label: "Hotels" },
  { id: "homeimprovement", label: "Home improvement (Home Depot, Rona)" },
  { id: "furniture", label: "Furniture (IKEA, The Brick)" },
  { id: "other", label: "Everything else" },
];

export const NETWORKS = {
  amex: "American Express",
  visa: "Visa",
  mastercard: "Mastercard",
};

// The loaded catalogue. These are live bindings: every module importing
// them sees the new values after setCatalogue(). Empty until the data file
// has been loaded once.
export let CATALOGUE_CHECKED = "";
export let POINT_TYPES = {};
export let CARDS = [];
export let OFFERS = [];
export let TIERS = null;

/** Swap in a catalogue. Validate it first (validateCatalogue). */
export function setCatalogue(data) {
  CATALOGUE_CHECKED = data?.checked || "";
  POINT_TYPES = data?.pointTypes || {};
  CARDS = Array.isArray(data?.cards) ? data.cards : [];
  OFFERS = Array.isArray(data?.offers) ? data.offers : [];
  TIERS = data?.tiers && Array.isArray(data.tiers.tiers) ? data.tiers : null;
}
