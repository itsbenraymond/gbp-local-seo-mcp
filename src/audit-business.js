// audit_business — one call, one answer, no interview.
//
// The old flow made the assistant ask for a website, then a review count, then a
// rating, then a phone number, and still came back with a generic checklist. This
// takes what a person actually has in front of them (a name, a suburb, what they
// do) and derives the rest: the brand question off their own website, the numbers
// off our Australian benchmark, the category off what real businesses in that
// trade use. Whatever is missing, it says what that costs and carries on.
import { verifyBusinessName } from "./verify-name.js";
import { benchmarkBusiness, pickCategory, resolveCategory } from "./benchmark-tools.js";
import { auditWebsite } from "./website.js";
import { readSiteReviews, findGoogleProfile } from "./site-data.js";

const num = (v) => (Number.isFinite(v) ? v : null);

export async function auditBusiness({
  business_name = "",
  suburb = "",
  trade = "",
  website = "",
  review_count,
  rating,
  category = "",
  service_area_business = true,
} = {}) {
  const name = String(business_name || "").trim();
  if (!name) return { text: "Give the business name as it appears on the Google profile. Everything else is optional." };

  let revs = num(review_count);
  let rat = num(rating);

  // If the numbers were not given, look for them instead of asking. Most local
  // sites publish aggregateRating, and a person asking an AI for help should
  // not be sent off to go and count their own reviews.
  let derived = null;
  if (website && (revs === null || rat === null)) {
    const fromSite = await readSiteReviews({ website }).catch(() => null);
    if (fromSite && (fromSite.count !== null || fromSite.rating !== null)) {
      if (revs === null && fromSite.count !== null) { revs = fromSite.count; derived = true; }
      if (rat === null && fromSite.rating !== null) { rat = fromSite.rating; derived = true; }
    }
  }
  const L = [];
  const actions = [];

  L.push(`AUDIT: ${name}${suburb ? ` — ${suburb}` : ""}${trade ? ` (${trade})` : ""}`);
  L.push("=".repeat(Math.min(70, L[0].length)));
  L.push("");

  // 1. The name, settled against their own site where possible.
  L.push("1. THE NAME");
  L.push("");
  const nameOut = await verifyBusinessName({ name, website, city: suburb, category });
  L.push(nameOut.text);
  if (/Verdict:.*\bFAIL\b|This one is real/.test(nameOut.text)) {
    actions.push({ pri: 1, do: `Fix the profile name. It is the one thing here that can take the whole listing off Google.` });
  }
  L.push("");

  // 2. Where they actually sit, against real Australian numbers.
  L.push("2. WHERE YOU SIT");
  L.push("");
  if (derived) L.push(`Review count and rating read off the website's own structured data, not supplied. If they disagree with the Google profile the site is stale, which is its own finding.`);
  const bench = benchmarkBusiness({ category, trade, review_count: revs, rating: rat, business_name: name });
  L.push(bench.text);
  const found = resolveCategory(category) || resolveCategory(trade);
  if (found && revs !== null) {
    const gap = found.row.reviews.p50 - revs;
    if (gap > 0) actions.push({ pri: 2, do: `Get ${gap} more reviews to reach the median ${found.row.label}. Ask every customer within two hours of finishing, by text, with a direct review link.` });
    else {
      const next = [found.row.reviews.p75, found.row.reviews.p90].find((v) => v > revs);
      actions.push({ pri: 6, do: next
        ? `Reviews are past the median ${found.row.label}. ${next - revs} more clears the next rung. Keep the ask running, but it is no longer the constraint, so spend the effort on the items above it.`
        : `Reviews are past the top 10% of ${found.row.label}. Keep the ask running so it does not go stale, and spend the effort on the items above it.` });
    }
  } else if (revs === null) {
    actions.push({ pri: 2, do: `Tell us the review count and star rating and this becomes a real ranking rather than general advice.` });
  }
  if (found && rat !== null && rat < found.row.rating?.p50) {
    actions.push({ pri: 1, do: `Rating is below the median for ${found.row.label}. Find out why before asking for more reviews, or you just get more of the same.` });
  }
  L.push("");

  // 3. Category, from what real businesses in the trade picked.
  if (trade) {
    L.push("3. CATEGORY");
    L.push("");
    L.push(pickCategory({ trade }).text);
    L.push("");
  }

  // 4. The website's local layer.
  const section = trade ? "4" : "3";
  if (website) {
    L.push(`${section}. THE WEBSITE`);
    L.push("");
    const site = await auditWebsite({ url: website, business_name: name, suburb, main_service: trade });
    L.push(site.text);
    L.push("");
    const prof = await findGoogleProfile({ website }).catch(() => null);
    if (prof) {
      L.push(prof.text);
      L.push("");
      if (/does not link to its Google Business Profile/.test(prof.text)) {
        actions.push({ pri: 3, do: `Link the website to the Google profile and point the profile's website field back at the site. Right now nothing on the site says the two are the same business, and there is nowhere obvious for a customer to leave a review.` });
      }
    }
    // The website findings are the point of running it, so they go in the action
    // list too. Leaving them in a score the reader has to re-read is how a report
    // ends up read once and acted on never.
    const siteFails = (site.checks || []).filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);
    if (typeof site.score === "number" && site.score < 80) {
      actions.push({ pri: 2, do: `The website scores ${site.score}/100 on its local layer. Fix the top three first: ${siteFails.slice(0, 3).map((c) => c.label.toLowerCase()).join("; ")}.` });
    }
    if (siteFails.some((c) => /schema/i.test(c.label))) {
      actions.push({ pri: 3, do: `Add LocalBusiness schema to the site with the exact profile name, phone, areaServed and a sameAs link to the Google profile. It is the clearest signal you can give that the site and the listing are the same business.` });
    }
    if (siteFails.some((c) => /^one h1|h1 names/i.test(c.label))) {
      actions.push({ pri: 3, do: `Give the homepage one H1 that names the service and the suburb, e.g. "${trade || "Your trade"} in ${suburb || "your suburb"}". Right now Google has to guess what the page is for.` });
    }
  } else {
    L.push(`${section}. THE WEBSITE`);
    L.push("");
    L.push("No website address given, so this is unchecked and so is the brand question above. The website is where Google confirms the name, the phone and the service area it reads on the profile. Give us the URL and this section fills in.");
    L.push("");
    actions.push({ pri: 2, do: "Send the website address and re-run this. Half the profile's credibility is decided on the site, not the listing." });
  }

  // 5. What to actually do, in order.
  L.push(`${Number(section) + 1}. DO THESE, IN THIS ORDER`);
  L.push("");
  actions.push({ pri: 5, do: service_area_business
    ? "Check the street address is hidden and every suburb you genuinely service is listed. A service-area business showing an address it does not trade from is a suspension risk on its own. If it is already hidden, this one is done."
    : "Check the street address is visible and the hours are accurate. Customers come to you, so the address is the listing." });
  actions.push({ pri: 4, do: "Tick every Google-suggested service you actually do, up to 25, and give each one a line that names something checkable: licence, warranty, turnaround, call-out fee." });
  actions.push({ pri: 5, do: "One post a week naming the job, the service and the suburb. No phone number in the post text, Google strips those." });
  actions.push({ pri: 5, do: "Real job photos monthly, taken on site. Stock photography is the fastest way to look like every other listing." });
  actions.push({ pri: 6, do: `Match the name, phone and service area exactly on the website, Apple Business Connect, Bing Places, Facebook, True Local, Yellow Pages and Hotfrog. Use compare_nap once you have them in front of you.` });

  actions.sort((a, b) => a.pri - b.pri).forEach((a, i) => L.push(`${i + 1}. ${a.do}`));
  L.push("");
  L.push("Run check_gbp_description, check_gbp_post and check_review_reply on anything you write before it goes on the profile.");

  return { text: L.join("\n") };
}
