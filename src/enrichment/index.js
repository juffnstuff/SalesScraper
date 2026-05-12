/**
 * Enrichment provider factory.
 *
 * Pick the client at runtime via ENRICHMENT_PROVIDER:
 *   ENRICHMENT_PROVIDER=apollo   → ApolloClient   (default)
 *   ENRICHMENT_PROVIDER=selling  → SellingApiClient
 *
 * Both clients expose: hasKey, findContacts, findContactsForProject,
 * enrichContact, enrichCompany, verifyEmail.
 *
 * findContacts/findContactsForProject only return real data on Apollo;
 * Selling.com's public API does not support title-based discovery and
 * returns [] with a warning.
 */

const ApolloClient = require('./apollo_client');
const SellingApiClient = require('./selling_api');

function createEnrichmentClient(config = {}) {
  const provider = (config.provider || process.env.ENRICHMENT_PROVIDER || 'apollo').toLowerCase();
  switch (provider) {
    case 'apollo':
    case 'apollo.io':
      return new ApolloClient(config);
    case 'selling':
    case 'selling.com':
      return new SellingApiClient(config);
    default:
      throw new Error(
        `Unknown ENRICHMENT_PROVIDER "${provider}". Use "apollo" or "selling".`
      );
  }
}

module.exports = { createEnrichmentClient, ApolloClient, SellingApiClient };
