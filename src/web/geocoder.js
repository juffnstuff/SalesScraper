/**
 * Geocoding Utility
 * Uses US Census Bureau Geocoder (free, no API key required).
 * Single-address endpoint: 1 request/sec rate limit.
 */

const https = require('https');

const CENSUS_GEOCODE_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/**
 * Geocode a single address using the US Census Bureau API.
 * @param {string} street
 * @param {string} city
 * @param {string} state
 * @param {string} zip
 * @returns {{ lat: number, lng: number } | null}
 */
async function geocodeAddress(street, city, state, zip) {
  if (!street && !city) return null;

  const address = [street, city, state, zip].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json'
  });

  const url = `${CENSUS_GEOCODE_URL}?${params.toString()}`;

  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const matches = parsed.result?.addressMatches;
          if (matches && matches.length > 0) {
            const coords = matches[0].coordinates;
            resolve({ lat: coords.y, lng: coords.x });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Rate-limited delay (1 request per second for Census API).
 */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { geocodeAddress, delay };
