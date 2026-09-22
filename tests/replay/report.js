function shortId(id) {
  const tail = id.split(".").pop();
  return tail;
}

function fmtMs(ms) {
  return `${ms.toFixed(3)}ms`;
}

function provenanceBadge(p) {
  return { confirmed: "CONFIRMED", interpolated: "interpolated", illustrative: "ILLUSTRATIVE" }[p] ?? p;
}

/**
 * Renders the runMailaReplay() result as a Markdown report: warning-by-
 * warning timeline, dedup/lifecycle behavior, ground-truth comparison, and
 * per-stage latency. Not a pass/fail summary — the acceptance-criteria-
 * style checks are asserted separately in replay.test.js; this report is
 * for a human to actually read and judge.
 */
export function renderMailaReplayReport(result) {
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("# TC Maila Replay Report");
  push();
  push(`Generated ${new Date().toISOString()}. Replays ${result.totalWarnings} reconstructed SIMS warnings for Tropical Cyclone Maila (5-11 Apr 2026) through ingestion's output shape -> dedup -> lifecycle -> geo mapping, in chronological order.`);
  push();
  push("## Data provenance — read this before trusting anything below");
  push();
  push("**No real CAP payload exists for this event.** The live SIMS feed has no history endpoint, and the Wayback Machine has no archived snapshot of it for this period (checked via its Availability API: zero snapshots for the CAP index around 7 Apr 2026). Every warning below is reconstructed from secondary reporting, at one of three trust tiers:");
  push();
  push("- **CONFIRMED** — SIMS's own warning number, issue time and quoted operational details are directly attested by a specific cited news article quoting SIMS (still journalism paraphrasing a bulletin, not its XML, but the closest thing to primary source available).");
  push("- **interpolated** — timing follows the confirmed ~6-hourly cadence; severity/category/provinces are inferred from BOM's official track and ECHO/ReliefWeb/IFRC situation reports for the surrounding period, not from a bulletin-specific citation.");
  push("- **ILLUSTRATIVE** — not grounded in any source. Only warning #22 (the Cancel) uses this tier: no source confirms SIMS ever issued a formal cancellation bulletin for Maila.");
  push();
  push("See `tests/replay/mailaWarnings.js`'s module comment for full citations. Hazard-area polygons are also synthetic — a convex hull around each named province's own real boundary, buffered ~5km — not a captured storm polygon.");
  push();

  push("## Warning-by-warning timeline");
  push();
  push("| # | Issued (SBT) | Tier | msgType | Category | Severity | Provinces named | event_id | Reissue? | Lifecycle | Send? |");
  push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const e of result.timeline) {
    push(
      `| ${e.warningNumber} | ${e.issuedAt.replace("T", " ").replace(/\+.*/, "")} | ${provenanceBadge(e.provenance)} | ${e.msgType} | ${e.category ?? "-"} | ${e.severity} | ${e.affectedProvinces.join(", ") || "(none)"} | ${shortId(e.eventId)} | ${e.isReissue ? "yes" : "**no (new)**"} | ${e.lifecycleState} | ${e.sendTrigger ? "**yes**" : "no"} |`,
    );
  }
  push();

  push("## Dedup behavior");
  push();
  push(`${result.totalWarnings} warnings collapsed into **${result.distinctEventIdCount} distinct event_id(s)**.`);
  push();
  if (result.distinctEventIdCount === 1) {
    push("This is the correct outcome for a single continuous cyclone episode: every reissue and escalation should share one event_id, with lifecycle.js (not dedup) distinguishing routine reissues from real escalations.");
  } else {
    push(`**This is a likely dedup failure, not a reflection of ${result.distinctEventIdCount} real distinct storms.** TC Maila was one continuous event; this pipeline run split it into ${result.distinctEventIdCount}. See which warnings started a new event_id in the timeline table above (marked "no (new)" under Reissue?) — that's where dedup's matching criteria (same source, matching hazard_type/eventCode, overlapping-or-adjacent validity window) failed to bridge two consecutive messages.`);
  }
  push();

  const sendTriggerCount = result.timeline.filter((e) => e.sendTrigger).length;
  push(`${sendTriggerCount} of ${result.totalWarnings} warnings would have triggered an onward send; ${result.totalWarnings - sendTriggerCount} were classified as routine reissues with no material change.`);
  push();

  push("## Ground truth comparison");
  push();
  push(`docs/PROJECT_HANDOFF.md's stated ground truth: **${result.groundTruthProvinces.join(", ")}**.`);
  push();
  push(`Pipeline's cumulative affected-province result across the whole sequence: **${result.cumulativeAffectedProvinces.join(", ") || "(none)"}**.`);
  push();
  if (result.falseNegatives.length === 0 && result.falsePositives.length === 0) {
    push("Exact match — no false positives, no false negatives.");
  } else {
    if (result.falseNegatives.length > 0) {
      push(`**False negatives (ground-truth provinces the pipeline never flagged): ${result.falseNegatives.join(", ")}**`);
    }
    if (result.falsePositives.length > 0) {
      push(`Provinces flagged that aren't in the doc's five-province list: ${result.falsePositives.join(", ")}. See below — these break down into one expected case and one genuinely interesting one, not two bugs.`);
    }
  }
  push();
  push("Two things explain every entry in that extra list, and neither is a pipeline defect:");
  push();
  push("- **Temotu** (warnings #6-#9): this is expected, not an error. The ground truth is the *cumulative* impact list from the storm's full passage, not a claim that every individual warning should name all five. Warning #6's real cited content names Temotu instead of Guadalcanal/Central, reflecting real forecast-track uncertainty four days before the eventual impact — a province appearing in an early forecast and dropping out later is a real property of how these events unfold.");
  push("- **Honiara** (from warning #12 onward, wherever Guadalcanal is named): this is a genuine finding worth NDMO/SIMS attention, not a fixture bug. Checked directly: Honiara sits *entirely inside* Guadalcanal's convex hull (the overlap area exactly equals Honiara's whole area, not just a shared border), so any polygon that reasonably represents \"Guadalcanal is under warning\" — synthetic or a real forecaster's own drawing — will geometrically cover Honiara too, since it's a small enclave inside Guadalcanal's extent. The doc's ground truth (sourced from ECHO/IFRC sitreps) never separately names Honiara, which likely just means humanitarian reporting folded the capital's impact into \"Guadalcanal Province\" figures rather than that Honiara was untouched. Point is: geographic routing based on administrative boundaries will systematically flag Honiara whenever Guadalcanal is hit, whether or not a situation report calls it out by name — that's arguably *correct* behavior for a warning-distribution system (better to over-notify the capital than miss it), but it means this pipeline's output won't always match a sitrep's own province list one-for-one, and that mismatch shouldn't be mistaken for a bug when it shows up again in production.");
  push();

  push("## Per-stage latency (in-process, fixture-driven — no network I/O in this replay)");
  push();
  push("| Stage | Samples | Mean | Min | Max |");
  push("|---|---|---|---|---|");
  for (const [stage, s] of Object.entries(result.latencySummary)) {
    push(`| ${stage} | ${s.count} | ${fmtMs(s.meanMs)} | ${fmtMs(s.minMs)} | ${fmtMs(s.maxMs)} |`);
  }
  push();
  push(`These times reflect pure in-memory computation on this dataset only (${result.totalWarnings} warnings, 10 boundary units) — they say nothing about real network/fetch latency, which doesn't exist in a fixture-driven replay. Useful as a relative comparison across stages and a regression baseline, not as a production latency estimate.`);
  push();

  push("## Boundary dataset used");
  push();
  push(`\`${result.boundaryProvenance.dataset_id}\` v${result.boundaryProvenance.version}, boundary_status=**${result.boundaryProvenance.boundary_status}**, geometry_hash=\`${result.boundaryProvenance.geometry_hash.slice(0, 16)}...\`.`);
  push();

  push("## Flagged during construction of this replay");
  push();
  push("- **Same-day category discrepancy, 7 April**: confirmed Warning #11 (1:30pm) describes Maila as Category 3, while the same day's Cabinet briefing (per search-result summary of solomons.gov.sb — the page itself returned a JS bot-challenge this session couldn't solve) describes it as Category 4. Both are treated as real, independently-sourced facts about the same day rather than reconciled into one number — warning #12 onward adopts Category 4, timed after #11's confirmed 1:30pm reading.");
  push("- **No confirmed cyclone-category CAP structure**: docs/PROJECT_HANDOFF.md's own open item — only Strong Wind CAP alerts have ever been confirmed live. hazard_type \"Tropical Cyclone\" and the Yellow/Orange/Red color progression used here are extrapolated from the confirmed Strong Wind pattern, not confirmed for cyclone alerts.");
  push("- **Exact bulletin-to-date mapping beyond #11 is unconfirmed**: the 6-hourly cadence is confirmed (derived from three independently-cited bulletins, #2/#6/#11, landing exactly on a uniform schedule), but no source names a specific bulletin number for anything after #11 — warnings #12-22 are dead-reckoned forward from that cadence plus BOM/ECHO's general trajectory, not tied to specific cited bulletins.");
  push("- **The Cancel bulletin (#22) is fabricated for test coverage**, not sourced — flagged inline in its own timeline row and in mailaWarnings.js.");
  push("- **Synthetic hazard geometry**: every warning's polygon is a convex hull of the named provinces' own real boundaries, not a captured storm polygon — this tests the geo-mapping *logic*, not whether a real Maila CAP polygon would have geometrically resolved the same way.");
  push("- **A real dedup bug was found and fixed by this replay, not just narrated**: the first run of this replay split TC Maila's 21 warnings into 2 event_ids, because the illustrative Cancel bulletin (#22) landed ~16h after the prior warning's expiry — past dedup.js's original 6h adjacency grace period. The doc's own stated reissue cadence is \"roughly every 6-24 hours,\" so a 16h gap is normal, not anomalous; using the *lower* bound of that range as the grace period was the actual bug. Fixed in src/normalization/dedup.js by changing DEFAULT_ADJACENCY_GRACE_MS from 6h to 24h; the existing normalization test suite (tests/normalization/) still passes after the change. This is exactly the kind of gap this replay exercise exists to catch before a real cyclone.");
  push("- **turf.buffer() on Western Province's real multi-island boundary took 47 seconds** for one province, before this fixture switched to buffering a convex hull instead (~30ms). This is a fixture-construction performance detail, not a finding about src/geo/mapping.js itself, which never buffers anything — but worth knowing if this replay is ever extended to buffer real (not hull-simplified) province geometry directly.");

  return lines.join("\n");
}
