/**
 * Reconstructed SIMS warning sequence for Tropical Cyclone Maila
 * (5-11 April 2026), per docs/PROJECT_HANDOFF.md's replay-testing plan.
 *
 * IMPORTANT — none of this is a captured CAP payload. Checked first: the
 * SIMS CAP feed itself has no history endpoint, and the Wayback Machine has
 * no archived snapshot of it for this period (confirmed via its Availability
 * API: `{"archived_snapshots": {}}` for cap-sources.s3.amazonaws.com's rss.xml
 * at 2026-04-07). No archived CAP payload for this event exists anywhere
 * this session could find. Every entry below is reconstructed from
 * secondary reporting, at one of three trust tiers — check `provenance`
 * and `citation` on each entry before drawing conclusions from it:
 *
 *   "confirmed"    — SIMS's own warning number, issue time, and the
 *                    quoted operational details (position, pressure,
 *                    per-province wind/sea thresholds) are directly
 *                    attested by a specific cited news article quoting
 *                    SIMS. This is still journalism paraphrasing a
 *                    bulletin, not the bulletin's XML — but it's as close
 *                    to primary as this event gets.
 *   "interpolated" — timing follows the *confirmed* cadence (SIMS issued
 *                    bulletins roughly every 6h, at 01:30/07:30/13:30/19:30
 *                    SBT — derived below from the gap between warnings
 *                    #2, #6 and #11, all three independently confirmed and
 *                    exactly consistent with a uniform 6h/4-per-day
 *                    schedule). Severity/category and affected-province
 *                    lists for these entries are inferred from BOM's
 *                    official track/intensity history and from ECHO/
 *                    ReliefWeb/IFRC situation reports for the surrounding
 *                    period, not from a warning-specific citation.
 *   "illustrative" — not grounded in any source at all. Only the final
 *                    entry uses this: no source confirms SIMS ever issued
 *                    a formal Cancel-type bulletin for Maila. It's added
 *                    solely to exercise the pipeline's CANCELLED lifecycle
 *                    path, and should not be read as a claim about what
 *                    SIMS actually sent.
 *
 * Sources for "confirmed" entries and the overall meteorological/impact
 * timeline:
 *  - BOM official track: https://www.bom.gov.au/cyclone/history/Maila2026.shtml
 *  - ReliefWeb disaster page (ECHO/IFRC sitreps):
 *    https://reliefweb.int/disaster/tc-2026-000051-slb
 *  - In-Depth Solomons, quoting SIMS bulletins directly:
 *    - Warning Number Two (issued ~07:30 5 Apr, "as of 5:00 AM"):
 *      https://indepthsolomons.com.sb/its-cyclone-maila-tropical-cyclone-maila-intensifies-near-western-province-gale-warnings-issued/
 *    - Warning Number Six (issued 07:30 6 Apr, "as of 5:00am"):
 *      https://indepthsolomons.com.sb/severe-tropical-cyclone-maila-strengthens-to-category-three-threatens-western-solomons/
 *    - Warning Number Eleven (issued 13:30 7 Apr, "as of 11:00am"):
 *      https://indepthsolomons.com.sb/category-3-severe-cyclone-maila-intensifies-southwest-of-rendova-island-western-solomons/
 *  - Solomon Islands Government, Cabinet briefing (7 Apr, same-day Category
 *    4 assessment naming Guadalcanal):
 *    https://solomons.gov.sb/ndmo_tc_maila_press-release-08-april-final/
 *    (page itself is behind a JS challenge this session couldn't solve;
 *    its content is known only via search-result summary, so treat the
 *    "Category 4" / "parts of Guadalcanal" detail as weaker than the
 *    directly-fetched In-Depth Solomons articles.)
 *
 * Two more caveats that affect how much weight to put on this dataset:
 *
 *  1. The doc's ground truth (Western, Choiseul, Isabel, Guadalcanal,
 *     Central) is the *cumulative* set of provinces ECHO reported affected
 *     by the storm's full passage — it is not a claim that every individual
 *     warning named all five. Warning #6's real content names Temotu
 *     instead of Guadalcanal/Central (the storm's forecast track was still
 *     uncertain four days out) — that's preserved below rather than
 *     smoothed away, because a forecast-track province appearing in an
 *     early warning and not the final impact list is a real property of
 *     how these events unfold, not a bug in this dataset.
 *  2. No real CAP structure for a SIMS cyclone-category alert has ever been
 *     confirmed (docs/PROJECT_HANDOFF.md's own open item: "only Strong Wind
 *     alerts seen so far"). hazard_type "Tropical Cyclone" and the
 *     Yellow/Orange/Red headline-color progression below are extrapolated
 *     from the Strong Wind feed's confirmed "<Category> Alert" pattern, not
 *     confirmed for cyclone alerts specifically.
 *
 * category -> CAP severity and headline color is this dataset's own
 * assumption (not sourced): Cat 1-2 -> Moderate/Yellow, Cat 3 -> Severe/
 * Orange, Cat 4-5 -> Extreme/Red, tapering back down as the storm weakened.
 */

const SB = "+11:00"; // Solomon Islands Time, matching the offset used in real live CAP `sent`/`expires` values

/**
 * @typedef {Object} MailaWarningDescriptor
 * @property {number} number
 * @property {string} issuedAt        ISO 8601, Solomon Islands Time
 * @property {string} msgType         CAP msgType
 * @property {string} category        Descriptive, not CAP — "Category 3" etc., or null for the Cancel bulletin
 * @property {string} severity
 * @property {string} urgency
 * @property {string} certainty
 * @property {string[]} provinces     Province names (must match src/geo's ADM1_NAME values) this warning's hazard area covers
 * @property {string} headline
 * @property {string} instruction
 * @property {"confirmed"|"interpolated"|"illustrative"} provenance
 * @property {string} citation
 */

/** @type {MailaWarningDescriptor[]} */
export const MAILA_WARNINGS = [
  {
    number: 2,
    issuedAt: `2026-04-05T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 1",
    severity: "Moderate",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 2: Yellow Alert",
    instruction:
      "Western Province: gale-force winds 63-87 km/h, very rough seas, swells 3.0-5.0m. Choiseul and Isabel: winds up to 61 km/h, moderate to rough seas. Widespread heavy rain and thunderstorms expected in all provinces, risk of landslides and flash flooding. Sea travelers urged to prioritize safety; motorists avoid crossing rivers of unknown depth.",
    provenance: "confirmed",
    citation:
      "In-Depth Solomons, 'IT'S CYCLONE MAILA...' (issued as Warning Number Two, 'as of 5:00 AM' 5 Apr 2026; article notes next update due 1:30pm)",
  },
  {
    number: 3,
    issuedAt: `2026-04-05T13:30:00${SB}`,
    msgType: "Alert",
    category: "Category 2",
    severity: "Moderate",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 3: Yellow Alert",
    instruction: "Continuing gale conditions for Western, Choiseul and Isabel as the system intensifies. Same precautions as previous warning remain in effect.",
    provenance: "interpolated",
    citation: "Timing per confirmed 6h cadence (next update after #2 due 1:30pm 5 Apr); category per BOM track (intensifying toward severe TC strength by 1200 UTC 5 Apr).",
  },
  {
    number: 4,
    issuedAt: `2026-04-05T19:30:00${SB}`,
    msgType: "Alert",
    category: "Category 2",
    severity: "Moderate",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 4: Yellow Alert",
    instruction: "Continuing gale conditions for Western, Choiseul and Isabel. Heavy rain and thunderstorm risk nationwide.",
    provenance: "interpolated",
    citation: "Timing per confirmed 6h cadence; category interpolated between BOM's severe-TC-strength milestone (1200 UTC 5 Apr) and the next confirmed bulletin (#6, Category 3).",
  },
  {
    number: 5,
    issuedAt: `2026-04-06T01:30:00${SB}`,
    msgType: "Alert",
    category: "Category 2",
    severity: "Moderate",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 5: Yellow Alert",
    instruction: "Continuing gale conditions for Western, Choiseul and Isabel ahead of further intensification.",
    provenance: "interpolated",
    citation: "Timing per confirmed 6h cadence, immediately preceding confirmed Warning #6.",
  },
  {
    number: 6,
    issuedAt: `2026-04-06T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Temotu"],
    headline: "Tropical Cyclone Warning Number 6: Orange Alert",
    instruction:
      "Western Province: gale-force winds up to 87 km/h, very rough seas, swells 3.5-6.0m, coastal flooding possible. Choiseul, Isabel and Temotu: strengthening winds near gale force, moderate to rough seas, swells up to 4m, coastal flooding a concern. Heavy rain/thunderstorms nationwide, landslide and flash flood risk.",
    provenance: "confirmed",
    citation:
      "In-Depth Solomons, 'Severe Tropical Cyclone Maila Strengthens To Category Three...' (Warning Number Six, issued 7:30am 6 Apr 2026, 'as of 5:00am'; next warning due 1:30pm)",
  },
  {
    number: 7,
    issuedAt: `2026-04-06T13:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Temotu"],
    headline: "Tropical Cyclone Warning Number 7: Orange Alert",
    instruction: "Conditions as previous warning continue across Western, Choiseul, Isabel and Temotu as Maila tracks slowly through the Solomon Sea.",
    provenance: "interpolated",
    citation: "Timing is the 'next update' explicitly promised by confirmed Warning #6 (1:30pm 6 Apr); content interpolated.",
  },
  {
    number: 8,
    issuedAt: `2026-04-06T19:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Temotu"],
    headline: "Tropical Cyclone Warning Number 8: Orange Alert",
    instruction: "Conditions unchanged across Western, Choiseul, Isabel and Temotu.",
    provenance: "interpolated",
    citation: "Timing per confirmed 6h cadence; content interpolated.",
  },
  {
    number: 9,
    issuedAt: `2026-04-07T01:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 9: Orange Alert",
    instruction: "Western, Choiseul and Isabel remain under gale warning as the eye tracks toward Rendova Island.",
    provenance: "interpolated",
    citation: "Timing per confirmed 6h cadence. Temotu dropped here rather than at #10/#11 is a judgment call — confirmed Warning #11 (13:30 7 Apr) no longer names Temotu at all, but no source pins the exact bulletin where it dropped out.",
  },
  {
    number: 10,
    issuedAt: `2026-04-07T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 10: Orange Alert",
    instruction: "Western, Choiseul and Isabel remain under gale warning ahead of the eye's closest approach to Rendova Island.",
    provenance: "interpolated",
    citation: "Timing is the confirmed cadence slot immediately before confirmed Warning #11.",
  },
  {
    number: 11,
    issuedAt: `2026-04-07T13:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel"],
    headline: "Tropical Cyclone Warning Number 11: Orange Alert",
    instruction:
      "Eye located 182.4km (98.5nm) SW of Rendova Island, Western Province; central pressure 962hPa, moving SE at 4 knots. Western Province: sustained gale winds 63-87 km/h, very rough seas, swells 3.5-6.0m. Choiseul and Isabel: winds increasing to 61 km/h, swells 2.5-4.0m, potential coastal flooding. Threat-to-life-and-property notice in effect; evacuations may be needed near hill slopes, rivers and low-lying areas.",
    provenance: "confirmed",
    citation:
      "In-Depth Solomons, 'Category 3 Severe Cyclone Maila Intensifies Southwest Of Rendova Island...' (Warning Number Eleven, issued 1:30pm 7 Apr 2026, 'as of 11:00am'; next update due 7:30pm). Note: the same day's Cabinet briefing (per search-result summary of solomons.gov.sb, page itself inaccessible) separately describes the storm as 'Category 4' — a real discrepancy between same-day sources, not a dataset error; see the replay report's flagged-ambiguities section.",
  },
  {
    number: 12,
    issuedAt: `2026-04-07T19:30:00${SB}`,
    msgType: "Alert",
    category: "Category 4",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal"],
    headline: "Tropical Cyclone Warning Number 12: Red Alert",
    instruction:
      "Severe Tropical Cyclone Maila now Category 4, remaining active southwest of Western Province. Strong winds, heavy rainfall, rough seas and coastal inundation across Western, Choiseul, Isabel and Guadalcanal. Damage to homes, schools and infrastructure already reported in Western Province and Choiseul.",
    provenance: "interpolated",
    citation:
      "Timing is the 'next update' explicitly promised by confirmed Warning #11 (7:30pm 7 Apr). Category 4 and the addition of Guadalcanal are drawn from the same-day Cabinet briefing (Government Caucus briefing, 7 Apr, per search-result summary of solomons.gov.sb) rather than a specific numbered SIMS bulletin.",
  },
  {
    number: 13,
    issuedAt: `2026-04-08T01:30:00${SB}`,
    msgType: "Alert",
    category: "Category 5",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 13: Red Alert",
    instruction:
      "Severe Tropical Cyclone Maila at peak intensity, Category 5, 205 km/h sustained winds. Extreme danger across Western, Choiseul, Isabel, Guadalcanal and Central Provinces. Residents in coastal and low-lying areas should be in a place of safety. Avoid all sea travel.",
    provenance: "interpolated",
    citation:
      "Timing follows immediately after BOM's confirmed Category 5 peak (110kn/205km/h at 1200 UTC 7 Apr = 2300 SBT 7 Apr). This is the first entry naming all five of the doc's ground-truth provinces, added here as peak intensity plausibly extended the windfield to Central — not confirmed by any province-specific source for this exact bulletin.",
  },
  {
    number: 14,
    issuedAt: `2026-04-08T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 4",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 14: Red Alert",
    instruction: "Extremely dangerous conditions continue across Western, Choiseul, Isabel, Guadalcanal and Central as Maila fluctuates near peak intensity.",
    provenance: "interpolated",
    citation: "Timing per confirmed cadence; BOM notes a slight weakening on 8 Apr before a second Category 4 peak later that day.",
  },
  {
    number: 15,
    issuedAt: `2026-04-08T13:30:00${SB}`,
    msgType: "Alert",
    category: "Category 4",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 15: Red Alert",
    instruction: "Extremely dangerous conditions continue across Western, Choiseul, Isabel, Guadalcanal and Central.",
    provenance: "interpolated",
    citation: "Timing per confirmed cadence, ahead of BOM's confirmed second Category 4 peak 'late on 8 April'.",
  },
  {
    number: 16,
    issuedAt: `2026-04-08T19:30:00${SB}`,
    msgType: "Alert",
    category: "Category 4",
    severity: "Extreme",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 16: Red Alert",
    instruction: "Maila at a second peak of Category 4, 185 km/h sustained winds. Extreme danger continues across Western, Choiseul, Isabel, Guadalcanal and Central.",
    provenance: "interpolated",
    citation: "Timing/category matches BOM's confirmed second peak: 100kn/185km/h, Category 4, 'late on 8 April'.",
  },
  {
    number: 17,
    issuedAt: `2026-04-09T01:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 17: Orange Alert",
    instruction: "Maila weakening but still dangerous across Western, Choiseul, Isabel, Guadalcanal and Central.",
    provenance: "interpolated",
    citation: "BOM: system started weakening from 9 April. Timing per confirmed cadence.",
  },
  {
    number: 18,
    issuedAt: `2026-04-09T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 3",
    severity: "Severe",
    urgency: "Immediate",
    certainty: "Observed",
    provinces: ["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"],
    headline: "Tropical Cyclone Warning Number 18: Orange Alert",
    instruction: "Maila continuing to weaken while moving away from Solomon Islands toward the Solomon Sea/PNG. Western, Choiseul, Isabel, Guadalcanal and Central remain under warning.",
    provenance: "interpolated",
    citation: "ECHO's 9 Apr sitrep already discusses impact assessment 'following passage over Solomon Islands' affecting exactly these five provinces, consistent with the storm's core danger having passed by this point.",
  },
  {
    number: 19,
    issuedAt: `2026-04-09T13:30:00${SB}`,
    msgType: "Alert",
    category: "Category 2",
    severity: "Moderate",
    urgency: "Expected",
    certainty: "Observed",
    provinces: ["Western", "Choiseul"],
    headline: "Tropical Cyclone Warning Number 19: Yellow Alert",
    instruction: "Residual gale conditions for Western and Choiseul as Maila continues to track away toward Papua New Guinea.",
    provenance: "interpolated",
    citation: "ECHO 9 Apr sitrep: storm centre already ~200km south of Bougainville (PNG) by 00 UTC 9 Apr, moving further from Solomon Islands; area narrowed accordingly.",
  },
  {
    number: 20,
    issuedAt: `2026-04-09T19:30:00${SB}`,
    msgType: "Alert",
    category: "Category 2",
    severity: "Moderate",
    urgency: "Expected",
    certainty: "Observed",
    provinces: ["Western"],
    headline: "Tropical Cyclone Warning Number 20: Yellow Alert",
    instruction: "Residual swell and rain risk for Western Province only as Maila moves further into the Solomon Sea toward Papua New Guinea.",
    provenance: "interpolated",
    citation: "ECHO 10 Apr sitrep: storm centre ~215km NE of Muyua Island (PNG), 130 km/h, further weakening.",
  },
  {
    number: 21,
    issuedAt: `2026-04-10T07:30:00${SB}`,
    msgType: "Alert",
    category: "Category 1",
    severity: "Minor",
    urgency: "Expected",
    certainty: "Likely",
    provinces: ["Western"],
    headline: "Tropical Cyclone Warning Number 21: Yellow Alert",
    instruction: "Minor residual swell for Western Province. Maila continuing to weaken over the Solomon Sea well clear of Solomon Islands waters.",
    provenance: "interpolated",
    citation: "BOM/ECHO: continued weakening 10-11 Apr toward tropical storm intensity, tracking further from Solomon Islands.",
  },
  {
    number: 22,
    issuedAt: `2026-04-11T07:30:00${SB}`,
    msgType: "Cancel",
    category: null,
    severity: "Minor",
    urgency: "Past",
    certainty: "Observed",
    provinces: ["Western"],
    headline: "Tropical Cyclone Warning Number 22: Warning Cancelled",
    instruction: "Tropical Cyclone Maila warning cancelled. The system has weakened below tropical cyclone intensity (reclassified Ex-Tropical Cyclone Maila) and no longer poses a direct threat to Solomon Islands.",
    provenance: "illustrative",
    citation:
      "NOT grounded in any source — no SIMS cancellation bulletin for Maila was found. Added only to exercise the pipeline's CANCELLED lifecycle path. Timing is placed near BOM's confirmed reclassification to Ex-Tropical Cyclone Maila ('by the morning of 11 April... gales easing by 1200 UTC 11 April').",
  },
];
