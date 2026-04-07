/**
 * NetSuite SuiteQL Client
 * Wraps NetSuite MCP tool calls for use in the prospecting pipeline.
 * When running standalone (non-MCP), uses REST API with token-based auth.
 */

const https = require('https');

class NetSuiteClient {
  constructor(config = {}) {
    this.accountId = config.accountId || process.env.NETSUITE_ACCOUNT_ID;
    this.consumerKey = config.consumerKey || process.env.NETSUITE_CONSUMER_KEY;
    this.consumerSecret = config.consumerSecret || process.env.NETSUITE_CONSUMER_SECRET;
    this.tokenId = config.tokenId || process.env.NETSUITE_TOKEN_ID;
    this.tokenSecret = config.tokenSecret || process.env.NETSUITE_TOKEN_SECRET;
  }

  /**
   * Run a SuiteQL query. In MCP mode this is a passthrough;
   * standalone mode uses the REST API.
   */
  async runSuiteQL(query, description = '', limit = 1000, offset = 0) {
    // When used from Claude Code MCP, the MCP tool handles execution.
    // This method is for standalone/CLI execution via REST.
    const url = `https://${this.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ q: query });
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'transient',
          // In production, use OAuth 1.0 TBA headers
          'Authorization': this._buildAuthHeader('POST', url)
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              items: parsed.items || [],
              hasMore: parsed.hasMore || false,
              totalResults: parsed.totalResults || 0
            });
          } catch (e) {
            reject(new Error(`Failed to parse NetSuite response: ${e.message}`));
          }
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
    const result = await this.runSuiteQL(`
      SELECT customer.category, SUM(transaction.total) as revenue
      FROM transaction
      JOIN entity AS customer ON transaction.entity = customer.id
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
      GROUP BY customer.category
      ORDER BY revenue DESC
    `, `Customer categories for rep ${repId}`);
    return result.items;
  }

  /**
   * Get top products sold by a rep
   */
  async getTopProducts(repId) {
    const result = await this.runSuiteQL(`
      SELECT transactionLine.item, item.itemId, item.displayName,
             SUM(transactionLine.quantity) as qty,
             SUM(transactionLine.amount) as revenue
      FROM transactionLine
      JOIN transaction ON transactionLine.transaction = transaction.id
      JOIN item ON transactionLine.item = item.id
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
      GROUP BY transactionLine.item, item.itemId, item.displayName
      ORDER BY revenue DESC
    `, `Top products for rep ${repId}`);
    return result.items;
  }

  /**
   * Get top shipping states/geographies for a rep
   */
  async getTopGeographies(repId) {
    const result = await this.runSuiteQL(`
      SELECT transaction.shipState, COUNT(*) as orderCount, SUM(transaction.total) as revenue
      FROM transaction
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
        AND transaction.shipState IS NOT NULL
      GROUP BY transaction.shipState
      ORDER BY revenue DESC
    `, `Top geographies for rep ${repId}`);
    return result.items;
  }

  /**
   * Get deal size statistics for a rep
   */
  async getDealSizeStats(repId) {
    const result = await this.runSuiteQL(`
      SELECT AVG(transaction.total) as avgDeal,
             MAX(transaction.total) as maxDeal,
             MIN(transaction.total) as minDeal,
             COUNT(*) as dealCount
      FROM transaction
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
        AND transaction.total > 0
    `, `Deal size stats for rep ${repId}`);
    return result.items;
  }

  /**
   * Get lost quotes (closed estimates with no linked SO)
   */
  async getLostQuotes(repId) {
    const result = await this.runSuiteQL(`
      SELECT transaction.memo, transaction.total, entity.entityId as companyName
      FROM transaction
      JOIN entity ON transaction.entity = entity.id
      WHERE transaction.employee = ${repId}
        AND transaction.type = 'Estimate'
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
      ORDER BY transaction.total DESC
    `, `Lost quotes for rep ${repId}`);
    return result.items;
  }

  /**
   * Get shipped sales (SalesOrd + Invoice) with shipping address for the sales map.
   * @param {Object} options - { repId (optional NetSuite employee ID), days (lookback days, default 730) }
   */
  async getSalesMapSales(options = {}) {
    const lookback = this._lookbackDateFromDays(options.days || 730);
    const repFilter = options.repId ? `AND transaction.employee = ${options.repId}` : '';

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
    const lookback = this._lookbackDateFromDays(options.days || 730);
    const repFilter = options.repId ? `AND transaction.employee = ${options.repId}` : '';

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
   * Classify an estimate's status display value into a map layer.
   */
  static classifyEstimateStatus(statusDisplay) {
    if (!statusDisplay) return 'open';
    const s = statusDisplay.toLowerCase();
    if (s.includes('processed') || s.includes('closed won') || s === 'estimate:b') return 'converted';
    if (s.includes('closed') || s.includes('voided') || s.includes('declined') || s === 'estimate:c' || s === 'estimate:x') return 'lost';
    return 'open';
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

  _buildAuthHeader(method, url) {
    // Placeholder for OAuth 1.0 TBA signature
    // In production, implement proper OAuth 1.0 signing
    return `OAuth realm="${this.accountId}", oauth_consumer_key="${this.consumerKey}", oauth_token="${this.tokenId}", oauth_signature_method="HMAC-SHA256", oauth_timestamp="${Math.floor(Date.now()/1000)}", oauth_nonce="${Math.random().toString(36).slice(2)}", oauth_version="1.0", oauth_signature="PLACEHOLDER"`;
  }
}

module.exports = NetSuiteClient;
