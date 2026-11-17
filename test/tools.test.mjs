// Every checker is tested against a known-BAD input that must FAIL and a known-good
// input that must PASS. A checker that passes everything is the failure we guard against.
import test from "node:test";
import { benchmarkBusiness, pickCategory, resolveCategory } from "../src/benchmark-tools.js";
import { judgeBrand } from "../src/brand-evidence.js";
import { verifyBusinessName } from "../src/verify-name.js";
import assert from "node:assert/strict";
import { checkBusinessName, checkDescription, checkPost, checkReviewRequest, checkReviewReply } from "../src/text-checks.js";
import { auditProfile, buildReviewLink, suspensionTriage, compareNap, draftSpamReport, optimisationChecklist } from "../src/profile-tools.js";
import { safeUrl } from "../src/website.js";
import worker, { TOOLS, listTools } from "../src/index.js";

test("name: stuffed name fails, real name passes", () => {
  assert.equal(checkBusinessName({ name: "Fins Up Electrical | Best Emergency Electrician Redcliffe 24/7" }).verdict, "FAIL");
  assert.equal(checkBusinessName({ name: "Plumber Melbourne - Cheap & Fast" }).verdict, "FAIL");
  assert.equal(checkBusinessName({ name: "Mitch's Mowing", legal_or_signage_name: "Mitch's Mowing & Landscaping" }).verdict, "PASS");
  assert.equal(checkBusinessName({ name: "Kangaroo Growth" }).verdict, "PASS");
  // brand words on signage are allowed
  assert.equal(checkBusinessName({ name: "Smith Plumbing", legal_or_signage_name: "Smith Plumbing" }).verdict, "PASS");
});

test("description: link, promo and over-length fail; good one passes", () => {
  assert.equal(checkDescription({ description: "Visit www.example.com.au for 20% off all jobs this month! " + "x".repeat(300) }).verdict, "FAIL");
  assert.equal(checkDescription({ description: "a".repeat(760) }).verdict, "FAIL");
  const good = "Fins Up Electrical is a licensed electrician based in Scarborough, working across Redcliffe, Margate, Newport, Kippa-Ring and Woody Point. We do new home electrical installations, renovations, switchboard upgrades, power points, ceiling fans, LED lighting, smoke alarm testing, oven and cooktop installs, and general repairs for homes and businesses. With over 16 years in the trade, we turn up on time, explain your options clearly and leave the place clean. Call or message us for a free quote.";
  const r = checkDescription({ description: good, business_name: "Fins Up Electrical", city: "Redcliffe" });
  assert.equal(r.verdict, "PASS", r.text);
});

test("post: phone number fails (the AA Copper rejection), clean post passes", () => {
  assert.equal(checkPost({ text: "Bin of copper pipe at the yard. Call 0412 345 678 for today's rate.", button: "Learn more" }).verdict, "FAIL");
  assert.equal(checkPost({ text: "Grab a deal bit.ly/abc", button: "x" }).verdict, "FAIL");
  assert.equal(checkPost({ text: "Bin of copper pipe at the yard, bends, offcuts and all. Bring yours in as is. Got scrap copper to sell in Adelaide? Our Holden Hill yard is open 7 days.", button: "Learn more" }).verdict, "PASS");
});

test("review request: incentive and gating fail, plain ask passes", () => {
  assert.equal(checkReviewRequest({ message: "Leave us a 5 star review and get 10% off your next service! https://g.page/x" }).verdict, "FAIL");
  assert.equal(checkReviewRequest({ message: "If you're happy with the job, please review us: https://g.page/x" }).verdict, "FAIL");
  assert.equal(checkReviewRequest({ message: "Hi Sam, thanks for having us out today. An honest Google review really helps a small business like ours: https://g.page/x Cheers, Mitch" }).verdict, "PASS");
});

test("review reply: change-your-review offer fails, decent reply passes", () => {
  assert.equal(checkReviewReply({ reply: "We'll give you a refund if you remove your review.", stars: 1 }).verdict, "FAIL");
  assert.equal(checkReviewReply({ reply: "Thanks Jess, glad the new switchboard sorted the tripping. Good luck with the reno, and give us a shout when the kitchen's ready.", stars: 5 }).verdict, "PASS");
});

test("profile audit: empty input scores nothing as a pass", () => {
  const empty = auditProfile({});
  assert.equal(empty.score, 0);
  assert.ok(empty.rows.every((r) => r.state === "check"));
  const weak = auditProfile({ primary_category: "Electrician", additional_categories: [], review_count: 3, reviews_last_30_days: 0, photos_count: 2 });
  const strong = auditProfile({ primary_category: "Electrician", additional_categories: ["a", "b", "c"], review_count: 80, reviews_last_30_days: 6, days_since_newest_review: 2, photos_count: 60, reply_rate_percent: 100 });
  assert.ok(strong.score > weak.score + 40, `${strong.score} vs ${weak.score}`);
});

test("review link: CID rejected, place id builds link + QR", () => {
  assert.ok(buildReviewLink({ place_id: "12345678901234567890" }).error);
  assert.ok(buildReviewLink({ place_id: "0x6ad646b5d2ba4df7:0x4045675218ccd90" }).error);
  const r = buildReviewLink({ place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
  assert.equal(r.link, "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
  assert.ok(r.qrGifBase64.startsWith("R0lGOD"), "QR should be a GIF");
});

test("triage ranks PO box above minor causes", () => {
  const r = suspensionTriage({ status: "suspended", po_box_or_mailbox: true, website_mismatch: true });
  assert.match(r.causes[0].cause, /PO box/);
  assert.match(r.text, /appeal/i);
});

test("NAP: formatting differences ignored, real mismatch flagged", () => {
  const r = compareNap({ reference: { name: "Smith's Plumbing Pty Ltd", address: "12 Smith Street, Richmond VIC 3121", phone: "+61 412 345 678" }, listings: [
    { source: "Yellow", name: "Smiths Plumbing", address: "12 Smith St Richmond Victoria 3121", phone: "0412 345 678" },
    { source: "TrueLocal", name: "Smith Plumbing Melbourne", address: "14 Smith St Richmond VIC 3121", phone: "0412 999 999" },
  ] });
  assert.equal(r.results[0].problems.length, 0, JSON.stringify(r.results[0]));
  assert.equal(r.results[1].problems.length, 3, JSON.stringify(r.results[1]));
});

test("spam report + checklist render", () => {
  assert.match(draftSpamReport({ competitor_name: "Best Plumber Melbourne 24/7", issue: "keyword_name" }).text, /Best Plumber Melbourne/);
  assert.match(optimisationChecklist({ business_type: "electrician", city: "Brisbane" }).text, /electrician Brisbane/);
});

test("safeUrl blocks internal targets", () => {
  for (const bad of ["http://localhost", "http://127.0.0.1", "http://169.254.169.254/latest", "file:///etc/passwd", "http://intranet", "https://example.com:8080", "http://[::1]/"]) {
    assert.throws(() => safeUrl(bad), undefined, bad);
  }
  assert.equal(safeUrl("kangaroogrowth.com.au").hostname, "kangaroogrowth.com.au");
});

test("every tool is annotated for the directory", () => {
  for (const t of listTools()) {
    assert.ok(t.title, t.name);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.ok(t.description.length < 600, t.name);
    assert.equal(t.inputSchema.type, "object");
  }
  assert.equal(TOOLS.length, 19);
});

const rpc = (body, headers = {}) => worker.fetch(new Request("https://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) }), {});

test("protocol: initialize, notification 202, list, call, errors", async () => {
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  assert.equal((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const list = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.equal(list.result.tools.length, 19);
  assert.ok(!("run" in list.result.tools[0]));
  const call = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_gbp_post", arguments: { text: "Call 0412 345 678 now" } } })).json();
  assert.match(call.result.content[0].text, /FAIL/);
  const qr = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "build_review_link", arguments: { place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" } } })).json();
  assert.equal(qr.result.content[1].type, "image");
  const missing = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "check_gbp_post", arguments: {} } })).json();
  assert.equal(missing.result.isError, true);
  const unknown = await (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } })).json();
  assert.equal(unknown.error.code, -32602);
  const nf = await (await rpc({ jsonrpc: "2.0", id: 7, method: "foo/bar" })).json();
  assert.equal(nf.error.code, -32601);
  const old = await (await rpc({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
  assert.equal(old.result.protocolVersion, "2025-11-25");
  const g = await worker.fetch(new Request("https://x/mcp"), {});
  assert.equal(g.status, 405);
});

// Directory rule: no sponsored or promoted content. Our name and URL may appear ONLY in the
// final attribution line, and no output may pitch our service. Runs every tool, so a promo
// line added anywhere later fails here.
test("no promo in any tool output, attribution on every one", async () => {
  const samples = {
    check_business_name: { name: "Smith Plumbing" }, check_gbp_description: { description: "x".repeat(300) },
    check_gbp_post: { text: "Fixed a leak in Geelong today." }, audit_gbp_profile: { review_count: 3 },
    build_review_link: { place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" }, check_review_request: { message: "Hi, review us?" },
    check_review_reply: { reply: "Thanks Sam, glad it worked out.", stars: 5 }, suspension_triage: { status: "suspended" },
    compare_nap: { reference: { name: "A" }, listings: [{ source: "x", name: "A" }] },
    draft_spam_report: { competitor_name: "B", issue: "keyword_name" }, optimisation_checklist: { business_type: "plumber" },
    benchmark_business: { trade: "plumber", review_count: 40, rating: 4.5 }, pick_gbp_category: { trade: "plumber" },
    // No website on these two, so they stay offline and still produce output.
    verify_business_name: { name: "Smith Plumbing" }, audit_business: { business_name: "Smith Plumbing", trade: "plumber", review_count: 40 },
  };
  const ATTR = "Checks by Kangaroo Growth: https://kangaroogrowth.com.au";
  for (const tl of listTools()) {
    // Network-bound tools: nothing to fetch in a unit test. Their sources are
    // checked for promo text below, same as the website audit always has been.
    if (["audit_website_local_seo", "find_google_profile", "read_site_reviews", "list_site_services"].includes(tl.name)) continue;
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tl.name, arguments: samples[tl.name] } });
    const text = (await r.json()).result.content[0].text;
    assert.ok(text.endsWith(ATTR), tl.name + " missing attribution");
    const body = text.slice(0, -ATTR.length);
    assert.ok(!/kangaroo ?growth|free (human )?audit|want a person/i.test(body), tl.name + " has promo text");
  }
  const fs = await import("node:fs");
  for (const f of ["website.js", "site-data.js", "brand-evidence.js", "benchmark-tools.js", "verify-name.js", "audit-business.js"]) {
    const src = fs.readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
    assert.ok(!/kangaroogrowth\.com\.au\/free-tools\/"|free (human )?audit|want a person/i.test(src), f + " has promo text");
  }
});

test("server info carries the brand icons (MCP icons field)", async () => {
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })).json();
  const icons = init.result.serverInfo.icons;
  assert.ok(Array.isArray(icons) && icons.length >= 1);
  for (const i of icons) { assert.match(i.src, /^https:\/\/mcp\.kangaroogrowth\.com\.au\/icon-\d+\.png$/); assert.equal(i.mimeType, "image/png"); }
});

// --- the Fins Up case ----------------------------------------------------
// "Fins Up Electrical" is a real client. The bare rule check calls it RISK over
// the word "Electrical", which is the brand, so the only honest answer was a
// shrug. 41.9% of Australian listings carry a service word, so this is the
// common case, not an edge case. These tests keep the resolution working.
test("brand evidence clears a word the website backs, and only that word", () => {
  const signals = { ok: true, url: "https://x.test/", candidates: [
    { where: "page title", value: "Fins Up Electrical" },
    { where: "schema.org markup", value: "Fins Up Electrical" },
  ] };
  const backed = judgeBrand({ profileName: "Fins Up Electrical", flagged: ["electrical"], signals });
  assert.equal(backed.backed.length, 1);
  assert.equal(backed.unbacked.length, 0);
  assert.equal(backed.agreement.exact, true);

  // Same site, but the profile has had a suburb bolted on that the site never uses.
  const stuffed = judgeBrand({ profileName: "Fins Up Electrical Redcliffe", flagged: ["electrical", "redcliffe"], signals });
  assert.deepEqual(stuffed.backed.map((b) => b.word), ["electrical"]);
  assert.deepEqual(stuffed.unbacked.map((b) => b.word), ["redcliffe"]);
  assert.equal(stuffed.agreement, null);
});

test("verify_business_name without a website still answers, and says what would settle it", async () => {
  const out = await verifyBusinessName({ name: "Fins Up Electrical" });
  assert.match(out.text, /RISK/);
  assert.match(out.text, /website address/i);
});

// --- benchmarks ----------------------------------------------------------
test("benchmarks come from the real sample and rank a business in it", () => {
  const cat = resolveCategory("electrician");
  assert.ok(cat, "electrician should resolve through the trade map");
  assert.equal(cat.row.label, "Electrician");
  assert.ok(cat.row.n >= 20, "never publish a category under the minimum sample");

  const strong = benchmarkBusiness({ trade: "electrician", review_count: 73, rating: 5.0 });
  assert.match(strong.text, /73 puts/);
  assert.match(strong.text, /percentile/);
  // "73th percentile" shipped once. Catch any wrong ordinal, not just that one.
  assert.doesNotMatch(strong.text, /\b\d*(?<!1)[123]th\b/, "wrong ordinal suffix");
  assert.match(strong.text, /73rd percentile/);

  const weak = benchmarkBusiness({ trade: "plumber", review_count: 2, rating: 3.0 });
  assert.match(weak.text, /bottom quarter/);
  assert.match(weak.text, /more review/, "a business below the median must be told the gap");

  // An unknown category must say so rather than invent a ladder.
  const none = benchmarkBusiness({ trade: "artisanal yo-yo repair", review_count: 10 });
  assert.match(none.text, /No Australian benchmark/);
});

test("category picker returns what real businesses use, not a suggestion to go look", () => {
  const out = pickCategory({ trade: "electrician" });
  assert.match(out.text, /USE THIS: Electrician/);
  assert.match(out.text, /for an electrician/, "article agreement");
  assert.doesNotMatch(out.text, /search your trade plus your suburb/, "that fallback is only for unknown trades");
});

test("benchmark: the name flag rate is never stated as a rule-break rate (Ben, 2026-11-17)", () => {
  for (const args of [{ category: "electrician", review_count: 30, rating: 4.8 }, { category: "zzz no such category" }]) {
    const out = benchmarkBusiness(args).text;
    assert.doesNotMatch(out, /rules do not allow|likely reportable|break (google's|the) (naming )?rules/i);
    assert.match(out, /flagged by the basic name check/);
  }
});
