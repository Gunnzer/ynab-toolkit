// Thin client for the YNAB API v1.
//
// Calls go straight from the browser to api.ynab.com, which permits it
// (Access-Control-Allow-Origin: *). There is no server in between, so the
// token never leaves the machine it was typed on.

const BASE_URL = "https://api.ynab.com/v1";

const STATUS_HELP = {
  400: "The request was rejected as invalid.",
  401:
    "Your access token was not accepted.\n\n" +
    "Generate a fresh one at ynab.com > Account Settings > Developer " +
    "Settings > New Token, then paste it on the Setup page.",
  403:
    "Access forbidden. This usually means the token belongs to a " +
    "subscription that has lapsed, or the token was revoked.",
  404: "That budget, category or transaction no longer exists in YNAB.",
  409: "A conflict occurred - the item was changed by someone else.",
  429:
    "YNAB's rate limit was hit. Each token allows 200 requests per hour " +
    "on a rolling window. Wait a while and try again.",
  500: "YNAB reported an internal server error. Try again shortly.",
  503: "YNAB is temporarily unavailable (maintenance). Try again shortly.",
};

export class YnabError extends Error {
  constructor(message, status = null, detail = null) {
    super(detail ? `${message}\n\n${detail}` : message);
    this.name = "YnabError";
    this.shortMessage = message;
    this.status = status;
    this.detail = detail;
  }
}

export class YnabClient {
  constructor(token, onRateLimit = null) {
    this.token = (token || "").trim();
    this.onRateLimit = onRateLimit;
  }

  async request(method, path, { params, body } = {}) {
    if (!this.token) {
      throw new YnabError("No access token set. Enter one on the Setup page.");
    }

    const url = new URL(BASE_URL + path);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new YnabError(
        "Could not reach api.ynab.com. Check your internet connection.",
        null,
        String(cause)
      );
    }

    const limit = response.headers.get("X-Rate-Limit");
    if (limit && this.onRateLimit) this.onRateLimit(limit);

    if (response.status === 204) return {};

    if (!response.ok) {
      let detail = null;
      try {
        const payload = await response.json();
        const error = payload.error || {};
        detail = [error.id, error.name, error.detail].filter(Boolean).join(" | ");
      } catch {
        detail = null;
      }
      throw new YnabError(
        STATUS_HELP[response.status] || `YNAB returned HTTP ${response.status}.`,
        response.status,
        detail || null
      );
    }

    const payload = await response.json();
    return payload.data ?? payload;
  }

  // ---------- reads ----------

  async budgets() {
    return (await this.request("GET", "/budgets")).budgets;
  }

  async categories(budgetId) {
    return (await this.request("GET", `/budgets/${budgetId}/categories`))
      .category_groups;
  }

  async accounts(budgetId) {
    return (await this.request("GET", `/budgets/${budgetId}/accounts`)).accounts;
  }

  async month(budgetId, month) {
    const value = month.length === 7 ? `${month}-01` : month;
    return (await this.request("GET", `/budgets/${budgetId}/months/${value}`))
      .month;
  }

  async transactions(budgetId, sinceDate) {
    const params = sinceDate ? { since_date: sinceDate } : undefined;
    return (
      await this.request("GET", `/budgets/${budgetId}/transactions`, { params })
    ).transactions;
  }

  // ---------- writes ----------

  async updateTransaction(budgetId, transactionId, transaction) {
    return (
      await this.request("PUT", `/budgets/${budgetId}/transactions/${transactionId}`, {
        body: { transaction },
      })
    ).transaction;
  }

  async updateMonthCategory(budgetId, month, categoryId, budgeted) {
    const value = month.length === 7 ? `${month}-01` : month;
    return (
      await this.request(
        "PATCH",
        `/budgets/${budgetId}/months/${value}/categories/${categoryId}`,
        { body: { category: { budgeted: Math.trunc(budgeted) } } }
      )
    ).category;
  }

  /**
   * Bulk-create transactions. Give each one an import_id
   * ("YNAB:<milliunits>:<date>:<occurrence>") and YNAB itself will skip
   * anything that looks like a re-import, the same way its own CSV import
   * does - so pushing the same file twice is safe.
   */
  async createTransactions(budgetId, transactions) {
    return this.request("POST", `/budgets/${budgetId}/transactions`, {
      body: { transactions },
    });
  }

  async deleteTransaction(budgetId, transactionId) {
    return (
      await this.request("DELETE", `/budgets/${budgetId}/transactions/${transactionId}`)
    ).transaction;
  }
}

// Flatten grouped categories into [{group, category}]. Deleted entries are
// always dropped; hidden ones unless asked for. YNAB's internal group holds
// "Inflow: Ready to Assign" and is not assignable, so it is excluded.
export function flattenCategories(groups, includeHidden = false) {
  const out = [];
  for (const group of groups || []) {
    if (group.deleted) continue;
    if (group.hidden && !includeHidden) continue;
    if (group.name === "Internal Master Category") continue;
    for (const category of group.categories || []) {
      if (category.deleted) continue;
      if (category.hidden && !includeHidden) continue;
      out.push({ group: group.name, category });
    }
  }
  return out;
}
