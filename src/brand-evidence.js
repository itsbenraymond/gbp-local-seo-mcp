// Resolve the one question check_business_name cannot answer on its own:
// is the flagged word actually part of the real-world brand?
//
// Google bans service words and locations in a profile name UNLESS they are the
// genuine real-world name. 41.9% of Australian listings carry a service word, and
// most of those are brands, so a bare rule check calls almost everyone RISK and the
// answer is useless. "Fins Up Electrical" got flagged for "Electrical" and the only
// honest thing to say was a shrug.
//
// The business's own website settles it. If the site's title, schema.org name,
// og:site_name, logo alt text or copyright line all say "Fins Up Electrical", then
// that IS the real-world name and the flag is noise. If the site says "Fins Up" and
// only Google says "Fins Up Electrical", that is a real finding with proof attached.
//
// Only extracted brand strings come back, never page content.
import { safeUrl } from "./website.js";

const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; KangarooGrowthLocalSEO/1.0; +https://kangaroogrowth.com.au/free-tools/)";

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const words = (s) => clean(s).toLowerCase().match(/[a-z0-9']+/g) || [];
// Everything a site name gets padded with, so "Fins Up Electrical | Sparkies in
// Redcliffe" compares as "fins up electrical".
const SEPARATORS = /\s*[|·•—–\-:~»]\s*/;

function brandFromTitle(title) {
  const parts = clean(title).split(SEPARATORS).map(clean).filter(Boolean);
  if (!parts.length) return "";
  // The brand is normally the shortest end segment, not the keyword-stuffed one.
  const ends = [parts[0], parts[parts.length - 1]];
  return ends.sort((a, b) => words(a).length - words(b).length)[0];
}

export async function fetchBrandSignals(url) {
  const u = safeUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
  } catch (e) {
    return { ok: false, url: u.toString(), reason: e.name === "AbortError" ? "timed out after 10 seconds" : "connection failed" };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, url: u.toString(), reason: `returned HTTP ${res.status}` };
  if (!(res.headers.get("content-type") || "").includes("html")) return { ok: false, url: u.toString(), reason: "is not an HTML page" };

  const f = { title: "", ogSite: "", jsonld: [], logoAlt: [], footer: "", abn: "" };
  let footerLen = 0;
  const rw = new HTMLRewriter()
    .on("title", { text(t) { if (f.title.length < 300) f.title += t.text; } })
    .on("meta[property='og:site_name']", { element(e) { f.ogSite = e.getAttribute("content") || ""; } })
    .on("script[type='application/ld+json']", { element() { f.jsonld.push(""); }, text(t) { const i = f.jsonld.length - 1; if (i >= 0 && f.jsonld[i].length < 20000) f.jsonld[i] += t.text; } })
    .on("img", { element(e) {
      const alt = e.getAttribute("alt") || "";
      const src = (e.getAttribute("src") || "") + " " + (e.getAttribute("class") || "") + " " + (e.getAttribute("id") || "");
      if (alt && /logo|brand|mark/i.test(src + " " + alt)) f.logoAlt.push(alt);
    } })
    .on("footer", { text(t) { if (footerLen < 1200) { f.footer += t.text; footerLen += t.text.length; } } });

  try {
    await rw.transform(res).text();
  } catch {
    return { ok: false, url: u.toString(), reason: "could not be parsed" };
  }

  const abn = clean(f.footer).match(/\bABN[:\s]*((?:\d[\s]?){11})/i);
  if (abn) f.abn = abn[1].replace(/\s/g, "");

  // schema.org name / legalName off any LocalBusiness-ish node.
  const schemaNames = [];
  for (const block of f.jsonld) {
    let data;
    try { data = JSON.parse(block); } catch { continue; }
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const t = [].concat(n["@type"] || []).join(" ").toLowerCase();
      if (/business|organization|store|service|company|professional/.test(t)) {
        if (typeof n.legalName === "string") schemaNames.push(clean(n.legalName));
        if (typeof n.name === "string") schemaNames.push(clean(n.name));
      }
      Object.values(n).forEach(walk);
    };
    walk(data);
  }

  const copyright = clean(f.footer).match(/(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*([A-Za-z0-9'&.,\- ]{2,60})/i);

  const candidates = [
    ...schemaNames.map((v) => ({ where: "schema.org markup", value: v })),
    f.ogSite ? { where: "og:site_name", value: clean(f.ogSite) } : null,
    f.title ? { where: "page title", value: brandFromTitle(f.title) } : null,
    ...f.logoAlt.slice(0, 2).map((v) => ({ where: "logo alt text", value: clean(v) })),
    copyright ? { where: "footer copyright", value: clean(copyright[1]) } : null,
  ].filter((c) => c && c.value && words(c.value).length <= 8);

  // De-duplicate on the normalised string, keeping the most authoritative source.
  const outByValue = new Map();
  for (const c of candidates) {
    const k = words(c.value).join(" ");
    if (k && !outByValue.has(k)) outByValue.set(k, c);
  }
  return { ok: true, url: u.toString(), abn: f.abn, candidates: [...outByValue.values()] };
}

/**
 * Decide whether each flagged word is backed by the real-world brand.
 * `flagged` is the list of words check_business_name objected to.
 */
export function judgeBrand({ profileName, flagged = [], signals }) {
  const profileWords = new Set(words(profileName));
  const out = { backed: [], unbacked: [], sources: [], agreement: null };
  if (!signals?.ok) return out;

  const bySource = signals.candidates.map((c) => ({ ...c, w: new Set(words(c.value)) }));
  out.sources = signals.candidates;

  for (const word of flagged) {
    const w = String(word).toLowerCase();
    const hits = bySource.filter((s) => s.w.has(w));
    if (hits.length) out.backed.push({ word, where: hits.map((h) => h.where), as: hits[0].value });
    else out.unbacked.push({ word, siteSays: bySource.map((s) => s.value) });
  }

  // Does any site signal match the profile name word-for-word?
  const pn = [...profileWords].join(" ");
  const exact = bySource.find((s) => [...s.w].join(" ") === pn);
  out.agreement = exact ? { exact: true, where: exact.where, value: exact.value } : null;
  return out;
}
