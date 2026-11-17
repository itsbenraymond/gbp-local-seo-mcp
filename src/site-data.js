// Read-only facts pulled from a business's own public website.
//
// The test run on Fins Up ended with "I couldn't find the listing on Google
// Maps, what's the website URL, the review count, the rating and the phone?"
// Almost all of that is sitting on the business's own site, in public, and a
// person asking an AI for help should not have to go and look it up by hand.
//
// Three things come out of here:
//   findGoogleProfile  the Google profile link / CID / Place ID the site links to
//   readSiteReviews    rating, review count and recent review text from schema.org
//   listSiteServices   the service pages and suburb pages, from the sitemap and nav
//
// Everything is GET, public pages only, same safeUrl guard as the website audit,
// and only extracted facts come back, never page content.
import { safeUrl } from "./website.js";

const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; KangarooGrowthLocalSEO/1.0; +https://kangaroogrowth.com.au/free-tools/)";
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function get(url, accept = "text/html,application/xhtml+xml") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept } });
  } catch (e) {
    return { ok: false, status: 0, _err: e.name === "AbortError" ? "timed out" : "connection failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Every JSON-LD block on a page, parsed, flattened. */
async function jsonLdNodes(res) {
  const blocks = [];
  const rw = new HTMLRewriter().on("script[type='application/ld+json']", {
    element() { blocks.push(""); },
    text(t) { const i = blocks.length - 1; if (i >= 0 && blocks[i].length < 60000) blocks[i] += t.text; },
  });
  try { await rw.transform(res).text(); } catch { return []; }
  const nodes = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    nodes.push(n);
    Object.values(n).forEach(walk);
  };
  for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* a broken block is not a reason to fail */ } }
  return nodes;
}

// ---------------------------------------------------------------- the profile
const GOOGLE_LINK = /(?:https?:\/\/)?(?:www\.)?(?:g\.page\/[^\s"'<>]+|maps\.app\.goo\.gl\/[^\s"'<>]+|(?:maps\.)?google\.[a-z.]+\/(?:maps\/place|maps\?|search\?)[^\s"'<>]*|search\.google\.com\/local\/writereview[^\s"'<>]*)/gi;

export async function findGoogleProfile({ website }) {
  const u = safeUrl(website);
  const res = await get(u.toString());
  if (!res.ok) return { text: `Couldn't read ${u} (${res._err || "HTTP " + res.status}). Without the site there is nothing public to search for the profile link.` };

  const hrefs = [];
  const rw = new HTMLRewriter().on("a", { element(e) { const h = e.getAttribute("href") || ""; if (/google|g\.page|goo\.gl/i.test(h)) hrefs.push(h); } });
  let body = "";
  try { body = await rw.transform(res).text(); } catch { /* fall through to what we collected */ }

  const found = new Set();
  for (const h of hrefs) found.add(h);
  for (const m of String(body).slice(0, 400000).matchAll(GOOGLE_LINK)) found.add(m[0]);

  const links = [...found].filter((h) => !/fonts\.google|googletagmanager|google-analytics|gstatic|googleapis|schema\.org/i.test(h));
  const L = [`Google profile links on ${u.hostname}:`, ""];
  if (!links.length) {
    L.push("None. The site does not link to its Google Business Profile anywhere on the homepage.");
    L.push("");
    L.push("That is worth fixing on its own. A link from the site to the profile, and the website field on the profile pointing back, is the clearest pair of signals that the two are the same business, and it is where most people go to leave a review.");
    L.push("To find the profile by hand: search the business name plus the suburb on Google Maps, open it, press Share, and copy the link. Paste that back here and the other tools can use it.");
    return { text: L.join("\n") };
  }

  // share.google and maps.app.goo.gl links carry nothing until they are
  // followed. Fins Up's site links a share.google URL, so without this the
  // answer was "no Place ID, go and find it yourself" with the ID one hop away.
  let resolved = "";
  const short = links.find((h) => /share\.google|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(h));
  if (short) {
    const hop = await get(short.startsWith("http") ? short : `https://${short}`);
    if (hop.ok && hop.url) resolved = hop.url;
  }
  const hunt = resolved ? [...links, resolved] : links;

  const cid = hunt.map((h) => h.match(/[?&]cid=(\d+)/)).find(Boolean);
  const place = hunt.map((h) => h.match(/place_id[:=]([A-Za-z0-9_-]{20,})/) || h.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)).find(Boolean);
  const review = links.find((h) => /writereview|\/review/i.test(h));

  links.slice(0, 8).forEach((h) => L.push(`  ${h}`));
  if (resolved) L.push(`  (that short link resolves to ${resolved.slice(0, 160)})`);
  L.push("");
  if (place) L.push(`Place ID: ${place[1]} — use it with build_review_link for a direct review link and QR code.`);
  if (cid) L.push(`CID: ${cid[1]}. The profile opens at https://maps.google.com/?cid=${cid[1]}`);
  if (review) L.push(`There is already a review link on the site: ${review}`);
  if (!place && !cid) L.push(`No Place ID or CID in those links. Open the profile, press Share, and the link it gives carries one. build_review_link needs the Place ID.`);
  L.push("");
  L.push(`Check each link opens the right listing. A site linking to the wrong profile, or to a search for the business name, sends reviews somewhere that does not count.`);
  return { text: L.join("\n") };
}

// ---------------------------------------------------------------- the reviews
export async function readSiteReviews({ website }) {
  const u = safeUrl(website);
  const res = await get(u.toString());
  if (!res.ok) return { text: `Couldn't read ${u} (${res._err || "HTTP " + res.status}).` };

  const nodes = await jsonLdNodes(res);
  const agg = nodes.map((n) => n.aggregateRating).find((a) => a && (a.ratingValue !== undefined || a.reviewCount !== undefined || a.ratingCount !== undefined));
  const reviews = nodes.filter((n) => {
    const t = [].concat(n["@type"] || []).join(" ").toLowerCase();
    return t.includes("review") && (n.reviewBody || n.description);
  });

  const L = [`Review data published on ${u.hostname}:`, ""];
  if (!agg && !reviews.length) {
    L.push("None. The site carries no aggregateRating and no Review markup, so nothing about the business's reputation is readable by a machine here.");
    L.push("");
    L.push("Two separate things to fix:");
    L.push("1. Show real reviews on the page. They are the single most persuasive thing on a local business site and most sites bury them.");
    L.push("2. Mark them up. aggregateRating and Review inside your LocalBusiness schema is how Google, and every AI answering a question about you, reads your reputation off the site instead of guessing.");
    L.push("");
    L.push("Careful with aggregateRating: only publish it if the numbers are real and visible on the page. Marking up a rating you do not show is a structured-data violation and Google drops the rich result.");
    return { text: L.join("\n") };
  }

  let foundRating = null, foundCount = null;
  if (agg) {
    const rating = agg.ratingValue, count = agg.reviewCount ?? agg.ratingCount;
    foundRating = Number.parseFloat(rating);
    foundCount = Number.parseInt(String(count ?? "").replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(foundRating)) foundRating = null;
    if (!Number.isFinite(foundCount)) foundCount = null;
    L.push(`Rating ${rating ?? "(not stated)"} from ${count ?? "(count not stated)"} reviews, per the site's own structured data.`);
    L.push(`Feed those two numbers into benchmark_business to see where they actually sit for this trade in Australia.`);
    if (rating === undefined || count === undefined) L.push(`One half of the pair is missing. Google wants ratingValue and reviewCount together, and ignores an incomplete aggregateRating.`);
    L.push("");
  }
  if (reviews.length) {
    L.push(`${reviews.length} individual review${reviews.length === 1 ? "" : "s"} marked up on the page. The most recent:`);
    reviews.slice(0, 3).forEach((r) => {
      const who = clean(typeof r.author === "object" ? r.author?.name : r.author) || "unnamed";
      const stars = r.reviewRating?.ratingValue;
      L.push(`  ${stars ? stars + "★ " : ""}${who}: "${clean(r.reviewBody || r.description).slice(0, 180)}"`);
    });
    L.push("");
    L.push(`Use check_review_reply before you answer any of these. A reply that reads as generated does more damage than no reply.`);
  }
  L.push("");
  L.push(`This is what the site publishes, not what Google holds. If it disagrees with the profile, the site is stale and that gap is itself the finding.`);
  return { text: L.join("\n") };
}

// ---------------------------------------------------------------- the services
const SERVICE_HINT = /\/(services?|what-we-do|our-work|solutions)\//i;
const AREA_HINT = /\/(areas?|service-areas?|locations?|suburbs?|we-service)\//i;
const SKIP = /\/(blog|news|guides?|privacy|terms|refunds?|cart|checkout|account|wp-|tag|category|author|feed)/i;

export async function listSiteServices({ website }) {
  const u = safeUrl(website);
  const origin = u.origin;

  // Sitemap first: it is the site's own list of what it thinks it has.
  let urls = [];
  const sm = await get(`${origin}/sitemap.xml`, "application/xml,text/xml");
  if (sm.ok) {
    const xml = await sm.text().catch(() => "");
    urls = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // A sitemap index points at more sitemaps; follow one level, first child only.
    if (urls.length && /sitemapindex/i.test(xml)) {
      const child = await get(urls[0], "application/xml,text/xml");
      if (child.ok) {
        const cx = await child.text().catch(() => "");
        urls = [...String(cx).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      }
    }
  }

  // No usable sitemap: fall back to the homepage's own internal links.
  let fromNav = false;
  if (!urls.length) {
    const home = await get(u.toString());
    if (!home.ok) return { text: `Couldn't read ${u} or its sitemap (${home._err || "HTTP " + home.status}).` };
    const hrefs = [];
    const rw = new HTMLRewriter().on("a", { element(e) { const h = e.getAttribute("href") || ""; if (h && !h.startsWith("#") && !/^(mailto|tel|javascript):/i.test(h)) hrefs.push(h); } });
    try { await rw.transform(home).text(); } catch { /* keep what we have */ }
    urls = hrefs.map((h) => { try { return new URL(h, origin).toString(); } catch { return ""; } }).filter(Boolean);
    fromNav = true;
  }

  const same = [...new Set(urls.filter((x) => { try { return new URL(x).origin === origin; } catch { return false; } }))];
  const pages = same.filter((x) => !SKIP.test(x));
  const services = pages.filter((x) => SERVICE_HINT.test(x));
  const areas = pages.filter((x) => AREA_HINT.test(x));

  const slug = (x) => { try { return decodeURIComponent(new URL(x).pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/[-_]+/g, " ").trim(); } catch { return ""; } };

  const L = [`Pages on ${u.hostname}${fromNav ? " (no sitemap.xml, so this is from the homepage links only)" : ""}:`, ""];
  if (!fromNav) L.push(`${same.length} URL${same.length === 1 ? "" : "s"} in the sitemap.`);

  if (services.length) {
    L.push("");
    L.push(`${services.length} service page${services.length === 1 ? "" : "s"}:`);
    services.slice(0, 30).forEach((x) => L.push(`  ${slug(x)}`));
    L.push("");
    L.push(`Every one of those should also be a Service on the Google profile, with a sentence of its own. The profile and the site listing the same services is one of the cheapest consistency wins there is.`);
  } else {
    L.push("");
    L.push(`No service pages found. A local business site with one page covering everything ranks for nothing specific. A page per service, each naming the service and the area, is the structure that works.`);
  }

  if (areas.length) {
    L.push("");
    L.push(`${areas.length} area page${areas.length === 1 ? "" : "s"}:`);
    areas.slice(0, 30).forEach((x) => L.push(`  ${slug(x)}`));
    L.push("");
    L.push(`Those suburbs should match the service area on the Google profile exactly. A suburb on the site but not on the profile is work you have already done and are not being counted for.`);
  } else {
    L.push("");
    L.push(`No area or suburb pages found. If the business travels to customers, a page per real suburb it services is usually the biggest piece of untapped local SEO on the site. Only build them for suburbs it genuinely works in, with real content on each, or they read as doorway pages.`);
  }

  if (!fromNav && same.length < 5) {
    L.push("");
    L.push(`Only ${same.length} URL${same.length === 1 ? "" : "s"} in the whole sitemap. Either the site is tiny or the sitemap is not being generated properly. Check it in Search Console.`);
  }
  return { text: L.join("\n") };
}
