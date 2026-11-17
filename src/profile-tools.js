// Profile-level tools: completeness scorecard, review link + QR, suspension triage,
// NAP consistency, competitor spam reports, the optimisation checklist.
import qrcode from "qrcode-generator";
import { SOURCES, checkBusinessName, checkDescription } from "./text-checks.js";


// ---------------------------------------------------------------- scorecard
// Weights follow what moves calls, not what is easy to fill. Unknown fields are
// listed as "check" and score nothing, so a blank input can't look like a pass.
export function auditProfile(p = {}) {
  const rows = [];
  const add = (key, weight, state, note) => rows.push({ key, weight, state, note });
  const known = (v) => v !== undefined && v !== null && v !== "";
  const num = (v) => (known(v) ? Number(v) : undefined);

  // Categories
  const extra = Array.isArray(p.additional_categories) ? p.additional_categories.filter(Boolean) : undefined;
  if (!known(p.primary_category)) add("Primary category", 12, "check", "Unknown. The primary category is the biggest single ranking factor on the profile. It should match the service that earns you the most money, and match what the top 3 in the map pack use.");
  else add("Primary category", 12, "ok", `"${p.primary_category}". Check it matches what the top 3 competitors in your map pack use for the same search.`);
  if (extra === undefined) add("Additional categories", 8, "check", "Unknown. Most profiles leave this at zero. Add every category that is true for the business (up to 9).");
  else if (extra.length === 0) add("Additional categories", 8, "fix", "None. Go through each service on your website, type it into the Additional category box, and add every one Google actually has. Each one is another search you can show up for.");
  else if (extra.length < 3) add("Additional categories", 8, "part", `${extra.length}. Check every service on your site for a matching category.`);
  else add("Additional categories", 8, "ok", `${extra.length} added.`);

  // Name
  if (known(p.name)) {
    const nc = checkBusinessName({ name: p.name, city: p.city || "" });
    add("Business name", 8, nc.verdict === "PASS" ? "ok" : "fix", nc.verdict === "PASS" ? "No guideline problems." : `${nc.verdict}: ${nc.issues.map((i) => i.problem).join(" ")} (run check_business_name for the fix).`);
  } else add("Business name", 8, "check", "Not given.");

  // Description
  if (known(p.description)) {
    const dc = checkDescription({ description: p.description, business_name: p.name || "", city: p.city || "" });
    add("Description", 6, dc.verdict === "PASS" ? "ok" : dc.verdict === "FAIL" ? "fix" : "part", `${dc.chars}/750 chars, ${dc.verdict}. ${dc.issues.slice(0, 2).map((i) => i.problem).join(" ")}`);
  } else add("Description", 6, "check", "Not given. 750 characters to say what you do and where.");

  // Reviews
  const rc = num(p.review_count), r30 = num(p.reviews_last_30_days), age = num(p.days_since_newest_review), rating = num(p.average_rating), reply = num(p.reply_rate_percent);
  if (rc === undefined) add("Review count", 10, "check", "Unknown.");
  else if (rc < 10) add("Review count", 10, "fix", `${rc}. Under 10 reviews costs you clicks against anyone with more. Ask every customer (build_review_link + check_review_request).`);
  else if (rc < 50) add("Review count", 10, "part", `${rc}. Next target 50.`);
  else add("Review count", 10, "ok", `${rc}.`);
  if (r30 === undefined && age === undefined) add("Review velocity", 10, "check", "Unknown. Reviews in the last 30 days and days since the newest matter as much as the total.");
  else {
    const slow = (r30 !== undefined && r30 < 4) || (age !== undefined && age > 14);
    add("Review velocity", 10, slow ? "fix" : "ok", `${r30 ?? "?"} in the last 30 days, newest ${age ?? "?"} days old. Target: 4+ a month, newest under 7 days old. A total that stopped growing looks like a business that stopped trading.`);
  }
  if (rating !== undefined) add("Average rating", 4, rating >= 4.5 ? "ok" : rating >= 4.0 ? "part" : "fix", `${rating}. ${rating < 4.5 ? "More fresh reviews is the only fix that lasts. Never filter who gets asked." : ""}`);
  if (reply === undefined) add("Review replies", 5, "check", "Unknown reply rate.");
  else add("Review replies", 5, reply >= 90 ? "ok" : reply >= 50 ? "part" : "fix", `${reply}% replied. Reply to every review, good and bad, within a few days (check_review_reply).`);

  // Photos
  const photos = num(p.photos_count);
  if (photos === undefined) add("Photos", 7, "check", "Unknown.");
  else add("Photos", 7, photos >= 30 ? "ok" : photos >= 10 ? "part" : "fix", `${photos}. Real job photos, a few every month. Volume is the lever. Fill the logo and cover slots too${p.has_logo === false || p.has_cover === false ? " (logo or cover missing)" : ""}.`);

  // Services, products
  const sc = num(p.services_count), sd = num(p.services_with_descriptions), pc = num(p.products_count);
  if (sc === undefined) add("Services", 7, "check", "Unknown.");
  else add("Services", 7, sc >= 10 && (sd === undefined || sd >= sc * 0.8) ? "ok" : "fix", `${sc} services${sd !== undefined ? `, ${sd} with descriptions` : ""}. Tick every Google-suggested service you really do (up to 25), and give each a 300-character description with one concrete fact.`);
  if (pc === undefined) add("Products", 4, "check", "Unknown.");
  else add("Products", 4, pc >= 10 ? "ok" : pc > 0 ? "part" : "fix", `${pc}. Target 10+, one per real job type, each with a photo and a link to its own service page.`);

  // Posts
  const posts = num(p.posts_last_30_days);
  if (posts === undefined) add("Posts", 3, "check", "Unknown.");
  else add("Posts", 3, posts >= 4 ? "ok" : posts >= 1 ? "part" : "fix", `${posts} in 30 days. Once a week, same day. Run check_gbp_post before you publish.`);

  // Contact surfaces
  if (!known(p.website_url)) add("Website link", 5, "check", "Unknown.");
  else {
    const utm = /utm_source=google/i.test(p.website_url);
    add("Website link", 5, utm ? "ok" : "part", `${p.website_url}${utm ? "" : ". Add ?utm_source=google&utm_medium=organic&utm_campaign=gbp_listing so analytics shows which visits came from the profile. Point it at the page whose heading names your main service and city."}`);
  }
  if (p.booking_url === false || p.booking_url === "") add("Booking link", 3, "fix", "None. Set it to your quote or contact form if you don't have a booking system. It adds another button.");
  else if (known(p.booking_url)) add("Booking link", 3, "ok", "Set.");
  if (p.chat_links === false) add("Chat / SMS links", 2, "fix", "None. Add an sms: link and a wa.me WhatsApp link in Contact. Free extra ways to reach you.");
  else if (p.chat_links === true) add("Chat / SMS links", 2, "ok", "Set.");
  if (p.hours_set === false) add("Opening hours", 4, "fix", "Missing. Profiles without hours lose \"open now\" searches.");
  else if (p.hours_set === true) add("Opening hours", 4, "ok", "Set.");

  // Service area / address
  if (p.is_service_area_business === true) {
    if (p.address_shown === true) add("Address visibility", 6, "fix", "A service-area business (you go to the customer) showing a street address. Google says to hide the address unless customers come to you. This is a common suspension cause.");
    const areas = Array.isArray(p.service_areas) ? p.service_areas.length : num(p.service_areas_count);
    if (areas !== undefined) add("Service areas", 4, areas >= 5 ? "ok" : "part", `${areas} areas. List every suburb or region you really travel to, staying within about 2 hours' drive of your base.`);
  }
  if (p.opening_date_set === false) add("Opening date", 1, "fix", "Not set. Use the earliest date you can prove (ABN registration or first review).");

  let max = 0, got = 0;
  for (const r of rows) {
    if (r.state === "check") continue;
    max += r.weight;
    got += r.state === "ok" ? r.weight : r.state === "part" ? r.weight / 2 : 0;
  }
  const score = max ? Math.round((got / max) * 100) : 0;
  const order = { fix: 0, part: 1, check: 2, ok: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || b.weight - a.weight);
  const label = { fix: "FIX", part: "IMPROVE", check: "CHECK", ok: "OK" };
  const unknown = rows.filter((r) => r.state === "check").length;
  const text = [
    `Google Business Profile scorecard${p.name ? `: ${p.name}` : ""}`,
    `Score: ${score}/100 on the ${rows.length - unknown} items we could check${unknown ? ` (${unknown} items unknown, not counted. Fill them in for a full score)` : ""}.`,
    "",
    "In priority order (biggest impact first):",
    ...rows.map((r, i) => `${i + 1}. [${label[r.state]}] ${r.key}: ${r.note}`),
    "",
    "Scoring weights follow what moves calls: categories, reviews and their recency, and photos count most. Posts count least.",
  ].join("\n");
  return { score, rows, text };
}

// ---------------------------------------------------------------- review link
export function buildReviewLink({ place_id, business_name = "" }) {
  const id = String(place_id || "").trim();
  const issues = [];
  if (!id) return { error: true, text: `No Place ID given. Find yours: search the business name at ${SOURCES.placeIdFinder} (the Place ID finder map), or in Google Business Profile go to Read reviews / Get more reviews and copy the share link instead.` };
  if (/^\d{6,}$/.test(id) || /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(id)) {
    return { error: true, text: `"${id}" looks like a CID or a Maps feature ID, not a Place ID. Review links need the Place ID, which usually starts with "ChIJ" and is about 27 characters long. Look it up at ${SOURCES.placeIdFinder}.` };
  }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) issues.push(`"${id}" doesn't look like a normal Place ID (letters, numbers, - and _, usually starting with ChIJ). Double-check it.`);
  else if (!/^(ChIJ|GhIJ|EiI|Ei)/.test(id)) issues.push("Most business Place IDs start with ChIJ. Yours doesn't, which can be fine, but test the link on your phone before you print it.");
  const link = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const gif = qr.createDataURL(8, 16).replace(/^data:image\/gif;base64,/, "");
  const text = [
    `Review link${business_name ? ` for ${business_name}` : ""}:`,
    link,
    "",
    ...(issues.length ? ["Warnings:", ...issues.map((x) => `- ${x}`), ""] : []),
    "Before you send it to anyone: open it on your phone while logged in to Google. The review box for YOUR business should open. Google sends an invalid ID to the same page as a valid one, so testing it is the only way to know.",
    "Google's own alternative: in your Business Profile, Read reviews > Get more reviews gives a g.page short link. Either is fine. Use one and stick to it.",
    "The QR code below opens the same link. Print it on invoices, the ute, the counter.",
    "Then run the wording through check_review_request so the ask itself is compliant.",
  ].join("\n");
  return { link, qrGifBase64: gif, text };
}

// ---------------------------------------------------------------- suspension triage
export function suspensionTriage(a = {}) {
  const status = String(a.status || "").toLowerCase();
  const causes = [];
  const c = (cond, weight, cause, fix) => cond && causes.push({ weight, cause, fix });
  c(a.name_has_extra_words, 9, "Keywords, location or a tagline in the business name.", "Change the name to exactly what's on your signage and ABN registration before appealing.");
  c(a.service_area_business_showing_address, 8, "Service-area business showing its street address.", "Hide the address (you serve customers at their location). Keep the service area.");
  c(a.virtual_office_or_coworking, 9, "Virtual office, coworking desk or shared address.", "Not eligible unless staffed during business hours with your own signage. A home-based service business should hide its address.");
  c(a.po_box_or_mailbox, 10, "PO box or mailbox (including a UPS-style suite) used as the address.", "Not allowed. Use the real place you operate from, hidden if customers don't visit.");
  c(a.recent_major_edits, 6, "Several big edits at once (name, address, category, phone).", "Make one change at a time, a few days apart. Big edits trigger re-verification.");
  c(a.multiple_profiles, 7, "More than one profile for the same business, or one per service or suburb.", "One profile per real location. Remove duplicates rather than appealing for them.");
  c(a.phone_not_local_or_tracking, 4, "A call-centre, premium (1900) or unrelated tracking number as the main phone.", "Use a number the business controls and answers. Keep tracking numbers to a secondary field.");
  c(a.website_mismatch, 4, "The website doesn't show the same name, phone and area as the profile.", "Make the site's footer and contact page match the profile exactly.");
  c(a.recently_moved_or_rebranded, 5, "Recent move or rebrand.", "Get proof of the new name or address (signage photos, utility bill, ABN record) before you appeal.");
  c(a.restricted_category, 6, "Restricted or high-spam category (locksmith, garage doors, towing, pest, removalists, plumbing and rubbish removal are frequent targets).", "Expect stricter checks. Video verification with signage, a vehicle with branding, tools and an ABN document on camera.");
  causes.sort((x, y) => y.weight - x.weight);

  let path;
  if (status.includes("suspend") || status.includes("disabled") || status.includes("removed")) path = `Fix every likely cause below FIRST, then file an appeal in the Business Profile appeals tool (${SOURCES.appeals}). You usually get one good shot. Attach evidence, never create a new profile (that resets everything and links the two), and don't edit the profile while the appeal is under review.`;
  else if (status.includes("verif") || status.includes("unverified") || status.includes("pending")) path = "This is a verification problem, not a suspension. Re-verify (usually by video). Plan the video using the shot list below and record it in one continuous take.";
  else if (status.includes("limit") || status.includes("not showing") || status.includes("disappear")) path = "Limited or not showing is often a filter or a recent edit, not a suspension. Check the profile in Google Maps logged out, revert any recent edit that broke a guideline, and wait 7-14 days before appealing.";
  else path = "Tell me the exact status Google shows (suspended, disabled, pending verification, limited) for a precise next step.";

  const text = [
    `Suspension triage${status ? `: status: ${status}` : ""}`,
    "",
    "Next step:",
    path,
    "",
    causes.length ? "Likely causes, most serious first:" : "No obvious cause from your answers. Re-check the name, address and website against the guidelines.",
    ...causes.map((x, i) => `${i + 1}. ${x.cause}\n   Fix: ${x.fix}`),
    "",
    "Evidence to gather before appealing (Australian businesses):",
    "- ABN or ASIC registration showing the exact business name",
    "- Trade licence (electrical, plumbing, builder etc.) in the business name",
    "- A utility bill or lease for the address you operate from",
    "- Photos of permanent signage, branded vehicle, uniforms",
    "- A website page with the same name, phone and area",
    "",
    "Video verification shot list (one continuous take, no cuts):",
    "1. Start outside: street sign or a landmark that shows where you are.",
    "2. Walk to the business (or the branded vehicle for a mobile business) without cutting.",
    "3. Permanent signage with the business name.",
    "4. Inside or the vehicle: tools and equipment of the trade.",
    "5. Proof of management: unlock the door, office or van, or show a business document with the name.",
    "",
    "Don't: make a second profile, keep editing during review, or pay anyone promising guaranteed reinstatement.",
    `Rules: ${SOURCES.guidelines}`,
  ].join("\n");
  return { causes, text };
}

// ---------------------------------------------------------------- NAP
const ABBR = { street: "st", st: "st", road: "rd", rd: "rd", avenue: "ave", ave: "ave", drive: "dr", dr: "dr", court: "ct", ct: "ct", place: "pl", pl: "pl", parade: "pde", pde: "pde", highway: "hwy", hwy: "hwy", crescent: "cres", cres: "cres", boulevard: "blvd", blvd: "blvd", lane: "ln", ln: "ln", terrace: "tce", tce: "tce", close: "cl", cl: "cl", suite: "unit", ste: "unit", unit: "unit", level: "lvl", lvl: "lvl", shop: "shop", victoria: "vic", "new south wales": "nsw", queensland: "qld", "western australia": "wa", "south australia": "sa", tasmania: "tas", "australian capital territory": "act", "northern territory": "nt" };
export function normName(s = "") { return s.toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/\b(pty|ltd|limited|the)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
export function normPhone(s = "") { let d = s.replace(/\D/g, ""); if (d.startsWith("61")) d = "0" + d.slice(2); return d; }
export function normAddr(s = "") {
  let t = s.toLowerCase().replace(/#/g, " unit ").replace(/[.,]/g, " ");
  for (const [k, v] of Object.entries(ABBR)) t = t.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  t = t.replace(/\baustralia\b/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(\d+)\s*\/\s*(\d+)/, "unit $1 $2");
  return t;
}
export function compareNap({ reference = {}, listings = [] }) {
  const ref = { name: normName(reference.name), addr: normAddr(reference.address || ""), phone: normPhone(reference.phone || "") };
  const out = [];
  for (const l of listings) {
    const src = l.source || "listing";
    const blob = l.text || "";
    const row = { source: src, problems: [] };
    const name = l.name ?? "";
    const addr = l.address ?? "";
    const phone = l.phone ?? (blob.match(/(?:\+?61|0)[\d\s()-]{8,13}\d/) || [""])[0];
    if (reference.name) {
      if (name) { if (normName(name) !== ref.name) row.problems.push(`Name differs: "${name}"`); }
      else if (blob && !normName(blob).includes(ref.name)) row.problems.push("Name not found in the listing text");
    }
    if (reference.phone) {
      if (phone) { if (normPhone(phone) !== ref.phone) row.problems.push(`Phone differs: "${phone}"`); }
      else row.problems.push("No phone found");
    }
    if (reference.address) {
      const a = addr || blob;
      if (!a) row.problems.push("No address given");
      else {
        const na = normAddr(a);
        const refTokens = ref.addr.split(" ").filter((x) => x.length > 1);
        const missing = refTokens.filter((t) => !na.split(" ").includes(t));
        if (addr && missing.length) row.problems.push(`Address differs (missing: ${missing.join(", ")}): "${addr}"`);
        else if (!addr && missing.length > refTokens.length / 2) row.problems.push("Address not found in the listing text");
      }
    }
    out.push(row);
  }
  const bad = out.filter((r) => r.problems.length);
  const text = [
    `NAP consistency: ${out.length} listings checked, ${bad.length} with problems.`,
    `Reference: ${reference.name || "?"} | ${reference.address || "(no address, fine for a service-area business)"} | ${reference.phone || "?"}`,
    "",
    ...out.map((r) => `- ${r.source}: ${r.problems.length ? r.problems.join("; ") : "matches"}`),
    "",
    "Small formatting differences (St vs Street, +61 vs 0) are already ignored. What's flagged above is a real mismatch. Fix the listing to match your Google profile exactly.",
    "",
    "Australian directories worth having, in order: Apple Business Connect, Bing Places, Facebook page, Yellow Pages (yellow.com.au), True Local, Hotfrog, StartLocal, Yelp AU, Word of Mouth, your trade association's member directory, hipages or ServiceSeeking for trades.",
    "Service-area businesses: hide the street address everywhere you can, the same way as on Google.",
  ].join("\n");
  return { results: out, text };
}

// ---------------------------------------------------------------- competitor spam
export function draftSpamReport({ competitor_name, issue, evidence = [], your_business = "" }) {
  const kind = String(issue || "").toLowerCase();
  const map = {
    keyword_name: { title: "Keyword-stuffed business name", body: (n) => `The listing "${n}" adds service and location keywords to its name that aren't part of its real-world business name. Its website, signage and ABN registration show the business as a different, shorter name. This breaks the Guidelines for representing your business (business name section).`, route: "Suggest an edit on the listing (Edit name) with the real name. If it isn't fixed in 2-3 weeks, use the Business Redressal Complaint Form." },
    fake_address: { title: "Fake or virtual address", body: (n) => `The listing "${n}" uses an address where the business does not operate: a virtual office, mailbox, coworking desk or a residence with no signage or staff. Street View and the attached evidence show no business at this location.`, route: "Business Redressal Complaint Form, with photos or Street View links." },
    duplicate: { title: "Duplicate or lead-gen listings", body: (n) => `"${n}" appears to be one of several listings run by the same operator for the same business (same phone, website or owner), created to take up extra places in the map results.`, route: "Business Redressal Complaint Form listing every duplicate's Maps link." },
    fake_reviews: { title: "Fake reviews", body: (n) => `"${n}" appears to have fake reviews: bursts of 5-star reviews from new accounts with no other reviews, posted in a short window, often with similar wording.`, route: "Flag each review as \"Fake or deceptive\" from the review's menu. For a widespread pattern, also use the Business Redressal Complaint Form. In Australia, fake reviews can also be reported to the ACCC." },
    closed: { title: "Business not operating", body: (n) => `"${n}" no longer operates at this location (or at all).`, route: "Suggest an edit > Close or remove > Permanently closed / Doesn't exist." },
  };
  const key = Object.keys(map).find((k) => kind.includes(k.split("_")[0]) || kind.includes(k)) || "keyword_name";
  const m = map[key];
  const n = competitor_name || "<listing name>";
  const ev = evidence.length ? evidence.map((e) => `- ${e}`).join("\n") : "- <Maps link to the listing>\n- <their website or ABN lookup showing the real name>\n- <screenshots or Street View link>";
  const text = [
    `Spam report draft: ${m.title}`,
    "",
    `Where to send it: ${m.route}`,
    `Form: ${SOURCES.redressal}`,
    "",
    "Text to paste:",
    "---",
    m.body(n),
    "",
    "Evidence:",
    ev,
    "",
    "I'm reporting this because it misleads people searching for local businesses in this area.",
    "---",
    "",
    "Tips: be factual and short, attach evidence, report one problem per form, and don't threaten or accuse. Keep a copy, because you may need to resubmit after 2-3 weeks. Reporting a competitor who follows the rules wastes your credibility, so check the guidelines first.",
    `Rules: ${SOURCES.guidelines}`,
  ].join("\n");
  return { text };
}

// ---------------------------------------------------------------- checklist
export function optimisationChecklist({ business_type = "", city = "", service_area_business = true }) {
  const t = business_type || "your trade";
  const steps = [
    ["Primary category", `Search "${t} ${city || "<your suburb>"}" in Google Maps. Note the primary category of the top 3. Yours should match them AND the service that earns you the most. Never flip a primary that already ranks. Add the new one as a secondary first.`],
    ["Additional categories", "Go through every service on your website. Type each into the Additional category box and add every one Google actually has. Read each option before clicking, because the typeahead matches loosely."],
    ["Business name", "Exactly what's on your signage and ABN registration. No suburbs, no keywords (check_business_name)."],
    ["Description", "750 characters: who and where, the actual list of jobs, why you, how to contact. No links, no prices (check_gbp_description)."],
    ["Contact", `Real phone. Website link with ?utm_source=google&utm_medium=organic&utm_campaign=gbp_listing, pointing at the page that names your main service and city. Add sms: and WhatsApp (wa.me) chat links. Add every social profile.`],
    ["Location", service_area_business ? "Hide the street address (customers don't come to you). Add every suburb you really travel to, within about 2 hours' drive." : "Exact address with the map pin on your door. Check it on Street View."],
    ["Hours", "Real opening hours and public-holiday hours. If someone really answers the phone out of hours, add Online operating hours too."],
    ["Attributes", "Fill every attribute that is true: online estimates, onsite services, wheelchair access, identifies as women-owned and so on."],
    ["Services", "Tick every Google-suggested service you really do (up to 25). Write a 300-character description for each with one concrete fact: warranty, licence, turnaround, area. Don't repeat the same template 16 times."],
    ["Products", "10+ products, one per real job type, each with a real job photo and a link to its own service page section. Leave the price blank unless it's on your site."],
    ["Photos", "Logo, cover, then real job photos, a few every month. Re-save phone photos as plain JPEGs if uploads fail without an error."],
    ["Reviews", "Ask every customer the same way within 2 hours of the job, with a direct link (build_review_link). Reply to every review (check_review_reply). Target 4+ a month, newest under a week old."],
    ["Posts", "One a week, same day. Job, service plus area, a Learn more button to the service page. No phone number in the text (check_gbp_post)."],
    ["Booking", "Set the booking URL even if it's only your quote form."],
    ["Website match", "Name, phone and service area on the website must match the profile exactly, with LocalBusiness schema (audit_website_local_seo)."],
    ["Citations", "Same name, phone and area on Apple, Bing, Facebook, Yellow Pages, True Local, Hotfrog (compare_nap)."],
    ["Pace", "Don't change everything in one sitting on a new or recently suspended profile. Spread big edits over a week or two."],
  ];
  return { text: [`Google Business Profile optimisation checklist${business_type ? `: ${business_type}` : ""}${city ? `, ${city}` : ""}`, "", ...steps.map(([h, b], i) => `${i + 1}. ${h}: ${b}`)].join("\n") };
}

