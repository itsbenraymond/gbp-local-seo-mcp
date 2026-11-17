// Deterministic checks for Google Business Profile text: business name, description,
// posts, review requests and review replies. Pure functions, no network, so every
// tool here costs nothing to run and gives the same answer twice.
//
// Rule sources (checked 2026-11-14):
//   Google, Guidelines for representing your business  https://support.google.com/business/answer/3038177
//   Google, Posts content policy                         https://support.google.com/business/answer/7342169
//   Google, Maps user contributed content policy         https://support.google.com/contributionpolicy/answer/7400114
//   ACCC, Fake online reviews guidance (Australian Consumer Law)

export const SOURCES = {
  guidelines: "https://support.google.com/business/answer/3038177",
  posts: "https://support.google.com/business/answer/7342169",
  reviewsPolicy: "https://support.google.com/contributionpolicy/answer/7400114",
  accc: "https://www.accc.gov.au/consumers/online-shopping/online-reviews",
  appeals: "https://support.google.com/business/answer/4569145",
  redressal: "https://support.google.com/business/contact/business_redressal_complaint",
  placeIdFinder: "https://developers.google.com/maps/documentation/places/web-service/place-id",
};

const PHONE_RE = /(?:\+?61[\s-]?|0)[2-478](?:[\s-]?\d){8}\b|\b1[38]00[\s-]?\d{3}[\s-]?\d{3}\b|\b13[\s-]?\d{2}[\s-]?\d{2}\b|\(\d{2,4}\)\s?\d{3,4}[\s-]?\d{3,4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|au|co|io|biz|info)(?:\.au)?\b(?:\/\S*)?/i;
const SHORTENER_RE = /\b(?:bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|tiny\.cc)\b/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

const SERVICE_WORDS = [
  "plumber", "plumbing", "electrician", "electrical", "roofing", "roofer", "painter", "painting", "cleaning", "cleaner",
  "landscaping", "landscaper", "gardening", "mowing", "lawn", "pest control", "removalist", "removals", "locksmith",
  "concreting", "concreter", "carpenter", "carpentry", "builder", "building", "renovations", "fencing", "tiler", "tiling",
  "air conditioning", "aircon", "hvac", "heating", "cooling", "solar", "glazier", "handyman", "massage", "dentist",
  "dental", "physio", "physiotherapy", "chiropractor", "salon", "hairdresser", "barber", "beauty", "nails", "lashes",
  "mechanic", "auto", "towing", "repairs", "repair", "services", "service", "solutions", "specialists", "specialist",
  "experts", "expert", "emergency", "24/7", "24 hour", "24hr", "cheap", "affordable", "best", "top rated", "no 1", "no. 1",
  "#1", "number one", "near me", "quotes", "free quote",
];

const AU_PLACES = [
  "melbourne", "sydney", "brisbane", "perth", "adelaide", "hobart", "darwin", "canberra", "gold coast", "sunshine coast",
  "geelong", "newcastle", "wollongong", "cairns", "townsville", "toowoomba", "ballarat", "bendigo", "launceston",
  "mackay", "rockhampton", "bunbury", "mandurah", "central coast", "moreton bay", "ipswich", "logan", "parramatta",
  "western suburbs", "eastern suburbs", "northern suburbs", "southern suburbs", "inner west", "north shore",
  "victoria", "vic", "nsw", "new south wales", "queensland", "qld", "wa", "western australia", "sa", "south australia",
  "tasmania", "tas", "act", "nt", "australia",
];

const PROMO_RE = /\b(?:sale|discount|\d+\s?%\s?off|% off|special offer|limited time|coupon|promo code|deal of|cheapest|lowest price|price match|free gift)\b/i;
const PRICE_RE = /\$\s?\d/;
const FILLER = [
  "comprehensive", "dedicated to", "high-quality solutions", "quality solutions", "one-stop shop", "second to none",
  "look no further", "tailored solutions", "cutting-edge", "state-of-the-art", "unparalleled", "seamless", "elevate",
  "navigate", "in today's", "commitment to excellence", "go above and beyond", "your trusted partner", "we pride ourselves",
  "hassle-free", "world-class", "leverage", "bespoke solutions", "delve",
];

function words(s) { return (s.toLowerCase().match(/[a-z0-9'#/]+/g) || []); }
function hasPhrase(text, phrase) {
  const re = new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\#/]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  return re.test(text);
}
function isMostlyCaps(s) {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length > 0.6;
}
function fmtIssues(issues) {
  if (!issues.length) return "No problems found.";
  return issues.map((i, n) => `${n + 1}. [${i.level}] ${i.problem}\n   Fix: ${i.fix}`).join("\n");
}
function verdictFrom(issues) {
  if (issues.some((i) => i.level === "FAIL")) return "FAIL";
  if (issues.some((i) => i.level === "RISK")) return "RISK";
  return "PASS";
}

// ---------------------------------------------------------------- business name
export function checkBusinessName({ name, city = "", category = "", legal_or_signage_name = "" }) {
  const issues = [];
  const n = String(name || "").trim();
  if (!n) return { verdict: "FAIL", text: "No name given." };
  const lower = n.toLowerCase();
  const real = String(legal_or_signage_name || "").trim().toLowerCase();

  const sep = n.match(/\s[|\-–—:]\s|\s\|\s|,\s/);
  if (sep) issues.push({ level: "RISK", problem: `The name has a separator ("${sep[0].trim()}"): usually a tagline or keywords bolted on after the real name.`, fix: "Keep only the name on your signage, letterhead and ABN registration." });

  const foundServices = SERVICE_WORDS.filter((w) => hasPhrase(lower, w) && !(real && hasPhrase(real, w)));
  if (foundServices.length) issues.push({ words: foundServices, level: foundServices.length > 1 ? "FAIL" : "RISK", problem: `Service or marketing words in the name: ${foundServices.join(", ")}.`, fix: "Google bans service descriptions in the name unless they are part of your real-world brand on signage and documents. Remove them, or prove them with signage photos if they really are the brand. Put the services in categories, services and the description instead." });

  const places = AU_PLACES.concat(city ? [city.toLowerCase()] : []).filter((p) => p && hasPhrase(lower, p) && !(real && hasPhrase(real, p)));
  if (places.length) issues.push({ words: [...new Set(places)], level: "FAIL", problem: `Location words in the name: ${[...new Set(places)].join(", ")}.`, fix: "Location info is banned in the name unless it is in the real brand. Your service area goes in the Service area field." });

  if (PHONE_RE.test(n)) issues.push({ level: "FAIL", problem: "A phone number in the name.", fix: "Remove it. The phone goes in the Phone field." });
  if (URL_RE.test(n)) issues.push({ level: "FAIL", problem: "A web address in the name.", fix: "Remove it. The site goes in the Website field." });
  if (/\b(?:open|hours|24\/7|closed)\b/i.test(n)) issues.push({ level: "FAIL", problem: "Hours or open/closed status in the name.", fix: "Remove it. Use the Hours fields." });
  if (n === n.toUpperCase() && /[A-Z]{4,}/.test(n) && !real.includes(lower)) issues.push({ level: "RISK", problem: "The name is in ALL CAPS.", fix: "Use the capitalisation on your signage, unless the brand really is written in caps." });
  if (/[!*★☆✓✔®™]/.test(n)) issues.push({ level: "RISK", problem: "Special characters or symbols in the name.", fix: "Remove symbols that are not part of the legal or signage name." });
  if (/\b(?:pty\.?\s?ltd|ltd|inc|llc)\b/i.test(n)) issues.push({ level: "INFO", problem: "Pty Ltd or a similar legal suffix in the name.", fix: "Allowed only when it is how you present to customers in the real world. Most trades drop it." });
  if (n.length > 60) issues.push({ level: "RISK", problem: `The name is ${n.length} characters long. Real brand names are rarely this long.`, fix: "Long names read as keyword stuffing to reviewers and to Google's automatic checks." });
  if (category && hasPhrase(lower, category.toLowerCase()) && !(real && hasPhrase(real, category.toLowerCase()))) issues.push({ level: "RISK", problem: `Your category "${category}" is also in the name.`, fix: "Fine if it is the real brand (\"Smith Plumbing\" on the ute and invoices). Not fine if it was added for ranking." });

  let suggestion = n.split(/\s[|\-–—:]\s|\s\|\s|,\s/)[0].trim();
  const verdict = verdictFrom(issues);
  const text = [
    `Business name check: "${n}"`,
    `Verdict: ${verdict}${verdict === "PASS" ? ": no guideline problems found." : ""}`,
    "",
    fmtIssues(issues),
    "",
    verdict !== "PASS" && suggestion !== n ? `Likely real name: "${suggestion}" (check it matches your signage and ABN registration).` : "",
    "Why it matters: keyword-stuffed names are the most common reason a profile gets suspended, and a name edit is a common trigger for re-verification. Change the name only to match the real-world name, and make no other big edits in the same week.",
    `Rule: ${SOURCES.guidelines}`,
  ].filter((l) => l !== "").join("\n");
  return { verdict, issues, text };
}

// ---------------------------------------------------------------- description
export function checkDescription({ description, business_name = "", city = "", services = [] }) {
  const d = String(description || "");
  const issues = [];
  const len = d.length;
  if (!d.trim()) return { verdict: "FAIL", text: "No description given. An empty description wastes 750 characters Google lets you use to say what you do and where." };
  if (len > 750) issues.push({ level: "FAIL", problem: `${len} characters. The limit is 750 and Google will refuse to save it.`, fix: `Cut ${len - 750} characters. Drop adjectives before you drop services or suburbs.` });
  else if (len < 250) issues.push({ level: "RISK", problem: `Only ${len} characters. You are leaving most of the 750 unused.`, fix: "Add the actual list of jobs you do and the suburbs you cover." });
  if (URL_RE.test(d)) issues.push({ level: "FAIL", problem: "A link or web address in the description.", fix: "Links are not allowed in the description. Remove it. Your site already sits in the Website field." });
  if (/<[a-z][^>]*>/i.test(d)) issues.push({ level: "FAIL", problem: "HTML in the description.", fix: "Plain text only." });
  if (PROMO_RE.test(d) || PRICE_RE.test(d)) issues.push({ level: "FAIL", problem: "Prices, sales or promotional offers in the description.", fix: "Not allowed here. Put offers in a Post, which is built for them." });
  if (isMostlyCaps(d)) issues.push({ level: "RISK", problem: "Mostly capital letters.", fix: "Write in normal sentence case." });
  const filler = FILLER.filter((f) => d.toLowerCase().includes(f));
  if (filler.length) issues.push({ level: "RISK", problem: `Generic filler phrases: ${filler.join(", ")}.`, fix: "Name the actual jobs instead (\"switchboard upgrades, ceiling fans, smoke alarms\"). Filler reads as AI-written and tells the customer nothing." });
  const w = words(d);
  const counts = {};
  for (const x of w) if (x.length > 3) counts[x] = (counts[x] || 0) + 1;
  const stuffed = Object.entries(counts).filter(([k, c]) => c >= 5 && !["with", "that", "your", "from", "have", "this", "they"].includes(k));
  if (stuffed.length) issues.push({ level: "RISK", problem: `Repeated keywords: ${stuffed.map(([k, c]) => `"${k}" x${c}`).join(", ")}.`, fix: "Say each service once. Repetition does not help ranking and reads as spam." });
  const commaRuns = d.split(/[.!?]/).filter((s) => (s.match(/,/g) || []).length >= 12);
  if (commaRuns.length) issues.push({ level: "RISK", problem: "One sentence lists 12 or more items in a row, which looks like a keyword dump.", fix: "Keep the suburb list to the main 5-8 areas. The full list belongs in the Service area field." });
  if (city && !d.toLowerCase().includes(city.toLowerCase())) issues.push({ level: "RISK", problem: `Your main area "${city}" is not mentioned.`, fix: "Say where you are based and where you work in the first two lines." });
  const missingServices = (services || []).filter((s) => s && !d.toLowerCase().includes(String(s).toLowerCase()));
  if (missingServices.length) issues.push({ level: "INFO", problem: `Services not mentioned: ${missingServices.join(", ")}.`, fix: "Add the ones that earn the most." });
  if (!/\b(?:call|ring|message|text|book|enquire|contact|get a quote|quote)\b/i.test(d)) issues.push({ level: "INFO", problem: "No call to action.", fix: "End with how to get in touch: \"Call or message us for a free quote.\"" });
  const first250 = d.slice(0, 250);
  if (business_name && !first250.toLowerCase().includes(business_name.toLowerCase().split(" ")[0])) issues.push({ level: "INFO", problem: "The first 250 characters (the part shown before \"More\") don't say who you are.", fix: "Open with who you are and where you work." });

  const verdict = verdictFrom(issues);
  const text = [
    `Description check: ${len}/750 characters. Verdict: ${verdict}`,
    "",
    fmtIssues(issues),
    "",
    "Shown before \"More\" (about the first 250 characters):",
    `"${first250}${len > 250 ? "…" : ""}"`,
    "",
    "A structure that works, four short blocks:",
    "1. Who + where: \"<Name> is a licensed <trade> based in <suburb>, working across <5-8 main suburbs>.\"",
    "2. What, as a plain list of the actual jobs (not \"comprehensive solutions\").",
    "3. Why you, with something concrete (years in trade, licence, warranty, same-day, clean-up).",
    "4. How to contact: \"Call or message us for a free quote.\"",
    `Rule: ${SOURCES.guidelines}`,
  ].join("\n");
  return { verdict, issues, chars: len, text };
}

// ---------------------------------------------------------------- posts
export function checkPost({ text, button = "" }) {
  const t = String(text || "");
  const issues = [];
  if (!t.trim()) return { verdict: "FAIL", text: "No post text given." };
  if (t.length > 1500) issues.push({ level: "FAIL", problem: `${t.length} characters. Posts cap at 1,500.`, fix: `Cut ${t.length - 1500} characters. The first ~100 show in the preview, so put the job there.` });
  if (PHONE_RE.test(t)) issues.push({ level: "FAIL", problem: "A phone number in the post text.", fix: "Remove it. Google rejects posts whose phone number it can't verify as yours, and it often rejects posts with a number in the text without giving a reason. Use the \"Call now\" button instead. The call button on your profile shows either way." });
  if (SHORTENER_RE.test(t)) issues.push({ level: "FAIL", problem: "A link shortener (bit.ly or similar).", fix: "Shortened links get posts rejected. Use the full URL in the button's link field." });
  else if (URL_RE.test(t)) issues.push({ level: "RISK", problem: "A web address typed into the post text. It won't be clickable.", fix: "Put the link in the button (Learn more / Book / Order) instead." });
  if (EMAIL_RE.test(t)) issues.push({ level: "RISK", problem: "An email address in the text.", fix: "Remove it. Contact details in the text are a common reason posts get rejected." });
  if (isMostlyCaps(t)) issues.push({ level: "RISK", problem: "Mostly capital letters.", fix: "Write in sentence case. Shouting text gets rejected as spam." });
  const emoji = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji > 6) issues.push({ level: "RISK", problem: `${emoji} emoji.`, fix: "Keep it to a couple." });
  if (/!{2,}|\?{3,}|\${2,}/.test(t)) issues.push({ level: "RISK", problem: "Repeated punctuation (!!, $$).", fix: "Gimmicky punctuation is against the posts policy." });
  if (/\b(?:click here|call now!|act now|buy now|limited time only)\b/i.test(t)) issues.push({ level: "INFO", problem: "Pushy call-to-action words.", fix: "Let the button do the selling. The text should describe the job." });
  if (/\b(?:vape|vaping|e-cig|cannabis|cbd|firearm|gun|ammo|alcohol|liquor|tobacco|gambling|casino|prescription|botox|dermal filler)\b/i.test(t)) issues.push({ level: "RISK", problem: "Regulated product wording.", fix: "Posts about regulated products (alcohol, tobacco, weapons, gambling, prescription treatments) are restricted or banned." });
  if (!button) issues.push({ level: "INFO", problem: "No button chosen.", fix: "Add \"Learn more\" linked to the matching service page. It gives Google a link to that page, and posts with a button get more clicks." });
  if (t.length < 80) issues.push({ level: "INFO", problem: "Very short post.", fix: "Say what the job was and where, two or three lines." });

  const verdict = verdictFrom(issues);
  return {
    verdict, issues,
    text: [
      `Post pre-flight: ${t.length}/1500 characters. Verdict: ${verdict}`,
      "",
      fmtIssues(issues),
      "",
      "Format that publishes reliably (three lines plus a button):",
      "1. What the job was, in plain trade words, based on what's in the photo.",
      "2. The service plus the area (\"Switchboard upgrades across Redcliffe and Margate\").",
      "3. A line pointing to the service page. No phone number. Then add a Learn more button linked to that page.",
      "Post one, wait a couple of minutes, and check it shows Published (not Rejected) before you schedule the rest. A rejected post looks submitted until you read the list.",
      "Honest note: posts barely move map-pack rankings in independent tests. They keep the profile looking active and help convert people who are already looking.",
      `Rule: ${SOURCES.posts}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------- review request
export function checkReviewRequest({ message }) {
  const m = String(message || "");
  const issues = [];
  if (!m.trim()) return { verdict: "FAIL", text: "No message given." };
  if (/\b(?:discount|voucher|gift card|prize|draw|competition|win|free (?:\w+ )?(?:service|treatment|session|coffee|item)|\d+\s?% off|\$\d+ off|in return|in exchange|reward|cashback|credit)\b/i.test(m)) issues.push({ level: "FAIL", problem: "An incentive for leaving a review.", fix: "Offering anything for a review breaks Google's policy and can mislead consumers under the Australian Consumer Law. Remove the offer completely, including entries into draws." });
  if (/\b(?:5[ -]?stars?|five[ -]?stars?|★★★★★|positive review|good review|great review|glowing)\b/i.test(m)) issues.push({ level: "FAIL", problem: "Asks for a particular rating or a positive review.", fix: "Ask for an honest review. \"Would you mind leaving us a quick review?\"" });
  if (/\b(?:if you(?:'re| are| were)? (?:happy|satisfied|pleased|loved)|only if|unhappy\?|not happy\? (?:call|contact|email|let us know first)|tell us first)\b/i.test(m)) issues.push({ level: "FAIL", problem: "Review gating: only happy customers are pointed at Google, or unhappy ones get steered away first.", fix: "Send everyone the same link. Selectively asking happy customers is banned by Google and is the pattern the ACCC calls out. It is fine to offer a way to get help, but not as a filter in front of the review link." });
  if (/\b(?:mention|use the words?|include the (?:words?|keywords?)|say that)\b/i.test(m)) issues.push({ level: "RISK", problem: "Tells the customer what to write.", fix: "Scripting review content makes the reviews look fake. You can ask them to mention the job if they want to, but don't give them words." });
  if (m.length > 320) issues.push({ level: "INFO", problem: `${m.length} characters. Long for an SMS (over two segments).`, fix: "Keep it under 160-300 characters. Name, thanks, one ask, the link." });
  if (!/https?:\/\/|\[link\]|\{link\}|g\.page|search\.google\.com/i.test(m)) issues.push({ level: "INFO", problem: "No review link in the message.", fix: "Use the direct review link (the build_review_link tool makes one) so the review box opens straight away." });
  const verdict = verdictFrom(issues);
  return {
    verdict, issues,
    text: [
      `Review request check. Verdict: ${verdict}`,
      "",
      fmtIssues(issues),
      "",
      "Compliant SMS template:",
      "\"Hi {first name}, thanks for having us out for the {job} today. If you've got 30 seconds, an honest Google review really helps a small local business like ours: {review link}. Cheers, {your name}\"",
      "",
      "Timing: send within two hours of finishing the job, then one reminder 3-4 days later. Ask every customer, not just the happy ones.",
      `Rules: ${SOURCES.reviewsPolicy} · ${SOURCES.accc}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------- review reply
export function checkReviewReply({ reply, stars, review_text = "" }) {
  const r = String(reply || "");
  const s = Number(stars) || 0;
  const issues = [];
  if (!r.trim()) return { verdict: "FAIL", text: "No reply given." };
  if (r.length > 4096) issues.push({ level: "FAIL", problem: "Over Google's 4,096-character limit.", fix: "Cut it hard. Most good replies run 200-500 characters." });
  else if (r.length > 600) issues.push({ level: "INFO", problem: `${r.length} characters. Long replies don't get read.`, fix: "Aim for 200-500." });
  if (PHONE_RE.test(r) && s >= 4) issues.push({ level: "INFO", problem: "A phone number in a reply to a positive review.", fix: "Not needed. Customers can already tap Call." });
  if (EMAIL_RE.test(r)) issues.push({ level: "RISK", problem: "An email address in the reply.", fix: "Public replies are public. Use \"please give us a call\" rather than posting addresses." });
  if (/\b(?:invoice|job (?:no|number)|booking (?:no|number|ref)|your address|at \d+ [a-z]+ (?:st|street|rd|road|ave))\b/i.test(r)) issues.push({ level: "FAIL", problem: "Private customer details (address, invoice or booking numbers).", fix: "Never confirm private details in public. It is a privacy risk and makes the business look careless." });
  if (/\b(?:your (?:treatment|condition|diagnosis|prescription|appointment notes)|your (?:x-ray|scan|test results))\b/i.test(r)) issues.push({ level: "FAIL", problem: "Mentions the customer's health information.", fix: "Health businesses must not confirm someone was a patient or discuss their care in public (Privacy Act, AHPRA)." });
  if (/\b(?:refund|discount|voucher|free|credit)\b.*\b(?:if you|remove|change|update|delete|edit)\b.*\breview\b|\b(?:remove|change|update|delete|edit) (?:your|the|this) review\b/i.test(r)) issues.push({ level: "FAIL", problem: "Offers something in exchange for changing or removing the review.", fix: "Not allowed. Fix the problem offline. If they choose to update the review afterwards, that's up to them." });
  if (/\b(?:liar|lying|fake|never (?:been|was) a customer|ridiculous|clearly you|obviously you|how dare)\b/i.test(r)) issues.push({ level: "RISK", problem: "Argumentative wording.", fix: "Future customers read your reply more than the review. Stay calm, keep the facts short, offer to talk offline. If you believe the review is fake, report it. Don't argue it in public." });
  if (/^(?:thank you for your (?:feedback|review)[.!]?)$/i.test(r.trim()) || r.trim().length < 25) issues.push({ level: "RISK", problem: "A generic, one-line reply.", fix: "Mention something specific from their review, like the job or the person who helped." });
  if (FILLER.some((f) => r.toLowerCase().includes(f))) issues.push({ level: "RISK", problem: "Generic filler that reads as AI-written.", fix: "Write it like you'd say it on the phone." });
  if (s && s <= 2 && !/\b(?:sorry|apolog|understand|call|contact|reach out|speak|chat|ring)\b/i.test(r)) issues.push({ level: "RISK", problem: "A negative review reply with no acknowledgement and no offline path.", fix: "Acknowledge, own what's yours, give a way to sort it out offline (\"give us a ring and ask for <name>\")." });
  const verdict = verdictFrom(issues);
  const guide = s >= 4
    ? "4-5 stars: thank them by name, mention the job, one line that helps the next reader (\"glad the new switchboard sorted the tripping\"). No sales pitch."
    : s === 3
      ? "3 stars: thank them, acknowledge the part that fell short, say what you've changed, invite them to call."
      : s
        ? "1-2 stars: reply within 24-48 hours, stay calm, acknowledge without arguing facts in public, own what's yours, move it offline with a name and number. If it breaks Google's policy (fake, conflict of interest, off-topic, hate), report it as well. Replying does not stop you reporting."
        : "Give the star rating for advice tuned to it.";
  return { verdict, issues, text: [`Review reply check (${s || "?"} stars). Verdict: ${verdict}`, "", fmtIssues(issues), "", guide, review_text ? "" : "", `Policy: ${SOURCES.reviewsPolicy}`].join("\n") };
}
