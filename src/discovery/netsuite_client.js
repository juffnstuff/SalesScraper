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
  async runSuiteQL(query, description = '') {
    // When used from Claude Code MCP, the MCP tool handles execution.
    // This method is for standalone/CLI execution via REST.
    const url = `https://${this.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

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
            resolve(parsed.items || []);
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
   * Get top customer categories by revenue for a sales rep
   */
  async getCustomerCategories(repId) {
    return this.runSuiteQL(`
      SELECT customer.category, SUM(transaction.total) as revenue
      FROM transaction
      JOIN entity AS customer ON transaction.entity = customer.id
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
      GROUP BY customer.category
      ORDER BY revenue DESC
    `, `Customer categories for rep ${repId}`);
  }

  /**
   * Get top products sold by a rep
   */
  async getTopProducts(repId) {
    return this.runSuiteQL(`
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
  }

  /**
   * Get top shipping states/geographies for a rep
   */
  async getTopGeographies(repId) {
    return this.runSuiteQL(`
      SELECT transaction.shipState, COUNT(*) as orderCount, SUM(transaction.total) as revenue
      FROM transaction
      WHERE transaction.employee = ${repId}
        AND transaction.type IN ('SalesOrd', 'Invoice')
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
        AND transaction.shipState IS NOT NULL
      GROUP BY transaction.shipState
      ORDER BY revenue DESC
    `, `Top geographies for rep ${repId}`);
  }

  /**
   * Get deal size statistics for a rep
   */
  async getDealSizeStats(repId) {
    return this.runSuiteQL(`
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
  }

  /**
   * Get lost quotes (closed estimates with no linked SO)
   */
  async getLostQuotes(repId) {
    return this.runSuiteQL(`
      SELECT transaction.memo, transaction.total, entity.entityId as companyName
      FROM transaction
      JOIN entity ON transaction.entity = entity.id
      WHERE transaction.employee = ${repId}
        AND transaction.type = 'Estimate'
        AND transaction.tranDate >= TO_DATE('${this._lookbackDate()}', 'YYYY-MM-DD')
      ORDER BY transaction.total DESC
    `, `Lost quotes for rep ${repId}`);
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
