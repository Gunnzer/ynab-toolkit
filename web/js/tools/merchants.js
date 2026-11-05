// Common Canadian shops, so a purchase can be found by where it happens
// ("Dollarama", "Esso") instead of by category. Picking one sets the
// purchase type and answers whatever the shop already settles (which
// grocery chain, which gas station, booking with Air Canada), so those
// questions are never asked.
//
// `purchase` is a PURCHASES id; `answers` maps QUESTIONS ids to option ids
// and is checked against them by the tests. Where a shop is not a
// supermarket (Walmart, dollar stores) it is "other": that is how card
// networks code it, whatever is in the basket. Only well-known facts go
// in `answers` - anything doubtful is left for the questions to ask.

// Every shop here charges Canadian dollars (bookings aside), so currency is
// never a question once a shop is picked.
const CAD = { currency: "cad" };
const GROCER = (name, store, aliases = []) => ({ name, purchase: "groceries", answers: { ...CAD, store }, aliases });
const GAS = (name, station, aliases = []) => ({ name, purchase: "gas", answers: { ...CAD, station }, aliases });
const DRUG = (name, pharmacy, aliases = []) => ({ name, purchase: "drugstore", answers: { ...CAD, pharmacy }, aliases });
const AT = (purchase) => (name, aliases = []) => ({ name, purchase, answers: { ...CAD }, aliases });

const dining = AT("dining");
const delivery = AT("delivery");
const transit = AT("transit");
const streaming = AT("streaming");
const bills = AT("bills");
const fun = AT("entertainment");
const ev = AT("ev");
const other = AT("other");
const travel = (name, booking = "other-travel", aliases = []) =>
  ({ name, purchase: "travel", answers: { booking }, aliases });

export const MERCHANTS = [
  // Loblaw banners: where PC Optimum's grocery rate applies.
  GROCER("Real Canadian Superstore", "loblaw", ["superstore", "rcss"]),
  GROCER("No Frills", "loblaw", ["nofrills"]),
  GROCER("Loblaws", "loblaw"),
  GROCER("Zehrs", "loblaw"),
  GROCER("Fortinos", "loblaw"),
  GROCER("Provigo", "loblaw"),
  GROCER("Maxi", "loblaw"),
  GROCER("Valu-mart", "loblaw", ["valumart"]),
  GROCER("Your Independent Grocer", "loblaw", ["independent", "yig"]),
  GROCER("Atlantic Superstore", "loblaw"),
  GROCER("Dominion", "loblaw"),
  GROCER("Extra Foods", "loblaw"),
  // Sobeys banners: where Scene+ cards earn their top grocery rate.
  GROCER("Sobeys", "sobeys"),
  GROCER("Safeway", "sobeys"),
  GROCER("IGA", "sobeys"),
  GROCER("FreshCo", "sobeys"),
  GROCER("Foodland", "sobeys"),
  GROCER("Thrifty Foods", "sobeys", ["thrifty"]),
  GROCER("Voila", "sobeys", ["voila by sobeys"]),
  GROCER("Metro", "grocer"),
  GROCER("Food Basics", "grocer"),
  GROCER("Super C", "grocer"),
  GROCER("Save-On-Foods", "grocer", ["save on", "saveon"]),
  GROCER("Farm Boy", "grocer"),
  GROCER("Longo's", "grocer", ["longos"]),
  // Loblaw-owned, and like the Loblaw banners it does not take Amex.
  { ...GROCER("T&T Supermarket", "grocer", ["t and t", "tnt"]), answers: { ...CAD, store: "grocer", amex: "no" } },
  GROCER("Whole Foods", "grocer"),
  GROCER("Co-op", "grocer", ["coop", "co op"]),
  GROCER("Costco", "costco", ["costco wholesale"]),
  // Not supermarkets, whatever is in the basket.
  other("Walmart", ["wal mart"]),
  other("Giant Tiger"),
  // Takes Amex since 2017 (Dollarama's own announcement).
  { ...other("Dollarama", ["dollar store"]), answers: { ...CAD, amex: "yes" } },
  other("Dollar Tree", ["dollar store"]),

  GAS("Esso", "esso"),
  GAS("Mobil", "esso"),
  GAS("Costco Gas", "costco"),
  GAS("Petro-Canada", "other-station", ["petro", "petrocan", "petro canada"]),
  GAS("Shell", "other-station"),
  GAS("Canadian Tire Gas+", "other-station", ["ct gas", "gas bar"]),
  GAS("Husky", "other-station"),
  GAS("Ultramar", "other-station"),
  GAS("Chevron", "other-station"),
  GAS("Pioneer", "other-station"),
  GAS("Circle K", "other-station", ["couche-tard", "couche tard"]),
  GAS("Irving", "other-station"),

  DRUG("Shoppers Drug Mart", "shoppers", ["shoppers", "sdm"]),
  DRUG("Pharmaprix", "shoppers"),
  DRUG("Rexall", "other-pharmacy"),
  DRUG("London Drugs", "other-pharmacy"),
  DRUG("Jean Coutu", "other-pharmacy"),
  DRUG("Uniprix", "other-pharmacy"),
  DRUG("Lawtons", "other-pharmacy"),
  DRUG("Guardian", "other-pharmacy"),

  dining("Tim Hortons", ["tims", "timmies"]),
  dining("Starbucks"),
  dining("McDonald's", ["mcdonalds", "mcds"]),
  dining("A&W", ["a and w"]),
  dining("Subway"),
  dining("Harvey's", ["harveys"]),
  dining("Swiss Chalet"),
  dining("Boston Pizza"),
  dining("Pizza Pizza"),
  dining("Mary Brown's", ["mary browns"]),
  dining("Second Cup"),
  dining("The Keg", ["keg"]),

  delivery("Uber Eats", ["ubereats"]),
  delivery("DoorDash", ["door dash"]),
  delivery("SkipTheDishes", ["skip", "skip the dishes"]),

  transit("Uber", ["uber ride"]),
  transit("Lyft"),
  transit("Presto"),
  transit("Compass Card", ["compass", "translink"]),
  transit("TTC"),
  transit("GO Transit", ["go train", "go bus"]),
  transit("OC Transpo"),
  transit("STM"),
  transit("VIA Rail", ["via"]),

  streaming("Netflix"),
  streaming("Spotify"),
  streaming("Crave"),
  streaming("Disney+", ["disney plus"]),
  streaming("Prime Video", ["amazon prime video"]),
  streaming("Apple TV+", ["apple tv"]),
  streaming("Apple Music"),
  streaming("YouTube Premium", ["youtube"]),

  bills("Rogers"),
  bills("Bell"),
  bills("Telus"),
  bills("Fido"),
  bills("Koodo"),
  bills("Virgin Plus", ["virgin"]),
  bills("Freedom Mobile", ["freedom"]),
  bills("Shaw"),
  bills("Videotron"),
  bills("Hydro One", ["hydro"]),
  bills("Enbridge"),
  bills("BC Hydro"),

  travel("Air Canada", "air-canada", ["ac", "aircanada"]),
  travel("Air Canada Vacations", "air-canada"),
  travel("Expedia For TD", "expedia"),
  travel("WestJet"),
  travel("Porter"),
  travel("Flair"),
  travel("Expedia"),
  travel("Booking.com", "other-travel", ["booking"]),
  travel("Airbnb"),
  travel("Marriott"),
  travel("Hilton"),

  fun("Cineplex"),
  fun("Landmark Cinemas", ["landmark"]),
  fun("Ticketmaster"),

  ev("Tesla Supercharger", ["tesla"]),
  ev("FLO"),
  ev("Electrify Canada"),
  ev("ChargePoint"),
  ev("Petro-Canada EV", ["petro ev"]),

  other("Amazon.ca", ["amazon"]),
  other("Canadian Tire", ["ct"]),
  other("Home Depot"),
  other("Lowe's", ["lowes", "rona"]),
  other("Best Buy"),
  other("IKEA"),
  other("Winners", ["homesense", "marshalls"]),
  other("Indigo", ["chapters"]),
  other("Sport Chek", ["sportchek"]),
  other("Lululemon"),
  other("Apple Store", ["apple"]),
  other("Staples"),
  other("Hudson's Bay", ["the bay", "hbc"]),
  other("Simons"),
  other("Old Navy"),
];

/** Lower case, accents and punctuation gone, spaces collapsed. */
export function normalise(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();
}

/**
 * Shops matching what has been typed, best first: a name or nickname that
 * starts with it, then one with a word starting with it, then one that
 * contains it anywhere. A shop matched by a nickname ranks the same as by
 * its name. `extra` are more shops to search, such as ones you typed in.
 */
export function searchMerchants(query, limit = 6, extra = []) {
  const q = normalise(query);
  if (!q) return [];
  const squashed = q.replace(/ /g, "");
  const scored = [];
  for (const merchant of [...MERCHANTS, ...extra]) {
    let best = 0;
    for (const label of [merchant.name, ...(merchant.aliases || [])]) {
      const text = normalise(label);
      const flat = text.replace(/ /g, "");
      let score = 0;
      if (text === q || flat === squashed) score = 4;
      else if (text.startsWith(q) || flat.startsWith(squashed)) score = 3;
      else if (text.split(" ").some((word) => word.startsWith(q))) score = 2;
      else if (q.length >= 3 && (text.includes(q) || flat.includes(squashed))) score = 1;
      best = Math.max(best, score);
    }
    if (best) scored.push({ merchant, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.merchant.name.length - b.merchant.name.length ||
    a.merchant.name.localeCompare(b.merchant.name));
  return scored.slice(0, limit).map((s) => s.merchant);
}

/** The shop with exactly this name, ignoring case and punctuation. */
export function merchantByName(name) {
  const q = normalise(name);
  return MERCHANTS.find((m) => normalise(m.name) === q) || null;
}
