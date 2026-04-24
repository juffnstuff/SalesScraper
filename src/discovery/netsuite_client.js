/**
 * NetSuite SuiteQL Client
 * Wraps NetSuite MCP tool calls for use in the prospecting pipeline.
 * When running standalone (non-MCP), uses REST API with OAuth 1.0 TBA auth.
 */

const https = require('https');
const crypto = require('crypto');

class NetSuiteClient {
  constructor(config = {}) {
    this.accountId = config.accountId || process.env.NETSUITE_ACCOUNT_ID;
    this.consumerKey = config.consumerKey || process.env.NETSUITE_CONSUMER_KEY;
    this.consumerSecret = config.consumerSecret || process.env.NETSUITE_CONSUMER_SECRET;
    this.tokenId = config.tokenId || process.env.NETSUITE_TOKEN_ID;
    this.tokenSecret = config.tokenSecret || process.env.NETSUITE_TOKEN_SECRET;
  }

  // SuiteQL does not parameterize user input, so we guard the few values that
  // get interpolated into query strings. Anything that fails these checks
  // throws before the query is ever dispatched.
  static _assertNumericId(value, field) {
    if (value === null || value === undefined || value === '') {
      throw new Error(`NetSuiteClient: ${field} is required`);
    }
    const s = String(value);
    if (!/^-?\d+$/.test(s)) {
      throw new Error(`NetSuiteClient: ${field} must be an integer (got ${JSON.stringify(value)})`);
    }
    return s;
  }

  static _assertIsoDate(value, field) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`NetSuiteClient: ${field} must match YYYY-MM-DD (got ${JSON.stringify(value)})`);
    }
    return value;
  }

  /**
   * Run a SuiteQL query. In MCP mode this is a passthrough;
   * standalone mode uses the REST API with OAuth 1.0 TBA auth.
   */
  async runSuiteQL(query, description = '', limit = 1000, offset = 0) {
    // NetSuite hostname convention: lowercase, underscore → dash.
    // e.g. "1234567_SB1" → "1234567-sb1.suitetalk.api.netsuite.com".
    const hostAccount = String(this.accountId || '').toLowerCase().replace(/_/g, '-');
    const url = `https://${hostAccount}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ q: query });
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'transient',
          'Authorization': this._buildAuthHeader('POST', url)
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Reject non-2xx loudly — previously errors silently returned [] via
          // `parsed.items || []`, which hid broken OAuth signatures for months.
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(
              `NetSuite SuiteQL ${res.statusCode} for "${description}": ${data.slice(0, 500)}`
            ));
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            return reject(new Error(`Failed to parse NetSuite response: ${e.message} — body: ${data.slice(0, 200)}`));
          }
          resolve({
            items: parsed.items || [],
            hasMore: parsed.hasMore || false,
            totalResults: parsed.totalResults || 0
          });
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Run a SuiteQL query with automatic pagination, collecting all pages.
   */
  async runSuiteQLPaginated(query, description = '', pageSize = 1000) {
    const allItems = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await this.runSuiteQL(query, description, pageSize, offset);
      allItems.push(...result.items);
      hasMore = result.hasMore;
      offset += pageSize;
    }

    return allItems;
  }

  /**
   * Get top customer categories by revenue for a sales rep
   */
  async getCustomerCategories(repId) {
    const rep = NetSuiteClient._assertNumericId(repId, 'repId');
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDate(), 'lookback');
    const result = await this.runSuiteQL(`
      SELECT customer.category, SUM(transaction.total) as revenue
      FROM transaction
      JOIN entity AS customer ON transaction.entity = customer.id
      WHERE transaction.employee = ${rep}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
      GROUP BY customer.category
      ORDER BY revenue DESC
    `, `Customer categories for rep ${rep}`);
    return result.items;
  }

  /**
   * Get top products sold by a rep
   */
  async getTopProducts(repId) {
    const rep = NetSuiteClient._assertNumericId(repId, 'repId');
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDate(), 'lookback');
    const result = await this.runSuiteQL(`
      SELECT transactionLine.item, item.itemId, item.displayName,
             SUM(transactionLine.quantity) as qty,
             SUM(transactionLine.amount) as revenue
      FROM transactionLine
      JOIN transaction ON transactionLine.transaction = transaction.id
      JOIN item ON transactionLine.item = item.id
      WHERE transaction.employee = ${rep}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
      GROUP BY transactionLine.item, item.itemId, item.displayName
      ORDER BY revenue DESC
    `, `Top products for rep ${rep}`);
    return result.items;
  }

  /**
   * Get top shipping states/geographies for a rep
   */
  async getTopGeographies(repId) {
    const rep = NetSuiteClient._assertNumericId(repId, 'repId');
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDate(), 'lookback');
    const result = await this.runSuiteQL(`
      SELECT transaction.shipState, COUNT(*) as orderCount, SUM(transaction.total) as revenue
      FROM transaction
      WHERE transaction.employee = ${rep}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
        AND transaction.shipState IS NOT NULL
      GROUP BY transaction.shipState
      ORDER BY revenue DESC
    `, `Top geographies for rep ${rep}`);
    return result.items;
  }

  /**
   * Get deal size statistics for a rep
   */
  async getDealSizeStats(repId) {
    const rep = NetSuiteClient._assertNumericId(repId, 'repId');
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDate(), 'lookback');
    const result = await this.runSuiteQL(`
      SELECT AVG(transaction.total) as avgDeal,
             MAX(transaction.total) as maxDeal,
             MIN(transaction.total) as minDeal,
             COUNT(*) as dealCount
      FROM transaction
      WHERE transaction.employee = ${rep}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
        AND transaction.total > 0
    `, `Deal size stats for rep ${rep}`);
    return result.items;
  }

  /**
   * Get lost quotes (closed estimates with no linked SO)
   */
  async getLostQuotes(repId) {
    const rep = NetSuiteClient._assertNumericId(repId, 'repId');
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDate(), 'lookback');
    const result = await this.runSuiteQL(`
      SELECT transaction.memo, transaction.total, entity.entityId as companyName
      FROM transaction
      JOIN entity ON transaction.entity = entity.id
      WHERE transaction.employee = ${rep}
        AND transaction.type = 'Estimate'
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
      ORDER BY transaction.total DESC
    `, `Lost quotes for rep ${rep}`);
    return result.items;
  }

  /**
   * Get shipped sales (SalesOrd + Invoice) with shipping address for the sales map.
   * @param {Object} options - { repId (optional NetSuite employee ID), days (lookback days, default 730) }
   */
  async getSalesMapSales(options = {}) {
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDateFromDays(options.days || 730), 'lookback');
    const repFilter = options.repId
      ? `AND transaction.employee = ${NetSuiteClient._assertNumericId(options.repId, 'repId')}`
      : '';

    return this.runSuiteQLPaginated(`
      SELECT transaction.id, transaction.tranId, transaction.tranDate,
             transaction.total, transaction.memo, transaction.employee,
             BUILTIN.DF(transaction.entity) AS customerName,
             transactionShippingAddress.city AS shipCity,
             transactionShippingAddress.state AS shipState,
             transactionShippingAddress.zip AS shipZip
      FROM transaction
        JOIN transactionShippingAddress
          ON transaction.shippingAddress = transactionShippingAddress.nkey
      WHERE transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
        AND transactionShippingAddress.state IS NOT NULL
        ${repFilter}
      ORDER BY transaction.tranDate DESC
    `, 'Sales map: shipped sales');
  }

  /**
   * Get all estimates/quotes with shipping address for the sales map.
   * Returns all statuses; caller classifies as open/converted/lost.
   * @param {Object} options - { repId (optional NetSuite employee ID), days (lookback days, default 730) }
   */
  async getSalesMapEstimates(options = {}) {
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDateFromDays(options.days || 730), 'lookback');
    const repFilter = options.repId
      ? `AND transaction.employee = ${NetSuiteClient._assertNumericId(options.repId, 'repId')}`
      : '';

    return this.runSuiteQLPaginated(`
      SELECT transaction.id, transaction.tranId, transaction.tranDate,
             transaction.total, transaction.memo, transaction.employee,
             transaction.probability,
             BUILTIN.DF(transaction.entity) AS customerName,
             BUILTIN.DF(transaction.status) AS statusDisplay,
             transactionShippingAddress.city AS shipCity,
             transactionShippingAddress.state AS shipState,
             transactionShippingAddress.zip AS shipZip
      FROM transaction
        JOIN transactionShippingAddress
          ON transaction.shippingAddress = transactionShippingAddress.nkey
      WHERE transaction.type = 'Estimate'
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
        AND transactionShippingAddress.state IS NOT NULL
        ${repFilter}
      ORDER BY transaction.tranDate DESC
    `, 'Sales map: estimates');
  }

  /**
   * Get sales orders modified since a given date (for incremental sync).
   * Uses lastModifiedDate so we catch status changes, not just new records.
   * @param {string} sinceDate - ISO date string (YYYY-MM-DD)
   */
  async getSalesModifiedSince(sinceDate) {
    const since = NetSuiteClient._assertIsoDate(sinceDate, 'sinceDate');
    return this.runSuiteQLPaginated(`
      SELECT transaction.id, transaction.tranId, transaction.tranDate,
             transaction.shipDate,
             transaction.total, transaction.memo, transaction.employee,
             transaction.lastModifiedDate,
             BUILTIN.DF(transaction.entity) AS customerName,
             BUILTIN.DF(transaction.status) AS statusDisplay,
             transactionShippingAddress.city AS shipCity,
             transactionShippingAddress.state AS shipState,
             transactionShippingAddress.zip AS shipZip,
             transactionShippingAddress.addr1 AS shipStreet
      FROM transaction
        LEFT JOIN transactionShippingAddress
          ON transaction.shippingAddress = transactionShippingAddress.nkey
      WHERE transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.lastModifiedDate >= TO_DATE('${since}', 'YYYY-MM-DD')
      ORDER BY transaction.lastModifiedDate DESC
    `, 'Incremental sync: sales modified since ' + since);
  }

  /**
   * Pull every currently-open sales order (Pending Approval + Pending
   * Fulfillment), regardless of when it was last modified. The incremental
   * sync keys on lastModifiedDate, so an SO created weeks ago and left
   * sitting in Pending Approval never enters the sliding window and goes
   * missing from the DB. This safety-net query catches those rows on every
   * sync run.
   *
   * Filters on the raw transaction.status values ('SalesOrd:A' = Pending
   * Approval, 'SalesOrd:B' = Pending Fulfillment) — BUILTIN.DF isn't
   * reliable inside WHERE clauses across NetSuite SuiteQL versions.
   */
  async getOpenSalesOrders() {
    return this.runSuiteQLPaginated(`
      SELECT transaction.id, transaction.tranId, transaction.tranDate,
             transaction.shipDate,
             transaction.total, transaction.memo, transaction.employee,
             transaction.lastModifiedDate,
             BUILTIN.DF(transaction.entity) AS customerName,
             BUILTIN.DF(transaction.status) AS statusDisplay,
             transactionShippingAddress.city AS shipCity,
             transactionShippingAddress.state AS shipState,
             transactionShippingAddress.zip AS shipZip,
             transactionShippingAddress.addr1 AS shipStreet
      FROM transaction
        LEFT JOIN transactionShippingAddress
          ON transaction.shippingAddress = transactionShippingAddress.nkey
      WHERE transaction.type = 'SalesOrd'
        AND transaction.status IN ('SalesOrd:A', 'SalesOrd:B')
      ORDER BY transaction.tranDate DESC
    `, 'Open sales orders (Pending Approval + Pending Fulfillment)');
  }

  /**
   * Get estimates modified since a given date (for incremental sync).
   * Uses lastModifiedDate so we catch status changes (open→converted, open→lost).
   * @param {string} sinceDate - ISO date string (YYYY-MM-DD)
   */
  async getEstimatesModifiedSince(sinceDate) {
    const since = NetSuiteClient._assertIsoDate(sinceDate, 'sinceDate');
    return this.runSuiteQLPaginated(`
      SELECT transaction.id, transaction.tranId, transaction.tranDate,
             transaction.total, transaction.memo, transaction.employee,
             transaction.probability, transaction.lastModifiedDate,
             BUILTIN.DF(transaction.entity) AS customerName,
             BUILTIN.DF(transaction.status) AS statusDisplay,
             transactionShippingAddress.city AS shipCity,
             transactionShippingAddress.state AS shipState,
             transactionShippingAddress.zip AS shipZip,
             transactionShippingAddress.addr1 AS shipStreet
      FROM transaction
        LEFT JOIN transactionShippingAddress
          ON transaction.shippingAddress = transactionShippingAddress.nkey
      WHERE transaction.type = 'Estimate'
        AND transaction.lastModifiedDate >= TO_DATE('${since}', 'YYYY-MM-DD')
      ORDER BY transaction.lastModifiedDate DESC
    `, 'Incremental sync: estimates modified since ' + since);
  }

  /**
   * Classify an estimate's status display value into a map layer.
   */
  static classifyEstimateStatus(statusDisplay, lostReason) {
    if (!statusDisplay) return 'open';
    const s = statusDisplay.toLowerCase();
    if (s.includes('processed') || s.includes('closed won') || s === 'estimate:b') return 'converted';
    if (s.includes('closed') || s.includes('voided') || s.includes('declined') || s === 'estimate:c' || s === 'estimate:x') {
      if (lostReason && lostReason.toLowerCase().includes('alternate rf solution')) return 'converted';
      return 'lost';
    }
    return 'open';
  }

  /**
   * Get line items with actual part codes for all transactions.
   * Returns itemId (the SKU/part number), not just the internal item ID.
   * @param {string} tranType - 'SalesOrd' or 'Estimate'
   * @param {number} days - lookback days (default 730)
   */
  /**
   * Pull current-state inventory for every inventoried item (single-location
   * setup — these aggregate fields on the `item` record already reflect
   * company-wide totals). Returns one row per item with on-hand / available /
   * committed / cost, for the other services that read the database.
   *
   * Filtering by `quantityOnHand IS NOT NULL` scopes to items where NetSuite
   * actually tracks inventory; non-inventory items (services, kits, etc.)
   * leave those columns null and get dropped here.
   */
  async getInventory() {
    return this.runSuiteQLPaginated(`
      SELECT item.id,
             item.itemId,
             item.displayName,
             item.quantityOnHand,
             item.quantityAvailable,
             item.quantityCommitted,
             item.quantityOnOrder,
             item.quantityBackOrdered,
             item.averageCost,
             item.reorderPoint,
             item.isInactive
      FROM item
      WHERE item.quantityOnHand IS NOT NULL
      ORDER BY item.itemId
    `, 'Inventory snapshot');
  }

  async getLineItemsWithPartCodes(tranType, days = 730) {
    const lookback = NetSuiteClient._assertIsoDate(this._lookbackDateFromDays(days), 'lookback');
    const typeFilter = tranType === 'Estimate' ? "= 'Estimate'" : "IN ('SalesOrd', 'Invoice')";

    return this.runSuiteQLPaginated(`
      SELECT transaction.tranId,
             item.itemId AS partNumber,
             transactionLine.item AS internalId,
             BUILTIN.DF(transactionLine.item) AS itemName,
             transactionLine.quantity AS qty,
             transactionLine.amount,
             transactionLine.rate,
             item.displayName AS description
      FROM transactionLine
        JOIN transaction ON transactionLine.transaction = transaction.id
        JOIN item ON transactionLine.item = item.id
      WHERE transaction.type ${typeFilter}
        AND transaction.tranDate >= TO_DATE('${lookback}', 'YYYY-MM-DD')
        AND transactionLine.mainLine = 'F'
        AND transactionLine.amount != 0
      ORDER BY transaction.tranId, transactionLine.lineSequenceNumber
    `, `Line items with part codes: ${tranType}`);
  }

  _lookbackDateFromDays(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }

  _lookbackDate() {
    const days = parseInt(process.env.DEFAULT_ICP_LOOKBACK_DAYS || '365');
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }

  /**
   * Build an OAuth 1.0 TBA Authorization header for NetSuite.
   * HMAC-SHA256 signature per RFC 5849 with RFC 3986 encoding.
   *
   * NetSuite conventions applied:
   *   - Realm = account ID uppercased, underscores preserved (e.g. "1234567_SB1").
   *   - Hostname uses lowercased accountId with underscores → dashes; that happens
   *     in runSuiteQL before calling here, so the URL arg here is already normalized.
   *   - Query-string params (limit, offset) are included in the signature base string;
   *     the JSON body is NOT (NetSuite follows the "non-form-encoded body" convention).
   */
  _buildAuthHeader(method, urlStr) {
    if (!this.consumerKey || !this.consumerSecret || !this.tokenId || !this.tokenSecret) {
      throw new Error('NetSuite TBA credentials incomplete — need consumerKey/Secret + tokenId/Secret');
    }

    // RFC 3986 percent-encoding (stricter than encodeURIComponent, which leaves !*'() alone).
    const enc = (s) => encodeURIComponent(String(s))
      .replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

    const url = new URL(urlStr);
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

    const queryParams = {};
    for (const [k, v] of url.searchParams) queryParams[k] = v;

    const oauthParams = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA256',
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: this.tokenId,
      oauth_version: '1.0'
    };

    // Signature base string: METHOD & encoded(URL) & encoded(sorted params joined by &).
    // Params are encoded, then sorted by encoded key (ties by encoded value).
    const allParams = { ...queryParams, ...oauthParams };
    const encodedPairs = Object.keys(allParams)
      .map(k => [enc(k), enc(allParams[k])])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const paramString = encodedPairs.map(([k, v]) => `${k}=${v}`).join('&');

    const baseString = `${method.toUpperCase()}&${enc(baseUrl)}&${enc(paramString)}`;
    const signingKey = `${enc(this.consumerSecret)}&${enc(this.tokenSecret)}`;
    const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

    // Authorization header. Only oauth_* params (plus realm + signature) belong here —
    // the query params go in the URL, not the header.
    const realm = String(this.accountId || '').toUpperCase();
    const headerParams = { ...oauthParams, oauth_signature: signature };
    const headerFields = Object.keys(headerParams)
      .sort()
      .map(k => `${enc(k)}="${enc(headerParams[k])}"`);
    return `OAuth realm="${enc(realm)}", ${headerFields.join(', ')}`;
  }
}

module.exports = NetSuiteClient;
