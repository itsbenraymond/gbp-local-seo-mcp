// Website local-SEO audit. Fetches one public page with HTMLRewriter (streaming, cheap on
// CPU, never holds the raw HTML in memory as a string we return) and checks the local layer:
// title, H1, tel: links, LocalBusiness schema, NAP match, map embed, mobile viewport, indexing.
// Only extracted facts go back to the caller, never page content, so this can't be used as a proxy.
import { normPhone, normName } from "./profile-tools.js";

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;

export function safeUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("No URL given.");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { throw new Error(`"${raw}" isn't a valid web address.`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https addresses can be checked.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Only standard web ports can be checked.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || !h.includes(".")) throw new Error("That address isn't a public website.");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) throw new Error("Give the website's domain name, not an IP address.");
  if (u.username || u.password) throw new Error("Addresses with logins in them can't be checked.");
  return u;
}

async function timedFetch(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; KangarooGrowthLocalSEO/1.0; +https://kangaroogrowth.com.au/free-tools/)", accept: "text/html,application/xhtml+xml", ...(init.headers || {}) } });
  } finally { clearTimeout(t); }
}

export async function auditWebsite({ url, business_name = "", phone = "", suburb = "", main_service = "" }) {
  const u = safeUrl(url);
  const started = Date.now();
  let res;
  try { res = await timedFetch(u.toString()); }
  catch (e) { return { text: `Couldn't load ${u} (${e.name === "AbortError" ? "timed out after 10 seconds" : "connection failed"}). If it loads in your browser, the site may be blocking automated checks.` }; }
  const ms = Date.now() - started;
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) return { text: `${u} returned HTTP ${res.status}. Google sees the same error. Fix the page first.` };
  if (!ct.includes("html")) return { text: `${u} isn't an HTML page (content-type ${ct}).` };

  const f = { title: "", metaDesc: "", h1: [], tel: [], jsonld: [], viewport: false, canonical: "", robots: "", lang: "", mapEmbed: false, imgs: 0, imgsNoAlt: 0, forms: 0, ogImage: false, textLen: 0, text: "" };
  let bytes = 0;
  const rw = new HTMLRewriter()
    .on("html", { element(e) { f.lang = e.getAttribute("lang") || ""; } })
    .on("title", { text(t) { f.title += t.text; } })
    .on("meta", { element(e) {
      const n = (e.getAttribute("name") || "").toLowerCase(); const p = (e.getAttribute("property") || "").toLowerCase();
      if (n === "description") f.metaDesc = e.getAttribute("content") || "";
      if (n === "viewport") f.viewport = true;
      if (n === "robots") f.robots = (e.getAttribute("content") || "").toLowerCase();
      if (p === "og:image") f.ogImage = true;
    } })
    .on("link[rel=canonical]", { element(e) { f.canonical = e.getAttribute("href") || ""; } })
    .on("h1", { element() { f.h1.push(""); }, text(t) { if (f.h1.length) f.h1[f.h1.length - 1] += t.text; } })
    .on("a[href^='tel:']", { element(e) { f.tel.push(e.getAttribute("href").slice(4)); } })
    .on("script[type='application/ld+json']", { element() { f.jsonld.push(""); }, text(t) { f.jsonld[f.jsonld.length - 1] += t.text; } })
    .on("iframe", { element(e) { const s = e.getAttribute("src") || e.getAttribute("data-src") || ""; if (/google\.[a-z.]+\/maps|maps\.google/.test(s)) f.mapEmbed = true; } })
    .on("img", { element(e) { f.imgs++; if (!(e.getAttribute("alt") || "").trim()) f.imgsNoAlt++; } })
    .on("form", { element() { f.forms++; } })
    .on("body", { text(t) { if (f.text.length < 200_000) f.text += t.text; } });

  const transformed = rw.transform(new Response(res.body, { headers: { "content-type": ct } }));
  const reader = transformed.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) { await reader.cancel(); break; }
  }

  // Schema
  const types = [];
  let biz = null;
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const t = [].concat(o["@type"] || []);
    t.forEach((x) => types.push(String(x)));
    if (!biz && t.some((x) => /LocalBusiness|Store|Plumber|Electrician|Roofing|HVAC|Locksmith|Mover|Painter|Dentist|Physician|Restaurant|Salon|HairSalon|BeautySalon|AutoRepair|HomeAndConstructionBusiness|ProfessionalService|LegalService|MedicalBusiness|Organization|GeneralContractor|HousePainter|RoofingContractor|MovingCompany|PestControl|DaySpa|HealthAndBeautyBusiness|NailSalon|AutomotiveBusiness/i.test(x))) biz = o;
    if (o["@graph"]) walk(o["@graph"]);
  };
  let badJson = 0;
  for (const raw of f.jsonld) { try { walk(JSON.parse(raw)); } catch { badJson++; } }
  const isLocal = types.some((x) => !/^(WebSite|WebPage|BreadcrumbList|ImageObject|SearchAction|FAQPage|Question|Answer|Person|Article|BlogPosting|ItemList|ListItem|Organization|Offer|Service|AggregateRating|Review|Rating|PostalAddress|GeoCoordinates|ContactPoint|OpeningHoursSpecification|Place|City|State|Country)$/i.test(x));

  const title = f.title.trim(); const h1s = f.h1.map((x) => x.trim()).filter(Boolean);
  const body = f.text.replace(/\s+/g, " ");
  const bodyLower = body.toLowerCase();
  const checks = [];
  const add = (ok, weight, label, note) => checks.push({ ok, weight, label, note });

  add(u.protocol === "https:" || res.url.startsWith("https:"), 6, "HTTPS", "Required. Browsers mark http pages \"Not secure\".");
  add(f.viewport, 6, "Mobile viewport", "Most local searches are on phones.");
  add(!/noindex/.test(f.robots), 10, "Indexable", f.robots.includes("noindex") ? "This page has noindex. Google will drop it." : "No noindex.");
  add(title.length >= 15 && title.length <= 65, 6, "Title length", `"${title}" (${title.length} chars, aim 30-60).`);
  const svc = main_service.toLowerCase(), sub = suburb.toLowerCase();
  if (svc || sub) add((!svc || title.toLowerCase().includes(svc)) && (!sub || title.toLowerCase().includes(sub)), 10, "Title names service + area", `Should read like "${main_service || "<service>"} in ${suburb || "<suburb>"} | ${business_name || "<brand>"}".`);
  add(h1s.length === 1, 4, "One H1", h1s.length ? `${h1s.length} H1: ${h1s.slice(0, 3).map((x) => `"${x.slice(0, 80)}"`).join(", ")}` : "No H1 at all.");
  if (svc || sub) add(h1s.some((h) => (!svc || h.toLowerCase().includes(svc)) && (!sub || h.toLowerCase().includes(sub))), 6, "H1 names service + area", "The main heading should say what you do and where.");
  add(f.metaDesc.length >= 70 && f.metaDesc.length <= 170, 3, "Meta description", f.metaDesc ? `${f.metaDesc.length} chars.` : "Missing. Google writes its own, usually worse.");
  add(f.tel.length > 0, 10, "Click-to-call link", f.tel.length ? `tel: links found (${[...new Set(f.tel)].slice(0, 3).join(", ")}).` : "No tel: link. On a phone, the number can't be tapped to call. This is the cheapest fix on the list.");
  if (phone) {
    const want = normPhone(phone);
    const onPage = f.tel.some((t) => normPhone(t) === want) || normPhone(body).includes(want);
    add(onPage, 8, "Phone matches profile", onPage ? "Same number as your profile." : `${phone} not found on the page. The site and profile should show the same number.`);
  }
  if (business_name) add(normName(body).includes(normName(business_name)), 5, "Name matches profile", "The business name as it appears on Google should appear on the page.");
  if (sub) add(bodyLower.includes(sub), 5, "Area mentioned in body text", `"${suburb}" ${bodyLower.includes(sub) ? "appears" : "doesn't appear"} in the page text.`);
  add(isLocal || !!biz, 10, "LocalBusiness schema", types.length ? `Schema types: ${[...new Set(types)].slice(0, 8).join(", ")}${badJson ? ` (${badJson} block(s) of invalid JSON)` : ""}.` : "No structured data. Add LocalBusiness (or your trade's subtype) with name, address or areaServed, telephone, url, openingHours, sameAs (link your Google profile and socials).");
  if (biz) {
    const miss = ["name", "telephone", "url"].filter((k) => !biz[k]);
    if (!biz.address && !biz.areaServed) miss.push("address or areaServed");
    if (!biz.sameAs) miss.push("sameAs (link to the Google profile + socials)");
    add(miss.length === 0, 4, "Schema fields complete", miss.length ? `Missing: ${miss.join(", ")}.` : "name, telephone, url, area and sameAs present.");
  }
  add(f.mapEmbed, 2, "Google Map embed", f.mapEmbed ? "Found." : "None. Optional, but it helps customers and confirms location (more useful for shopfronts).");
  add(f.forms > 0 || /calendly|leadconnector|msgsndr|typeform|jotform|wpforms|gravity|hubspot/.test(bodyLower), 4, "Contact or quote form", f.forms ? `${f.forms} form(s).` : "No form found. Some people won't call. Give them a way to ask for a quote.");
  add(f.imgs === 0 || f.imgsNoAlt / f.imgs < 0.3, 2, "Image alt text", `${f.imgsNoAlt}/${f.imgs} images missing alt text.`);
  add(/\b(review|testimonial|★|stars?|rated)\b/i.test(body), 3, "Reviews / proof on page", "Show real reviews on the page. They turn visitors into calls.");
  add(ms < 3000, 4, "Server response", `${ms} ms to first response + download.`);
  add(!!f.lang, 1, "Language set", f.lang || "No lang attribute.");
  add(!!f.canonical, 1, "Canonical tag", f.canonical || "None.");

  // robots.txt / sitemap, cheap HEAD-style checks
  let sitemap = false, robotsBlocks = false;
  try { const r = await timedFetch(new URL("/robots.txt", u).toString()); if (r.ok) { const t = (await r.text()).slice(0, 20000); robotsBlocks = /user-agent:\s*\*[\s\S]*?\ndisallow:\s*\/\s*(\n|$)/i.test(t); sitemap = /sitemap:/i.test(t); } } catch {}
  if (!sitemap) { try { const s = await timedFetch(new URL("/sitemap.xml", u).toString()); sitemap = s.ok && (s.headers.get("content-type") || "").includes("xml"); s.body?.cancel(); } catch {} }
  add(!robotsBlocks, 10, "robots.txt allows Google", robotsBlocks ? "robots.txt blocks every crawler from the whole site." : "Not blocked.");
  add(sitemap, 2, "Sitemap", sitemap ? "Found." : "No sitemap.xml found or referenced in robots.txt.");

  let max = 0, got = 0;
  for (const c of checks) { max += c.weight; if (c.ok) got += c.weight; }
  const score = Math.round((got / max) * 100);
  const fails = checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);
  const passes = checks.filter((c) => c.ok);
  const text = [
    `Local SEO website audit: ${res.url || u.toString()}`,
    `Score: ${score}/100 (${passes.length}/${checks.length} checks passed). Checked the one page you gave me.`,
    "",
    fails.length ? "Fix, biggest impact first:" : "Nothing to fix on the local layer of this page.",
    ...fails.map((c, i) => `${i + 1}. ${c.label}: ${c.note}`),
    "",
    "Passed:",
    ...passes.map((c) => `- ${c.label}: ${c.note}`),
    "",
    !phone || !business_name || !suburb || !main_service ? "Tip: pass business_name, phone, suburb and main_service to also check the page matches your Google profile." : "",
  ].filter((l) => l !== "").join("\n");
  return { score, checks, text };
}
