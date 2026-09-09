# SalesScraper
Attempt to find bids/projects to market proactively

## MCP API for RF-MCP

The web server exposes a read-only `/api/mcp/*` family so RubberForm's MCP
aggregator (`rf-business-mcp`) can answer questions about heat-map projects,
contacts, contact lists, rep ICPs, prospecting runs, and the NetSuite sales
map. Set `SALESSCRAPER_MCP_API_KEY` here and the same value on the
rf-business-mcp service. GET only; the key can never scan, enrich, or push.
Route list in `CLAUDE.md`.
