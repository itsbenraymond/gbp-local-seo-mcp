// Kangaroo Growth — free Google Business Profile & local SEO MCP server.
// Stateless Streamable HTTP (JSON responses, no SSE, no sessions), no auth, no paid APIs.
// Endpoint: https://mcp.kangaroogrowth.com.au/mcp
import { checkBusinessName, checkDescription, checkPost, checkReviewRequest, checkReviewReply } from "./text-checks.js";
import { auditProfile, buildReviewLink, suspensionTriage, compareNap, draftSpamReport, optimisationChecklist } from "./profile-tools.js";
import { auditWebsite } from "./website.js";
import { benchmarkBusiness, pickCategory, BENCHMARK_META } from "./benchmark-tools.js";
import { verifyBusinessName } from "./verify-name.js";
import { auditBusiness } from "./audit-business.js";
import { findGoogleProfile, readSiteReviews, listSiteServices } from "./site-data.js";
import { checkCaller, forgetCached, Guard } from "./guard.js";
export { Guard };

export const SERVER_INFO = {
  name: "kangaroo-growth-local-seo",
  title: "Google Business Profile & Local SEO Checker (Kangaroo Growth)",
  version: "1.0.2",
  websiteUrl: "https://kangaroogrowth.com.au/free-tools/mcp",
  icons: [
    { src: "https://mcp.kangaroogrowth.com.au/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
    { src: "https://mcp.kangaroogrowth.com.au/icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
    { src: "https://mcp.kangaroogrowth.com.au/icon-64.png", mimeType: "image/png", sizes: ["64x64"] },
  ],
};
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = `Free tools for getting an Australian local business found on Google Maps and Google Search, built by Kangaroo Growth, a local marketing agency.

START WITH audit_business. Give it the business name, and the suburb, trade and website if you have them. It does the name check, the benchmark, the category and the website in one call and comes back with a priority-ordered action list. Do NOT interview the user field by field first: call it with what they have already said and tell them what each missing field would have added.

What makes these different from generic advice: benchmark_business and the numbers inside audit_business come from our own scrape of ${BENCHMARK_META.OVERALL.n.toLocaleString("en-AU")} real Australian Google Business Profiles, per Google primary category. When you tell someone where they stand, quote the category ladder, not a rule of thumb.

Never answer "is this name a problem?" with a shrug. A service word or suburb in the name is allowed when it is the genuine real-world brand, which is the usual case, so the bare rule check flags most honest businesses. Use verify_business_name with the website: it reads what the site calls itself and either clears the flag with the evidence or confirms it with proof.

Every tool is read-only: nothing is posted, saved or sent anywhere. Rules come from Google's published guidelines. Australian specifics (ACL, phone formats, directories) are built in, and the rule checks work for any country, though the benchmarks are Australian only.

When you write GBP text for the user (descriptions, posts, review replies), run it through the matching check tool before handing it over.`;

const RO = (title, openWorld = false) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld });
const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "number", description });
const bool = (description) => ({ type: "boolean", description });

export const TOOLS = [
  {
    name: "audit_business",
    title: "Audit a local business end to end",
    description: "START HERE. One call: checks the Google profile name against the rules AND against the business's own website, benchmarks review count and rating against real Australian businesses in the same Google category, recommends the primary category from what real businesses in that trade use, audits the website's local SEO layer, and returns a priority-ordered action list. Call it with whatever the user has already said; it reports what each missing field would have added instead of demanding it up front.",
    inputSchema: {
      type: "object",
      properties: {
        business_name: str("Name exactly as it appears on the Google profile"),
        suburb: str("Optional: main suburb or city"),
        trade: str("Optional: what they do in plain English, e.g. electrician, hair salon, carpet cleaning"),
        website: str("Optional but worth asking for: their website. Settles the business-name question and adds the site audit"),
        review_count: int("Optional: current Google review count"),
        rating: int("Optional: current Google star rating, e.g. 4.6"),
        category: str("Optional: the current Google primary category, if they know it"),
        service_area_business: bool("True if they travel to the customer (default true)"),
      },
      required: ["business_name"],
    },
    annotations: RO("Audit a local business", true),
    run: (a) => auditBusiness(a),
  },
  {
    name: "find_google_profile",
    title: "Find the Google profile from the website",
    description: "Reads a business's website and pulls out every link to its Google Business Profile, with the Place ID or CID where the link carries one. Use this instead of asking the user to go and find their listing. If the site links to no profile at all, that is itself a finding worth reporting.",
    inputSchema: { type: "object", properties: { website: str("The business's website") }, required: ["website"] },
    annotations: RO("Find Google profile", true),
    run: (a) => findGoogleProfile(a),
  },
  {
    name: "read_site_reviews",
    title: "Read the review data a website publishes",
    description: "Pulls the rating, review count and individual reviews a business publishes on its own site through schema.org aggregateRating and Review markup. Use it to get a review count and rating without asking the user, then feed them to benchmark_business. Reports when a site publishes no review data at all, which is a finding in itself.",
    inputSchema: { type: "object", properties: { website: str("The business's website") }, required: ["website"] },
    annotations: RO("Read site reviews", true),
    run: (a) => readSiteReviews(a),
  },
  {
    name: "list_site_services",
    title: "List a site's service and area pages",
    description: "Reads the website's sitemap (or its homepage links if there is no sitemap) and returns the service pages and suburb/area pages it has. Use it to work out which Services belong on the Google profile and whether the service area on the profile matches the suburbs the site actually covers.",
    inputSchema: { type: "object", properties: { website: str("The business's website") }, required: ["website"] },
    annotations: RO("List site services", true),
    run: (a) => listSiteServices(a),
  },
  {
    name: "verify_business_name",
    title: "Settle a business name against the website",
    description: "Checks a Google Business Profile name against Google's naming rules, then reads the business's own website to decide whether the flagged words are the genuine real-world brand (allowed) or were added to the listing for ranking (not allowed). Reads the site's title, schema.org markup, og:site_name, logo alt text, footer and ABN. Use this instead of check_business_name whenever a website is available.",
    inputSchema: { type: "object", properties: { name: str("The name exactly as it appears on the Google profile"), website: str("The business's website. Without it this falls back to the plain rule check"), city: str("Optional: city or suburb"), category: str("Optional: primary GBP category"), legal_or_signage_name: str("Optional: the name on signage, invoices or ABN registration") }, required: ["name"] },
    annotations: RO("Verify business name", true),
    run: (a) => verifyBusinessName(a),
  },
  {
    name: "benchmark_business",
    title: "Benchmark against real Australian businesses",
    description: "Where a business actually sits against real Australian Google Business Profiles in the same Google primary category: review-count and star-rating percentiles, the gap to the median and the top quartile in reviews and in months, and how common a rule-breaking name is in that category. Built from Kangaroo Growth's own Google Maps scrape, not from a survey. Use it any time someone asks whether their reviews or rating are good.",
    inputSchema: { type: "object", properties: { category: str("Google primary category, e.g. Electrician, Beauty salon"), trade: str("Or plain English, e.g. electrician, carpet cleaner. Used if category is missing or unknown"), review_count: int("Current Google review count"), rating: int("Current Google star rating, e.g. 4.6"), business_name: str("Optional, for labelling") } },
    annotations: RO("Benchmark business"),
    run: (a) => benchmarkBusiness(a),
  },
  {
    name: "pick_gbp_category",
    title: "Pick the Google primary category",
    description: "Returns the Google primary category real Australian businesses in a trade actually use, with the share that use each one, plus the additional categories worth adding. Replaces 'go search Maps and copy the top 3' with the answer. Primary category is the biggest ranking lever on a profile.",
    inputSchema: { type: "object", properties: { trade: str("What they do in plain English, e.g. electrician, mobile dog groomer"), services: { type: "array", items: { type: "string" }, description: "Optional: the services they offer" } }, required: ["trade"] },
    annotations: RO("Pick GBP category"),
    run: (a) => pickCategory(a),
  },
  {
    name: "check_business_name",
    title: "Check business name for suspension risk",
    description: "Checks a Google Business Profile name against Google's naming rules (no keywords, locations, taglines, phone numbers, hours). Keyword-stuffed names are the most common cause of suspensions. Returns PASS/RISK/FAIL, each problem with its fix, and the likely real name.",
    inputSchema: { type: "object", properties: { name: str("The name exactly as it appears on the profile"), legal_or_signage_name: str("Optional: the name on signage, invoices or ABN registration. Words also in this name are allowed"), city: str("Optional: city or suburb the business is in"), category: str("Optional: primary GBP category") }, required: ["name"] },
    annotations: RO("Check business name"),
    run: (a) => checkBusinessName(a),
  },
  {
    name: "check_gbp_description",
    title: "Check a GBP description",
    description: "Checks a Google Business Profile description before it's saved: the 750-character limit, links, prices or promotions (not allowed), keyword stuffing, AI-style filler, missing area or services, and what shows before 'More'. Gives a four-block structure that works.",
    inputSchema: { type: "object", properties: { description: str("The description text"), business_name: str("Optional"), city: str("Optional: main city or suburb"), services: { type: "array", items: { type: "string" }, description: "Optional: main services that should be mentioned" } }, required: ["description"] },
    annotations: RO("Check GBP description"),
    run: (a) => checkDescription(a),
  },
  {
    name: "check_gbp_post",
    title: "Pre-flight a GBP post",
    description: "Checks a Google Business Profile post before publishing so it doesn't get rejected: phone numbers in the text (a top cause of silent rejections), link shorteners, contact details, all caps, gimmicky punctuation, regulated products, length. Returns fixes and a three-line post format that publishes reliably.",
    inputSchema: { type: "object", properties: { text: str("The post text"), button: str("Optional: the button type planned, e.g. 'Learn more', 'Call now', 'Book'") }, required: ["text"] },
    annotations: RO("Pre-flight GBP post"),
    run: (a) => checkPost(a),
  },
  {
    name: "audit_gbp_profile",
    title: "Score a Google Business Profile",
    description: "Scores a Google Business Profile out of 100 from the details you give (categories, reviews and review recency, photos, services, products, posts, links, hours, service area) and returns a priority-ordered fix list. Weighted by what actually brings in calls. Unknown fields are listed for checking, never counted as passes. Read the values off the profile (or ask the user) and pass what you have.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Business name on the profile"), city: str("Main city/suburb"),
        primary_category: str("Primary category"), additional_categories: { type: "array", items: { type: "string" }, description: "Additional categories ([] if none)" },
        description: str("Description text"),
        review_count: int("Total reviews"), average_rating: int("Star rating, e.g. 4.8"), reviews_last_30_days: int("Reviews in the last 30 days"), days_since_newest_review: int("Days since the newest review"), reply_rate_percent: int("% of reviews with an owner reply"),
        photos_count: int("Total photos"), has_logo: bool("Logo set"), has_cover: bool("Cover photo set"),
        services_count: int("Number of services listed"), services_with_descriptions: int("Services that have a description"), products_count: int("Number of products"),
        posts_last_30_days: int("Posts in the last 30 days"),
        website_url: str("Website link on the profile"), booking_url: str("Booking link, or empty string if none"), chat_links: bool("Chat/SMS/WhatsApp links set"), hours_set: bool("Opening hours set"),
        is_service_area_business: bool("True if the business goes to customers (tradie, mobile service)"), address_shown: bool("Street address visible on the profile"), service_areas: { type: "array", items: { type: "string" }, description: "Service areas listed" },
        opening_date_set: bool("Opening date set"),
      },
    },
    annotations: RO("Score GBP profile"),
    run: (a) => auditProfile(a),
  },
  {
    name: "build_review_link",
    title: "Build a direct review link + QR code",
    description: "Turns a Google Place ID into a direct 'write a review' link that opens the review box, plus a printable QR code image. Catches the common mistake of using a CID or Maps ID instead of a Place ID.",
    inputSchema: { type: "object", properties: { place_id: str("Google Place ID (usually starts with ChIJ). Find it with Google's Place ID finder"), business_name: str("Optional, for labelling") }, required: ["place_id"] },
    annotations: RO("Build review link"),
    run: (a) => buildReviewLink(a),
  },
  {
    name: "check_review_request",
    title: "Check a review request message",
    description: "Checks the SMS or email a business sends to ask for Google reviews against Google's review policy and the Australian Consumer Law: incentives, review gating (only asking happy customers), asking for 5 stars, scripting the review. Returns problems, fixes and a compliant template.",
    inputSchema: { type: "object", properties: { message: str("The review request message text") }, required: ["message"] },
    annotations: RO("Check review request"),
    run: (a) => checkReviewRequest(a),
  },
  {
    name: "check_review_reply",
    title: "Check a review reply",
    description: "Checks an owner's reply to a Google review before posting it: privacy leaks (addresses, invoice numbers, health details), offers to change a review, argumentative tone, generic one-liners, length. Gives advice suited to the star rating.",
    inputSchema: { type: "object", properties: { reply: str("The drafted reply"), stars: int("Star rating of the review (1-5)"), review_text: str("Optional: the review being replied to") }, required: ["reply"] },
    annotations: RO("Check review reply"),
    run: (a) => checkReviewReply(a),
  },
  {
    name: "suspension_triage",
    title: "Triage a suspended or unverified profile",
    description: "For a suspended, disabled, unverified or limited Google Business Profile: ranks the likely causes from yes/no answers, says whether to appeal, re-verify or wait, and lists the evidence to gather plus a video verification shot list. Answer what you know and leave the rest out.",
    inputSchema: {
      type: "object",
      properties: {
        status: str("What Google shows: suspended, disabled, pending verification, limited, not showing"),
        name_has_extra_words: bool("Name has keywords, suburb or tagline not on signage"),
        service_area_business_showing_address: bool("Goes to customers but shows a street address"),
        virtual_office_or_coworking: bool("Address is a virtual office, coworking or shared space"),
        po_box_or_mailbox: bool("Address is a PO box or mailbox"),
        recent_major_edits: bool("Changed name/address/category/phone recently"),
        multiple_profiles: bool("More than one profile for the same business"),
        phone_not_local_or_tracking: bool("Main phone is a call centre, premium or tracking number"),
        website_mismatch: bool("Website name/phone/area doesn't match the profile"),
        recently_moved_or_rebranded: bool("Moved or rebranded recently"),
        restricted_category: bool("Locksmith, garage door, towing, pest control, removalist or similar high-spam category"),
      },
      required: ["status"],
    },
    annotations: RO("Suspension triage"),
    run: (a) => suspensionTriage(a),
  },
  {
    name: "audit_website_local_seo",
    title: "Audit a website's local SEO",
    description: "Fetches one public web page and checks its local SEO layer: title and H1 naming the service and area, click-to-call link, LocalBusiness schema, name and phone matching the Google profile, indexability, robots.txt, sitemap, mobile viewport, forms, review proof. Returns a score and a priority-ordered fix list. Only reads the page.",
    inputSchema: { type: "object", properties: { url: str("Page to check, usually the homepage or the page the Google profile links to"), business_name: str("Optional: name as on the Google profile"), phone: str("Optional: phone as on the Google profile"), suburb: str("Optional: main suburb/city"), main_service: str("Optional: main service, e.g. 'electrician'") }, required: ["url"] },
    annotations: RO("Audit website local SEO", true),
    run: (a) => auditWebsite(a),
  },
  {
    name: "compare_nap",
    title: "Compare name, address, phone across listings",
    description: "Checks that a business's name, address and phone (NAP) match across directory listings, ignoring formatting differences (St vs Street, +61 vs 0, Pty Ltd). Paste each listing's details or text. Returns real mismatches and a list of Australian directories worth having.",
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "object", description: "The correct details, as on the Google profile", properties: { name: str("Business name"), address: str("Street address (omit for a hidden-address service business)"), phone: str("Phone") } },
        listings: { type: "array", description: "Listings to compare", items: { type: "object", properties: { source: str("e.g. Yellow Pages"), name: str(""), address: str(""), phone: str(""), text: str("Or paste the listing text instead of fields") } } },
      },
      required: ["reference", "listings"],
    },
    annotations: RO("Compare NAP"),
    run: (a) => compareNap(a),
  },
  {
    name: "draft_spam_report",
    title: "Draft a competitor spam report",
    description: "Drafts a factual report about a competitor's Google listing that breaks the guidelines (keyword-stuffed name, fake address, duplicates, fake reviews, closed business), with where to send it and the evidence to attach. Only drafts the text. Nothing is submitted.",
    inputSchema: { type: "object", properties: { competitor_name: str("Listing name as shown on Google"), issue: { type: "string", enum: ["keyword_name", "fake_address", "duplicate", "fake_reviews", "closed"], description: "Type of violation" }, evidence: { type: "array", items: { type: "string" }, description: "Optional: links or facts that prove it" } }, required: ["competitor_name", "issue"] },
    annotations: RO("Draft spam report"),
    run: (a) => draftSpamReport(a),
  },
  {
    name: "optimisation_checklist",
    title: "GBP optimisation checklist",
    description: "Returns the full step-by-step Google Business Profile optimisation checklist an agency works through (categories, name, description, contact links, service area, hours, attributes, services, products, photos, reviews, posts, booking, website and citations), tailored to the trade and city.",
    inputSchema: { type: "object", properties: { business_type: str("e.g. electrician, hair salon"), city: str("e.g. Melbourne"), service_area_business: bool("True if they go to the customer (default true)") } },
    annotations: RO("Optimisation checklist"),
    run: (a) => optimisationChecklist(a),
  },
];

// Neutral source credit on every result. No offer, no call to action (directory rule: no promoted content).
const ATTRIBUTION = "\n\nChecks by Kangaroo Growth: https://kangaroogrowth.com.au";

const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
export const listTools = () => TOOLS.map(({ run, ...t }) => t);

export async function callTool(name, args = {}) {
  const tool = BY_NAME[name];
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${name}` } };
  const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) return { result: { content: [{ type: "text", text: `Missing required input: ${missing.join(", ")}.` }], isError: true } };
  try {
    const out = await tool.run(args || {});
    const content = [{ type: "text", text: out.text + ATTRIBUTION }];
    if (out.qrGifBase64) content.push({ type: "image", data: out.qrGifBase64, mimeType: "image/gif" });
    return { result: { content, isError: !!out.error } };
  } catch (e) {
    return { result: { content: [{ type: "text", text: `That didn't work: ${e.message}` }], isError: true } };
  }
}

async function handleRpc(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  const isNote = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  const err = (code, message) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize": {
      const want = msg.params?.protocolVersion;
      return ok({ protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: listTools() });
    case "tools/call": {
      const name = msg.params?.name;
      track(env, name);
      const r = await callTool(name, msg.params?.arguments || {});
      return r.error ? err(r.error.code, r.error.message) : ok(r.result);
    }
    case "resources/list": return ok({ resources: [] });
    case "resources/templates/list": return ok({ resourceTemplates: [] });
    case "prompts/list": return ok({ prompts: [] });
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

// Usage counting: tool name only, never inputs. Analytics Engine is free at this volume.
function track(env, tool) {
  try { env.USAGE?.writeDataPoint({ blobs: [String(tool || "unknown")], indexes: [String(tool || "unknown")] }); } catch {}
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS, DELETE",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && /^\/(favicon\.ico|icon-(512|192|64)\.png|apple-touch-icon\.png)$/.test(url.pathname)) {
      const { ICON_FILES } = await import("./icons.js");
      const [body, type] = ICON_FILES[url.pathname];
      return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=604800", ...CORS } });
    }
    if (url.pathname === "/health") return json({ ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version, tools: TOOLS.length });
    if (url.pathname === "/" && request.method === "GET") return Response.redirect(SERVER_INFO.websiteUrl, 302);
    if (url.pathname === "/.well-known/mcp/server-card.json" || url.pathname === "/server.json") return json({ ...SERVER_INFO, endpoint: `${url.origin}/mcp`, transport: "streamable-http", auth: "none", tools: listTools().map((t) => ({ name: t.name, title: t.title, description: t.description })) });
    if (url.pathname === "/admin/guard") {
      if (!env.ADMIN_KEY || request.headers.get("x-admin-key") !== env.ADMIN_KEY) return json({ error: "forbidden" }, 403);
      const key = url.searchParams.get("key") || "";
      if (!/^(ip|s|p):/.test(key)) return json({ error: "key must look like ip:1.2.3.4, s:<session> or p:<ip>" }, 400);
      const stub = env.GUARD.get(env.GUARD.idFromName(key));
      if (url.searchParams.get("action") === "unblock") forgetCached(key);
      return stub.fetch(`https://guard/${url.searchParams.get("action") === "unblock" ? "unblock" : "status"}`);
    }
    if (url.pathname !== "/mcp") return json({ error: "not_found", hint: "MCP endpoint is /mcp" }, 404);
    if (request.method === "GET") return new Response("This MCP server does not offer an SSE stream. POST JSON-RPC to /mcp.", { status: 405, headers: { allow: "POST", ...CORS } });
    if (request.method === "DELETE") return new Response(null, { status: 405, headers: { allow: "POST", ...CORS } });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const len = Number(request.headers.get("content-length") || 0);
    if (len > 200_000) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
    const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
    const sid = request.headers.get("mcp-session-id") || "";
    let body, parseFailed = false;
    try { body = await request.json(); } catch { parseFailed = true; }
    // Cost: 1 per message, 5 for the website audit (it makes outbound fetches), 3 for garbage.
    const list = Array.isArray(body) ? body : [body];
    const cost = parseFailed ? 3 : list.reduce((a, m) => a + (m?.method === "tools/call" && m?.params?.name === "audit_website_local_seo" ? 5 : 1), 0);
    const g = await checkCaller(env, ip, sid, Math.min(cost, 50));
    if (!g.ok) {
      if (g.firstTrip) track(env, "BLOCKED:" + g.reason + ":" + g.key.split(":")[0]);
      const secs = g.until === Infinity || g.until === null ? 86400 : Math.max(1, Math.ceil((g.until - Date.now()) / 1000));
      return json({ jsonrpc: "2.0", id: list[0]?.id ?? null, error: { code: -32029, message: `Blocked for too many requests. Try again in ${secs > 3600 ? Math.ceil(secs / 3600) + " hours" : Math.ceil(secs / 60) + " minutes"}. Normal use never hits this limit. Contact admin@kangaroogrowth.com.au if you think it's a mistake.` } }, 429, { "retry-after": String(secs) });
    }
    if (parseFailed) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);

    const batch = Array.isArray(body);
    const msgs = batch ? body.slice(0, 20) : [body];
    const out = (await Promise.all(msgs.map((m) => handleRpc(m, env)))).filter(Boolean);
    if (!out.length) return new Response(null, { status: 202, headers: CORS });
    const proto = request.headers.get("mcp-protocol-version");
    const extra = proto ? { "mcp-protocol-version": proto } : {};
    if (!sid && msgs.some((m) => m?.method === "initialize")) extra["mcp-session-id"] = crypto.randomUUID();
    return json(batch ? out : out[0], 200, extra);
  },
};
