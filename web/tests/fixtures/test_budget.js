// A fake but realistic YNAB budget, shaped exactly like the YNAB API's own
// objects (Budget, Account, CategoryGroup/Category, MonthDetail,
// TransactionDetail/SubTransaction). Reuse this instead of hand-writing a
// throwaway fixture inline - real tests get real coverage, and every test
// runs against the same known scenarios instead of a slightly different
// one each time.
//
// It's modelled as a "YNAB Together" shared budget between two fictional
// people, Alex and Sam: each has their own checking account and credit
// card (account names tagged "(A)"/"(S)", matching this app's account-tag
// convention), plus a joint checking account and joint credit card tagged
// "(J)". Category groups follow the same convention this app already
// reads: "Alex ..." / "Sam ..." group names mean that person's own
// spending, everything else is shared.
//
// Three months of data are included: 2026-06 and 2026-07 are full months,
// 2026-08 is partial (as if "today" were early August), so tools that
// treat the current month specially have something realistic to chew on.
//
// One thing this fixture deliberately does NOT do: make the MONTHS category
// totals sum exactly to the TRANSACTIONS list for that month. Both were
// authored by hand for scenario coverage (each on its own is internally
// varied and realistic), not reconciled penny-for-penny against each
// other - real budgets drift for reasons an API snapshot does not capture
// either (pending transactions, manual category moves), so tools should
// not assume the two agree, and this fixture does not pretend they do.

const m = (dollars) => Math.round(dollars * 1000);

// ---------- budget ----------

export const BUDGET = {
  id: "budget-fixture-1",
  name: "Test Budget",
  last_modified_on: "2026-08-07T12:00:00Z",
  first_month: "2026-01-01",
  last_month: "2026-08-01",
  date_format: { format: "YYYY-MM-DD" },
  currency_format: {
    iso_code: "USD",
    example_format: "123,456.78",
    decimal_digits: 2,
    decimal_separator: ".",
    symbol_first: true,
    group_separator: ",",
    currency_symbol: "$",
    display_symbol: true,
  },
};

// ---------- accounts ----------
//
// Two personal checking accounts, two personal credit cards, one joint
// checking, one joint credit card, one shared savings account with no tag
// (exercises the "no tag at all" fallback), and one closed credit card so
// account-list filtering has something to exclude.

export const ACCOUNTS = [
  {
    id: "acct-alex-checking", name: "(A) Alex Checking", type: "checking",
    on_budget: true, closed: false, note: null,
    balance: m(2450.00), cleared_balance: m(2450.00), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-alex-checking", deleted: false,
  },
  {
    id: "acct-sam-checking", name: "(S) Sam Checking", type: "checking",
    on_budget: true, closed: false, note: null,
    balance: m(1780.00), cleared_balance: m(1780.00), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-sam-checking", deleted: false,
  },
  {
    id: "acct-joint-checking", name: "(J) Joint Checking", type: "checking",
    on_budget: true, closed: false, note: "Bills and shared groceries",
    balance: m(3200.00), cleared_balance: m(3050.00), uncleared_balance: m(150.00),
    transfer_payee_id: "payee-xfer-joint-checking", deleted: false,
  },
  {
    id: "acct-alex-visa", name: "(A) Alex Visa", type: "creditCard",
    on_budget: true, closed: false, note: null,
    balance: m(-450.00), cleared_balance: m(-450.00), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-alex-visa", deleted: false,
  },
  {
    id: "acct-sam-mc", name: "(S) Sam Mastercard", type: "creditCard",
    on_budget: true, closed: false, note: null,
    balance: m(-120.00), cleared_balance: m(-120.00), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-sam-mc", deleted: false,
  },
  {
    id: "acct-joint-cc", name: "(J) Joint Credit Card", type: "creditCard",
    on_budget: true, closed: false, note: null,
    balance: m(-680.00), cleared_balance: m(-590.00), uncleared_balance: m(-90.00),
    transfer_payee_id: "payee-xfer-joint-cc", deleted: false,
  },
  {
    // No "(X)" tag at all: exercises the "no group, no tag" shared fallback
    // in ownerOf() rather than every account being explicitly owned.
    id: "acct-emergency-savings", name: "Emergency Savings", type: "savings",
    on_budget: true, closed: false, note: null,
    balance: m(5000.00), cleared_balance: m(5000.00), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-emergency-savings", deleted: false,
  },
  {
    id: "acct-old-card", name: "Old Card (Closed)", type: "creditCard",
    on_budget: true, closed: true, note: "Cancelled 2025",
    balance: m(0), cleared_balance: m(0), uncleared_balance: m(0),
    transfer_payee_id: "payee-xfer-old-card", deleted: false,
  },
];

// ---------- category groups ----------
//
// Includes the "Internal Master Category" / "Inflow: Ready to Assign" pair
// every real YNAB budget has, and a hidden group with a hidden category,
// so hidden-category filtering has something real to filter.

export const CATEGORY_GROUPS = [
  {
    id: "cg-internal", name: "Internal Master Category", hidden: false, deleted: false,
    categories: [
      {
        id: "cat-inflow", category_group_id: "cg-internal",
        name: "Inflow: Ready to Assign", hidden: false, deleted: false,
      },
    ],
  },
  {
    id: "cg-alex", name: "Alex Variable Expenses", hidden: false, deleted: false,
    categories: [
      { id: "cat-dining", category_group_id: "cg-alex", name: "Dining Out", hidden: false, deleted: false },
      { id: "cat-personal-care", category_group_id: "cg-alex", name: "Personal Care", hidden: false, deleted: false },
      { id: "cat-hobbies", category_group_id: "cg-alex", name: "Hobbies", hidden: false, deleted: false },
    ],
  },
  {
    id: "cg-sam", name: "Sam Variable Expenses", hidden: false, deleted: false,
    categories: [
      { id: "cat-coffee", category_group_id: "cg-sam", name: "Coffee & Snacks", hidden: false, deleted: false },
      { id: "cat-gym", category_group_id: "cg-sam", name: "Gym Membership", hidden: false, deleted: false },
      { id: "cat-subscriptions", category_group_id: "cg-sam", name: "Subscriptions", hidden: false, deleted: false },
    ],
  },
  {
    id: "cg-shared-bills", name: "Shared Bills", hidden: false, deleted: false,
    categories: [
      { id: "cat-rent", category_group_id: "cg-shared-bills", name: "Rent", hidden: false, deleted: false },
      { id: "cat-electric", category_group_id: "cg-shared-bills", name: "Electric", hidden: false, deleted: false },
      { id: "cat-internet", category_group_id: "cg-shared-bills", name: "Internet", hidden: false, deleted: false },
      { id: "cat-groceries", category_group_id: "cg-shared-bills", name: "Groceries", hidden: false, deleted: false },
      { id: "cat-transportation", category_group_id: "cg-shared-bills", name: "Transportation", hidden: false, deleted: false },
    ],
  },
  {
    id: "cg-savings", name: "Savings Goals", hidden: false, deleted: false,
    categories: [
      { id: "cat-emergency", category_group_id: "cg-savings", name: "Emergency Fund", hidden: false, deleted: false },
      { id: "cat-vacation", category_group_id: "cg-savings", name: "Vacation Fund", hidden: false, deleted: false },
    ],
  },
  {
    id: "cg-old", name: "Old Subscriptions", hidden: true, deleted: false,
    categories: [
      { id: "cat-unused-gym", category_group_id: "cg-old", name: "Unused Gym (cancel this)", hidden: true, deleted: false },
    ],
  },
];

// ---------- months ----------
//
// June is messy (three categories overspent), July mostly recovers, August
// is a partial month (as if "today" is early August) so several categories
// still show little or no activity - a good grey/neutral test case.

function monthCategories(figures) {
  return Object.entries(figures).map(([id, f]) => ({
    id,
    category_group_id: CATEGORY_GROUPS.find(
      (g) => g.categories.some((c) => c.id === id)).id,
    name: CATEGORY_GROUPS.flatMap((g) => g.categories).find((c) => c.id === id).name,
    hidden: id === "cat-unused-gym",
    deleted: false,
    budgeted: m(f.budgeted),
    activity: m(f.activity),
    balance: m(f.budgeted + f.activity),
    goal_type: f.goalType || null,
    goal_target: f.goalTarget ? m(f.goalTarget) : null,
    goal_target_month: f.goalTargetMonth || null,
    goal_overall_funded: f.goalFunded !== undefined ? m(f.goalFunded) : null,
    goal_under_funded: f.goalTarget !== undefined
      ? m(Math.max(0, f.goalTarget - (f.goalFunded || 0))) : null,
  }));
}

export const MONTHS = {
  "2026-06": {
    month: "2026-06-01", note: null,
    income: m(4500.00), budgeted: m(3720.00), activity: m(-3458.80),
    to_be_budgeted: m(780.00), age_of_money: 24, deleted: false,
    categories: monthCategories({
      "cat-inflow": { budgeted: 0, activity: 4500.00 },
      "cat-dining": { budgeted: 150, activity: -180.00 },       // overspent
      "cat-personal-care": { budgeted: 60, activity: -60.00 },  // exactly on
      "cat-hobbies": { budgeted: 40, activity: 0 },              // zero activity
      "cat-coffee": { budgeted: 50, activity: -42.00 },          // under
      "cat-gym": { budgeted: 45, activity: -45.00 },             // exactly on
      "cat-subscriptions": { budgeted: 25, activity: -25.00 },   // exactly on
      "cat-rent": { budgeted: 1800, activity: -1800.00 },        // exactly on
      "cat-electric": { budgeted: 120, activity: -137.50 },      // overspent, has cents
      "cat-internet": { budgeted: 80, activity: -80.00 },        // exactly on
      "cat-groceries": { budgeted: 900, activity: -975.30 },     // overspent, has cents
      "cat-transportation": { budgeted: 150, activity: -104.00 },
      "cat-emergency": {
        budgeted: 200, activity: 0, goalType: "TB",
        goalTarget: 1000, goalFunded: 400,
      },
      "cat-vacation": {
        budgeted: 100, activity: 0, goalType: "TBD",
        goalTarget: 600, goalTargetMonth: "2026-12-01", goalFunded: 200,
      },
      "cat-unused-gym": { budgeted: 0, activity: -10.00 },
    }),
  },
  "2026-07": {
    month: "2026-07-01", note: null,
    income: m(4500.00), budgeted: m(3745.00), activity: m(-3060.51),
    to_be_budgeted: m(755.00), age_of_money: 27, deleted: false,
    categories: monthCategories({
      "cat-inflow": { budgeted: 0, activity: 4500.00 },
      "cat-dining": { budgeted: 150, activity: -120.00 },        // recovered, under
      "cat-personal-care": { budgeted: 60, activity: -75.00 },   // now overspent
      "cat-hobbies": { budgeted: 40, activity: -40.00 },         // exactly on
      "cat-coffee": { budgeted: 50, activity: -50.00 },          // exactly on
      "cat-gym": { budgeted: 45, activity: -45.00 },
      "cat-subscriptions": { budgeted: 25, activity: -25.00 },
      "cat-rent": { budgeted: 1800, activity: -1800.00 },
      "cat-electric": { budgeted: 130, activity: -128.00 },      // fixed, under
      "cat-internet": { budgeted: 80, activity: -80.00 },
      "cat-groceries": { budgeted: 950, activity: -890.15 },     // fixed, under
      "cat-transportation": { budgeted: 150, activity: -58.00 },
      "cat-emergency": {
        budgeted: 200, activity: 0, goalType: "TB",
        goalTarget: 1000, goalFunded: 600,
      },
      "cat-vacation": {
        budgeted: 100, activity: 0, goalType: "TBD",
        goalTarget: 600, goalTargetMonth: "2026-12-01", goalFunded: 300,
      },
      "cat-unused-gym": { budgeted: 0, activity: 0 },
    }),
  },
  "2026-08": {
    month: "2026-08-01", note: null,
    income: m(2200.00), budgeted: m(3745.00), activity: m(-2463.60),
    to_be_budgeted: m(-1545.00), age_of_money: 30, deleted: false,
    categories: monthCategories({
      "cat-inflow": { budgeted: 0, activity: 2200.00 },
      "cat-dining": { budgeted: 150, activity: -25.00 },         // early month, mostly untouched
      "cat-personal-care": { budgeted: 60, activity: 0 },        // zero activity - grey case
      "cat-hobbies": { budgeted: 40, activity: -40.00 },         // exactly on - grey case
      "cat-coffee": { budgeted: 50, activity: -18.00 },
      "cat-gym": { budgeted: 45, activity: -45.00 },
      "cat-subscriptions": { budgeted: 25, activity: -25.00 },
      "cat-rent": { budgeted: 1800, activity: -1800.00 },
      "cat-electric": { budgeted: 130, activity: 0 },            // not billed yet this month
      "cat-internet": { budgeted: 80, activity: -80.00 },
      "cat-groceries": { budgeted: 900, activity: -410.60 },     // partial month
      "cat-transportation": { budgeted: 150, activity: 0 },
      "cat-emergency": {
        budgeted: 200, activity: 0, goalType: "TB",
        goalTarget: 1000, goalFunded: 800,
      },
      "cat-vacation": {
        budgeted: 100, activity: 0, goalType: "TBD",
        goalTarget: 600, goalTargetMonth: "2026-12-01", goalFunded: 400,
      },
      "cat-unused-gym": { budgeted: 0, activity: 0 },
    }),
  },
};

// ---------- transactions ----------
//
// Three months, mixed across every account. Deliberately includes:
//  - a split transaction (subtransactions across two categories)
//  - two transfer pairs (a plain account-to-account move, and a credit
//    card payment), each leg a separate transaction the way the real API
//    returns them
//  - an Interac e-transfer pair matching this app's default payee rules
//  - a same-day, same-amount, different-account near-duplicate pair
//  - a flagged transaction (flag_color set)
//  - a deleted transaction
//  - a transaction filed under the hidden category
//  - unapproved and uncleared transactions

export const TRANSACTIONS = [
  // ---- June 2026 ----
  {
    id: "txn-2026-06-01-rent", date: "2026-06-01", amount: m(-1800.00),
    memo: "June rent", cleared: "reconciled", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-landlord", payee_name: "Landlord LLC",
    category_id: "cat-rent", category_name: "Rent",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-02-groceries", date: "2026-06-02", amount: m(-145.32),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-whole-foods", payee_name: "Whole Foods",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-03-coffee", date: "2026-06-03", amount: m(-6.75),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-blue-bottle", payee_name: "Blue Bottle Coffee",
    category_id: "cat-coffee", category_name: "Coffee & Snacks",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-04-dining", date: "2026-06-04", amount: m(-18.42),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-chipotle", payee_name: "Chipotle Mexican Grill",
    category_id: "cat-dining", category_name: "Dining Out",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-04-hobbies", date: "2026-06-04", amount: m(-32.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-amc", payee_name: "AMC Theatres",
    category_id: "cat-hobbies", category_name: "Hobbies",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-05-electric", date: "2026-06-05", amount: m(-137.50),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-electric", payee_name: "City Electric Co",
    category_id: "cat-electric", category_name: "Electric",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-05-internet", date: "2026-06-05", amount: m(-80.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-comcast", payee_name: "Comcast Internet",
    category_id: "cat-internet", category_name: "Internet",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-06-gym", date: "2026-06-06", amount: m(-45.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-planet-fitness", payee_name: "Planet Fitness",
    category_id: "cat-gym", category_name: "Gym Membership",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-06-netflix", date: "2026-06-06", amount: m(-15.49),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-netflix", payee_name: "Netflix",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-06-spotify", date: "2026-06-06", amount: m(-9.51),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-spotify", payee_name: "Spotify",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    // Split transaction: parent has no single category, subtransactions
    // carry their own category_id each - the shape split_sheet.js's
    // fromApi() and this app's other tools read for real split handling.
    id: "txn-2026-06-07-costco", date: "2026-06-07", amount: m(-212.18),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-costco", payee_name: "Costco Wholesale",
    category_id: null, category_name: "Split (Multiple Categories)",
    transfer_account_id: null, deleted: false,
    subtransactions: [
      {
        id: "sub-2026-06-07-costco-1", transaction_id: "txn-2026-06-07-costco",
        amount: m(-180.18), memo: "groceries portion",
        payee_id: "payee-costco", payee_name: "Costco Wholesale",
        category_id: "cat-groceries", category_name: "Groceries",
        transfer_account_id: null, deleted: false,
      },
      {
        id: "sub-2026-06-07-costco-2", transaction_id: "txn-2026-06-07-costco",
        amount: m(-32.00), memo: "toiletries",
        payee_id: "payee-costco", payee_name: "Costco Wholesale",
        category_id: "cat-personal-care", category_name: "Personal Care",
        transfer_account_id: null, deleted: false,
      },
    ],
  },
  {
    id: "txn-2026-06-08-personal-care", date: "2026-06-08", amount: m(-28.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-cvs", payee_name: "CVS Pharmacy",
    category_id: "cat-personal-care", category_name: "Personal Care",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-09-trader-joes", date: "2026-06-09", amount: m(-230.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-trader-joes", payee_name: "Trader Joe's",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-09-butcher", date: "2026-06-09", amount: m(-120.18),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-butcher", payee_name: "Local Butcher Shop",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  // Plain transfer pair: same money, two legs, no category on either side.
  {
    id: "txn-2026-06-10-xfer-out", date: "2026-06-10", amount: m(-300.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-xfer-joint-checking", payee_name: "Transfer : (J) Joint Checking",
    category_id: null, category_name: null,
    transfer_account_id: "acct-joint-checking",
    transfer_transaction_id: "txn-2026-06-10-xfer-in", deleted: false,
  },
  {
    id: "txn-2026-06-10-xfer-in", date: "2026-06-10", amount: m(300.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-xfer-alex-checking", payee_name: "Transfer : (A) Alex Checking",
    category_id: null, category_name: null,
    transfer_account_id: "acct-alex-checking",
    transfer_transaction_id: "txn-2026-06-10-xfer-out", deleted: false,
  },
  // Interac e-transfer pair: NOT a system transfer (no transfer_account_id)
  // because the two personal banks aren't linked, only tracked in the same
  // budget - this is the shape this app's default bank-import payee rules
  // are written to match.
  {
    id: "txn-2026-06-12-etransfer-sent", date: "2026-06-12", amount: m(-400.00),
    memo: "half of June rent", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-etransfer-alex", payee_name: "INTERAC e-Transfer sent to: Alex Jones",
    category_id: "cat-rent", category_name: "Rent",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-12-etransfer-received", date: "2026-06-12", amount: m(400.00),
    memo: "half of June rent", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-etransfer-sam", payee_name: "INTERAC e-Transfer received from: Sam Smith",
    category_id: null, category_name: null,
    transfer_account_id: null, deleted: false,
  },
  // Near-duplicate pair: same day, same amount, different account, payee
  // text differs only in noise - the exact shape the Duplicates tool looks
  // for, and a realistic false-positive from importing the same gas
  // station charge off two different bank exports.
  {
    id: "txn-2026-06-15-gas-a", date: "2026-06-15", amount: m(-52.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-shell-a", payee_name: "Shell Gas Station #4521",
    category_id: "cat-transportation", category_name: "Transportation",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-06-15-gas-b", date: "2026-06-15", amount: m(-52.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-shell-b", payee_name: "SHELL GAS STATION 4521",
    category_id: "cat-transportation", category_name: "Transportation",
    transfer_account_id: null, deleted: false,
  },
  {
    // Flagged: a candidate for a "count this one anyway" override on an
    // otherwise-excluded account, the idea discussed for Bill Splitting.
    id: "txn-2026-06-18-bestbuy", date: "2026-06-18", amount: m(-89.99),
    memo: "", cleared: "cleared", approved: true, flag_color: "purple",
    account_id: "acct-joint-cc", account_name: "(J) Joint Credit Card",
    payee_id: "payee-bestbuy", payee_name: "Best Buy",
    category_id: "cat-hobbies", category_name: "Hobbies",
    transfer_account_id: null, deleted: false,
  },
  {
    // Deleted: tools reading the raw list need to skip this, same as YNAB.
    id: "txn-2026-06-20-refund", date: "2026-06-20", amount: m(-15.00),
    memo: "refunded, ignore", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-refund", payee_name: "Refunded Order",
    category_id: "cat-dining", category_name: "Dining Out",
    transfer_account_id: null, deleted: true,
  },
  {
    // Filed under the hidden category, so hidden-category filtering has a
    // real transaction to hide.
    id: "txn-2026-06-22-old-gym", date: "2026-06-22", amount: m(-10.00),
    memo: "final charge before cancelling", cleared: "cleared", approved: true,
    flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-old-gym", payee_name: "Old Gym Chain",
    category_id: "cat-unused-gym", category_name: "Unused Gym (cancel this)",
    transfer_account_id: null, deleted: false,
  },
  // Credit card payment: also a transfer pair, different account types.
  {
    id: "txn-2026-06-25-cc-payment-out", date: "2026-06-25", amount: m(-250.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-xfer-joint-cc", payee_name: "Transfer : (J) Joint Credit Card",
    category_id: null, category_name: null,
    transfer_account_id: "acct-joint-cc",
    transfer_transaction_id: "txn-2026-06-25-cc-payment-in", deleted: false,
  },
  {
    id: "txn-2026-06-25-cc-payment-in", date: "2026-06-25", amount: m(250.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-cc", account_name: "(J) Joint Credit Card",
    payee_id: "payee-xfer-joint-checking-2", payee_name: "Transfer : (J) Joint Checking",
    category_id: null, category_name: null,
    transfer_account_id: "acct-joint-checking",
    transfer_transaction_id: "txn-2026-06-25-cc-payment-out", deleted: false,
  },

  // ---- July 2026 ----
  {
    id: "txn-2026-07-01-rent", date: "2026-07-01", amount: m(-1800.00),
    memo: "July rent", cleared: "reconciled", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-landlord", payee_name: "Landlord LLC",
    category_id: "cat-rent", category_name: "Rent",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-02-groceries", date: "2026-07-02", amount: m(-210.44),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-whole-foods", payee_name: "Whole Foods",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-05-groceries", date: "2026-07-05", amount: m(-180.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-trader-joes", payee_name: "Trader Joe's",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-06-dining-a", date: "2026-07-06", amount: m(-60.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-chipotle", payee_name: "Chipotle Mexican Grill",
    category_id: "cat-dining", category_name: "Dining Out",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-10-dining-b", date: "2026-07-10", amount: m(-60.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-olive-garden", payee_name: "Olive Garden",
    category_id: "cat-dining", category_name: "Dining Out",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-08-personal-care", date: "2026-07-08", amount: m(-75.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-cvs", payee_name: "CVS Pharmacy",
    category_id: "cat-personal-care", category_name: "Personal Care",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-05-electric", date: "2026-07-05", amount: m(-128.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-electric", payee_name: "City Electric Co",
    category_id: "cat-electric", category_name: "Electric",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-05-internet", date: "2026-07-05", amount: m(-80.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-comcast", payee_name: "Comcast Internet",
    category_id: "cat-internet", category_name: "Internet",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-06-gym", date: "2026-07-06", amount: m(-45.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-planet-fitness", payee_name: "Planet Fitness",
    category_id: "cat-gym", category_name: "Gym Membership",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-06-netflix", date: "2026-07-06", amount: m(-15.49),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-netflix", payee_name: "Netflix",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-06-spotify", date: "2026-07-06", amount: m(-9.51),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-spotify", payee_name: "Spotify",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-12-gas", date: "2026-07-12", amount: m(-58.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-cc", account_name: "(J) Joint Credit Card",
    payee_id: "payee-shell-a", payee_name: "Shell Gas Station #4521",
    category_id: "cat-transportation", category_name: "Transportation",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-14-hobbies", date: "2026-07-14", amount: m(-40.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-steam", payee_name: "Steam Games",
    category_id: "cat-hobbies", category_name: "Hobbies",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-16-coffee", date: "2026-07-16", amount: m(-50.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-blue-bottle", payee_name: "Blue Bottle Coffee",
    category_id: "cat-coffee", category_name: "Coffee & Snacks",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-15-xfer-out", date: "2026-07-15", amount: m(-350.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-xfer-joint-checking", payee_name: "Transfer : (J) Joint Checking",
    category_id: null, category_name: null,
    transfer_account_id: "acct-joint-checking",
    transfer_transaction_id: "txn-2026-07-15-xfer-in", deleted: false,
  },
  {
    id: "txn-2026-07-15-xfer-in", date: "2026-07-15", amount: m(350.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-xfer-sam-checking", payee_name: "Transfer : (S) Sam Checking",
    category_id: null, category_name: null,
    transfer_account_id: "acct-sam-checking",
    transfer_transaction_id: "txn-2026-07-15-xfer-out", deleted: false,
  },
  {
    id: "txn-2026-07-20-etransfer-sent", date: "2026-07-20", amount: m(-64.00),
    memo: "my half of electric", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-etransfer-sam-2", payee_name: "INTERAC e-Transfer sent to: Sam Smith",
    category_id: "cat-electric", category_name: "Electric",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-07-20-etransfer-received", date: "2026-07-20", amount: m(64.00),
    memo: "my half of electric", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-etransfer-alex-2", payee_name: "INTERAC e-Transfer received from: Alex Jones",
    category_id: null, category_name: null,
    transfer_account_id: null, deleted: false,
  },

  // ---- August 2026 (partial month) ----
  {
    id: "txn-2026-08-01-rent", date: "2026-08-01", amount: m(-1800.00),
    memo: "August rent", cleared: "reconciled", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-landlord", payee_name: "Landlord LLC",
    category_id: "cat-rent", category_name: "Rent",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-03-internet", date: "2026-08-03", amount: m(-80.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-joint-checking", account_name: "(J) Joint Checking",
    payee_id: "payee-comcast", payee_name: "Comcast Internet",
    category_id: "cat-internet", category_name: "Internet",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-03-gym", date: "2026-08-03", amount: m(-45.00),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-planet-fitness", payee_name: "Planet Fitness",
    category_id: "cat-gym", category_name: "Gym Membership",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-04-netflix", date: "2026-08-04", amount: m(-15.49),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-netflix", payee_name: "Netflix",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-04-spotify", date: "2026-08-04", amount: m(-9.51),
    memo: "", cleared: "cleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-spotify", payee_name: "Spotify",
    category_id: "cat-subscriptions", category_name: "Subscriptions",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-05-dining", date: "2026-08-05", amount: m(-25.00),
    memo: "", cleared: "uncleared", approved: true, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-chipotle", payee_name: "Chipotle Mexican Grill",
    category_id: "cat-dining", category_name: "Dining Out",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-06-coffee", date: "2026-08-06", amount: m(-18.00),
    memo: "", cleared: "uncleared", approved: true, flag_color: null,
    account_id: "acct-sam-mc", account_name: "(S) Sam Mastercard",
    payee_id: "payee-blue-bottle", payee_name: "Blue Bottle Coffee",
    category_id: "cat-coffee", category_name: "Coffee & Snacks",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-06-groceries", date: "2026-08-06", amount: m(-210.60),
    memo: "", cleared: "uncleared", approved: true, flag_color: null,
    account_id: "acct-alex-checking", account_name: "(A) Alex Checking",
    payee_id: "payee-whole-foods", payee_name: "Whole Foods",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
  {
    // Unapproved as well as uncleared: the newest-looking row in the set.
    id: "txn-2026-08-07-hobbies", date: "2026-08-07", amount: m(-40.00),
    memo: "", cleared: "uncleared", approved: false, flag_color: null,
    account_id: "acct-alex-visa", account_name: "(A) Alex Visa",
    payee_id: "payee-amc", payee_name: "AMC Theatres",
    category_id: "cat-hobbies", category_name: "Hobbies",
    transfer_account_id: null, deleted: false,
  },
  {
    id: "txn-2026-08-07-groceries", date: "2026-08-07", amount: m(-200.00),
    memo: "", cleared: "uncleared", approved: true, flag_color: null,
    account_id: "acct-sam-checking", account_name: "(S) Sam Checking",
    payee_id: "payee-trader-joes", payee_name: "Trader Joe's",
    category_id: "cat-groceries", category_name: "Groceries",
    transfer_account_id: null, deleted: false,
  },
];

// ---------- Classic Budget planned amounts ----------
//
// Not a YNAB structure - this app's own local "what I meant to spend"
// figures (see classicbudget.js). Set to June's budgeted amounts, so
// against June's activity above the same overspend scenarios line up
// (Dining, Electric, Groceries over; Hobbies zero; Personal Care exact).
export const PLANNED_AMOUNTS = {
  "cat-dining": m(150), "cat-personal-care": m(60), "cat-hobbies": m(40),
  "cat-coffee": m(50), "cat-gym": m(45), "cat-subscriptions": m(25),
  "cat-rent": m(1800), "cat-electric": m(120), "cat-internet": m(80),
  "cat-groceries": m(900), "cat-transportation": m(150),
};

export const MONTH_KEYS = ["2026-06", "2026-07", "2026-08"];
