// verify_business_name — the name check, settled against the business's own website.
//
// check_business_name on its own can only say "that word is not allowed unless it
// is your real brand", which for most real businesses is a shrug. This fetches the
// site, works out what the brand actually is, re-runs the check with that as the
// signage name, and reports the verdict it can defend, with the evidence quoted.
import { checkBusinessName } from "./text-checks.js";
import { fetchBrandSignals, judgeBrand } from "./brand-evidence.js";

const norm = (s) => String(s || "").toLowerCase().match(/[a-z0-9']+/g)?.join(" ") || "";

export async function verifyBusinessName({ name, website = "", city = "", category = "", legal_or_signage_name = "" }) {
  const n = String(name || "").trim();
  if (!n) return { text: "No name given." };

  const before = checkBusinessName({ name: n, city, category, legal_or_signage_name });
  const flagged = before.issues?.flatMap((i) => i.words || []) || [];

  if (!website) {
    return {
      text: [
        before.text,
        "",
        "To settle this instead of guessing: call this tool again with the business's website address.",
        "We read the site's title, schema.org markup, logo alt text and footer, work out what the brand actually is, and either clear the flag with the evidence or confirm it with proof.",
      ].join("\n"),
    };
  }

  const signals = await fetchBrandSignals(website);
  if (!signals.ok) {
    return { text: [before.text, "", `Could not read ${signals.url} (${signals.reason}), so the brand question is still open. Check the name on the van, the invoices and the ABN registration yourself.`].join("\n") };
  }

  const judged = judgeBrand({ profileName: n, flagged, signals });
  const L = [`Business name check, settled against the website: "${n}"`, ""];

  if (!signals.candidates.length) {
    L.push(`${signals.url} loaded, but it carries no brand name we can read: no schema.org name, no og:site_name, no usable title or logo alt text.`);
    L.push(`That is a finding in itself. A site that never states its own business name gives Google nothing to match the profile against, and it is a 10-minute fix.`);
    L.push("");
    L.push(before.text);
    return { text: L.join("\n") };
  }

  L.push(`What the website calls itself:`);
  signals.candidates.forEach((c) => L.push(`  ${c.where}: "${c.value}"`));
  if (signals.abn) L.push(`  ABN on the site: ${signals.abn} (check it at https://abr.business.gov.au/ABN/View?abn=${signals.abn} — the registered name there is the one Google will accept)`);
  L.push("");

  if (!flagged.length) {
    L.push(`Verdict: ${before.verdict}. Nothing in the name needed the brand defence.`);
    if (judged.agreement?.exact) L.push(`The website and the profile use exactly the same name, which is what you want. Keep them in step.`);
    else L.push(`The profile name and the website name are not identical. Google cross-checks them, so make the website say the profile name word for word.`);
    L.push("");
    L.push(before.text);
    return { text: L.join("\n") };
  }

  // Re-run the rules treating the site's brand as the signage name.
  const brand = (judged.agreement?.value) || signals.candidates[0].value;
  const after = checkBusinessName({ name: n, city, category, legal_or_signage_name: `${legal_or_signage_name} ${brand}`.trim() });

  if (judged.backed.length) {
    L.push(`Cleared by the website:`);
    judged.backed.forEach((b) => L.push(`  "${b.word}" is part of the brand — the ${b.where.join(" and ")} says "${b.as}".`));
  }
  if (judged.unbacked.length) {
    L.push(`NOT cleared:`);
    judged.unbacked.forEach((u) => L.push(`  "${u.word}" appears on the Google profile but nowhere in the name on the website${u.siteSays.length ? ` (the site says ${u.siteSays.map((s) => `"${s}"`).join(", ")})` : ""}.`));
  }
  L.push("");

  if (!judged.unbacked.length) {
    L.push(`Verdict: ${before.verdict} becomes ${after.verdict}.`);
    L.push(`Every flagged word is in the real-world name, which is exactly the exception Google's guideline allows. Leave the name alone.`);
    L.push(`Worth doing anyway, because the defence only works if you can produce it: photograph the signage and the vehicle, keep an invoice and the ABN record in one folder. If the name is ever reported you have minutes, not days.`);
    if (!judged.agreement?.exact) L.push(`One gap: the website's name and the profile name are not word-for-word identical. Make them match.`);
  } else {
    L.push(`Verdict: ${after.verdict}. This one is real.`);
    L.push(`Your own website does not back ${judged.unbacked.map((u) => `"${u.word}"`).join(", ")}, so there is nothing to show a reviewer. Either change the profile name to the name the website uses, or change the real-world branding first and let the website, signage and invoices catch up before you touch Google.`);
    L.push(`If you do edit it: change the name only, change nothing else that week, and expect a re-verification prompt.`);
  }

  L.push("");
  L.push(`Original rule output, for reference:`);
  L.push(before.text);
  return { text: L.join("\n") };
}
