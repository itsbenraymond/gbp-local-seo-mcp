#!/usr/bin/env node
// Writes README.md from the LIVE server's tools/list, so the public README can
// never drift from what the server actually exposes. Directories like MCPpedia
// read tool definitions from the GitHub README, not from the running server.
//
//   node tools/build-readme.mjs            (reads https://mcp.kangaroogrowth.com.au/mcp)
//   node tools/build-readme.mjs <url>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const URL_ = process.argv[2] || 'https://mcp.kangaroogrowth.com.au/mcp';
const server = JSON.parse(fs.readFileSync(path.join(pkg, 'server.json'), 'utf8'));

async function rpc(method, params = {}) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} -> ${body.error.message}`);
  return body.result;
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'readme-builder', version: '1' } });
const { tools } = await rpc('tools/list');
if (!tools?.length) throw new Error('tools/list returned no tools, refusing to write an empty README');
if (init.serverInfo.version !== server.version) {
  console.warn(`WARNING: live server is ${init.serverInfo.version}, server.json says ${server.version}. Deploy first, then rebuild.`);
}

const endpoint = server.remotes[0].url;
const anchor = (n) => n.toLowerCase().replace(/[^a-z0-9_-]/g, '');

const L = [];
L.push(`# ${server.title}`, '');
L.push(`A free, hosted, read-only [MCP](https://modelcontextprotocol.io) server that checks Google Business Profiles and local SEO for Australian local businesses. Built and run by [Kangaroo Growth](https://kangaroogrowth.com.au), a local marketing agency.`, '');
L.push(`- **Endpoint:** \`${endpoint}\` (Streamable HTTP)`);
L.push(`- **Auth:** none. No login, no API key, nothing stored`);
L.push(`- **Registry name:** \`${server.name}\``);
L.push(`- **Tools:** ${tools.length}, every one read-only (\`readOnlyHint: true\`)`);
L.push(`- **Docs and privacy:** ${server.websiteUrl}`, '');
L.push(`The benchmark numbers come from our own scrape of real Australian Google Business Profiles, per Google primary category. The method and the full dataset write-up are at https://kangaroogrowth.com.au/research/google-business-profile-names-australia. The rule checks follow Google's published guidelines and work for any country.`, '');

L.push('## Install', '');
L.push('There is nothing to install locally. Point your MCP client at the endpoint.', '');
L.push('### Claude Code', '', '```bash', `claude mcp add --transport http gbp-local-seo ${endpoint}`, '```', '');
L.push('### Claude Desktop / claude.ai', '', `Settings, Connectors, Add custom connector, then paste \`${endpoint}\`.`, '');
L.push('### Cursor (`~/.cursor/mcp.json`)', '', '```json', JSON.stringify({ mcpServers: { 'gbp-local-seo': { url: endpoint } } }, null, 2), '```', '');
L.push('### VS Code (`.vscode/mcp.json`)', '', '```json', JSON.stringify({ servers: { 'gbp-local-seo': { type: 'http', url: endpoint } } }, null, 2), '```', '');
L.push('### Any client without remote support', '', '```json', JSON.stringify({ mcpServers: { 'gbp-local-seo': { command: 'npx', args: ['-y', 'mcp-remote', endpoint] } } }, null, 2), '```', '');

L.push('## Getting started', '');
L.push('Start with `audit_business`. Give it the business name, plus the suburb, trade and website if you have them. One call runs the name check, the benchmark, the category pick and the website audit, and returns a priority-ordered action list.', '');
L.push('### Example prompts', '');
L.push('- "Audit Smith Plumbing in Brunswick, website smithplumbing.com.au"');
L.push('- "Will this Google post get rejected? <paste post>"');
L.push('- "Is the name \'Best Cheap Plumber Melbourne\' going to get my profile suspended?"');
L.push('- "My Google profile got suspended, what do I do?"');
L.push('- "Make me a review link and QR code for my business"', '');
L.push('### Example raw call', '');
L.push('```bash', `curl -s ${endpoint} \\`, `  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\`,
  `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_gbp_post","arguments":{"text":"Call us on 0400 000 000 for 20% off!"}}}'`, '```', '');

L.push('## Tools', '');
L.push('| Tool | What it does |', '|---|---|');
for (const t of tools) L.push(`| [\`${t.name}\`](#${anchor(t.name)}) | ${(t.title || '').replace(/\|/g, '\\|')} |`);
L.push('');
for (const t of tools) {
  L.push(`### ${t.name}`, '');
  if (t.title) L.push(`**${t.title}**`, '');
  L.push(t.description.trim(), '');
  L.push('<details><summary>Input schema</summary>', '', '```json', JSON.stringify(t.inputSchema, null, 2), '```', '', '</details>', '');
}

L.push('## Run it yourself', '');
L.push('It is a Cloudflare Worker with one dependency.', '');
L.push('```bash', 'npm install', 'npm test        # every rule has a known-bad input that must fail', 'npx wrangler dev', '```', '');
L.push('Change `account_id` and the custom domain route in `wrangler.toml` before deploying to your own account. `ADMIN_KEY` (Worker secret) unlocks `/admin/guard`.', '');
L.push('## Limits', '');
L.push('Fair-use rate limits apply per IP, or per MCP session for traffic from Claude.ai and ChatGPT. Normal use never hits them. The only tool that fetches anything is `audit_website_local_seo` (one page plus robots.txt and the sitemap, 10s timeout, 3MB cap, private and internal hosts blocked).', '');
L.push('## Privacy', '');
L.push(`No inputs are stored or logged. Each call records the tool name only, for usage counts. Full policy: ${server.websiteUrl}#privacy`, '');
L.push('## License', '', 'MIT. See [LICENSE](LICENSE).', '');

fs.writeFileSync(path.join(pkg, 'README.md'), L.join('\n'));
console.log(`wrote README.md: ${tools.length} tools from ${URL_} (live ${init.serverInfo.version})`);
