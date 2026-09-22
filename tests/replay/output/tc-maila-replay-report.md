# TC Maila Replay Report

Generated 2026-09-22T08:11:57.467Z. Replays 21 reconstructed SIMS warnings for Tropical Cyclone Maila (5-11 Apr 2026) through ingestion's output shape -> dedup -> lifecycle -> geo mapping, in chronological order.

## Data provenance — read this before trusting anything below

**No real CAP payload exists for this event.** The live SIMS feed has no history endpoint, and the Wayback Machine has no archived snapshot of it for this period (checked via its Availability API: zero snapshots for the CAP index around 7 Apr 2026). Every warning below is reconstructed from secondary reporting, at one of three trust tiers:

- **CONFIRMED** — SIMS's own warning number, issue time and quoted operational details are directly attested by a specific cited news article quoting SIMS (still journalism paraphrasing a bulletin, not its XML, but the closest thing to primary source available).
- **interpolated** — timing follows the confirmed ~6-hourly cadence; severity/category/provinces are inferred from BOM's official track and ECHO/ReliefWeb/IFRC situation reports for the surrounding period, not from a bulletin-specific citation.
- **ILLUSTRATIVE** — not grounded in any source. Only warning #22 (the Cancel) uses this tier: no source confirms SIMS ever issued a formal cancellation bulletin for Maila.

See `tests/replay/mailaWarnings.js`'s module comment for full citations. Hazard-area polygons are also synthetic — a convex hull around each named province's own real boundary, buffered ~5km — not a captured storm polygon.

## Warning-by-warning timeline

| # | Issued (SBT) | Tier | msgType | Category | Severity | Provinces named | event_id | Reissue? | Lifecycle | Send? |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 2026-04-04 20:30:00.000Z | CONFIRMED | Alert | Category 1 | Moderate | Choiseul, Isabel, Western | warning-2 | **no (new)** | NEW | **yes** |
| 3 | 2026-04-05 02:30:00.000Z | interpolated | Alert | Category 2 | Moderate | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 4 | 2026-04-05 08:30:00.000Z | interpolated | Alert | Category 2 | Moderate | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 5 | 2026-04-05 14:30:00.000Z | interpolated | Alert | Category 2 | Moderate | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 6 | 2026-04-05 20:30:00.000Z | CONFIRMED | Alert | Category 3 | Severe | Choiseul, Isabel, Temotu, Western | warning-2 | yes | ESCALATED | **yes** |
| 7 | 2026-04-06 02:30:00.000Z | interpolated | Alert | Category 3 | Severe | Choiseul, Isabel, Temotu, Western | warning-2 | yes | UPDATED | no |
| 8 | 2026-04-06 08:30:00.000Z | interpolated | Alert | Category 3 | Severe | Choiseul, Isabel, Temotu, Western | warning-2 | yes | UPDATED | no |
| 9 | 2026-04-06 14:30:00.000Z | interpolated | Alert | Category 3 | Severe | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 10 | 2026-04-06 20:30:00.000Z | interpolated | Alert | Category 3 | Severe | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 11 | 2026-04-07 02:30:00.000Z | CONFIRMED | Alert | Category 3 | Severe | Choiseul, Isabel, Western | warning-2 | yes | UPDATED | no |
| 12 | 2026-04-07 08:30:00.000Z | interpolated | Alert | Category 4 | Extreme | Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | ESCALATED | **yes** |
| 13 | 2026-04-07 14:30:00.000Z | interpolated | Alert | Category 5 | Extreme | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | UPDATED | no |
| 14 | 2026-04-07 20:30:00.000Z | interpolated | Alert | Category 4 | Extreme | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | UPDATED | no |
| 15 | 2026-04-08 02:30:00.000Z | interpolated | Alert | Category 4 | Extreme | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | UPDATED | no |
| 16 | 2026-04-08 08:30:00.000Z | interpolated | Alert | Category 4 | Extreme | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | UPDATED | no |
| 17 | 2026-04-08 14:30:00.000Z | interpolated | Alert | Category 3 | Severe | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | WATCH | **yes** |
| 18 | 2026-04-08 20:30:00.000Z | interpolated | Alert | Category 3 | Severe | Central, Choiseul, Guadalcanal, Honiara, Isabel, Western | warning-2 | yes | UPDATED | no |
| 19 | 2026-04-09 02:30:00.000Z | interpolated | Alert | Category 2 | Moderate | Choiseul, Western | warning-2 | yes | ESCALATED | **yes** |
| 20 | 2026-04-09 08:30:00.000Z | interpolated | Alert | Category 2 | Moderate | Western | warning-2 | yes | UPDATED | no |
| 21 | 2026-04-09 20:30:00.000Z | interpolated | Alert | Category 1 | Minor | Western | warning-2 | yes | ESCALATED | **yes** |
| 22 | 2026-04-10 20:30:00.000Z | ILLUSTRATIVE | Cancel | - | Minor | Western | warning-2 | yes | CANCELLED | **yes** |

## Dedup behavior

21 warnings collapsed into **1 distinct event_id(s)**.

This is the correct outcome for a single continuous cyclone episode: every reissue and escalation should share one event_id, with lifecycle.js (not dedup) distinguishing routine reissues from real escalations.

7 of 21 warnings would have triggered an onward send; 14 were classified as routine reissues with no material change.

## Ground truth comparison

docs/PROJECT_HANDOFF.md's stated ground truth: **Western, Choiseul, Isabel, Guadalcanal, Central**.

Pipeline's cumulative affected-province result across the whole sequence: **Central, Choiseul, Guadalcanal, Honiara, Isabel, Temotu, Western**.

Provinces flagged that aren't in the doc's five-province list: Honiara, Temotu. See below — these break down into one expected case and one genuinely interesting one, not two bugs.

Two things explain every entry in that extra list, and neither is a pipeline defect:

- **Temotu** (warnings #6-#9): this is expected, not an error. The ground truth is the *cumulative* impact list from the storm's full passage, not a claim that every individual warning should name all five. Warning #6's real cited content names Temotu instead of Guadalcanal/Central, reflecting real forecast-track uncertainty four days before the eventual impact — a province appearing in an early forecast and dropping out later is a real property of how these events unfold.
- **Honiara** (from warning #12 onward, wherever Guadalcanal is named): this is a genuine finding worth NDMO/SIMS attention, not a fixture bug. Checked directly: Honiara sits *entirely inside* Guadalcanal's convex hull (the overlap area exactly equals Honiara's whole area, not just a shared border), so any polygon that reasonably represents "Guadalcanal is under warning" — synthetic or a real forecaster's own drawing — will geometrically cover Honiara too, since it's a small enclave inside Guadalcanal's extent. The doc's ground truth (sourced from ECHO/IFRC sitreps) never separately names Honiara, which likely just means humanitarian reporting folded the capital's impact into "Guadalcanal Province" figures rather than that Honiara was untouched. Point is: geographic routing based on administrative boundaries will systematically flag Honiara whenever Guadalcanal is hit, whether or not a situation report calls it out by name — that's arguably *correct* behavior for a warning-distribution system (better to over-notify the capital than miss it), but it means this pipeline's output won't always match a sitrep's own province list one-for-one, and that mismatch shouldn't be mistaken for a bug when it shows up again in production.

## Per-stage latency (in-process, fixture-driven — no network I/O in this replay)

| Stage | Samples | Mean | Min | Max |
|---|---|---|---|---|
| dedup | 21 | 0.078ms | 0.034ms | 0.336ms |
| lifecycle | 21 | 0.021ms | 0.005ms | 0.141ms |
| geo | 21 | 101.590ms | 43.134ms | 155.175ms |

These times reflect pure in-memory computation on this dataset only (21 warnings, 10 boundary units) — they say nothing about real network/fetch latency, which doesn't exist in a fixture-driven replay. Useful as a relative comparison across stages and a regression baseline, not as a production latency estimate.

## Boundary dataset used

`hdx-cod-ab-slb-adm1` v2018-11-01, boundary_status=**DEVELOPMENT_ONLY**, geometry_hash=`34b620c5444bcc6b...`.

## Flagged during construction of this replay

- **Same-day category discrepancy, 7 April**: confirmed Warning #11 (1:30pm) describes Maila as Category 3, while the same day's Cabinet briefing (per search-result summary of solomons.gov.sb — the page itself returned a JS bot-challenge this session couldn't solve) describes it as Category 4. Both are treated as real, independently-sourced facts about the same day rather than reconciled into one number — warning #12 onward adopts Category 4, timed after #11's confirmed 1:30pm reading.
- **No confirmed cyclone-category CAP structure**: docs/PROJECT_HANDOFF.md's own open item — only Strong Wind CAP alerts have ever been confirmed live. hazard_type "Tropical Cyclone" and the Yellow/Orange/Red color progression used here are extrapolated from the confirmed Strong Wind pattern, not confirmed for cyclone alerts.
- **Exact bulletin-to-date mapping beyond #11 is unconfirmed**: the 6-hourly cadence is confirmed (derived from three independently-cited bulletins, #2/#6/#11, landing exactly on a uniform schedule), but no source names a specific bulletin number for anything after #11 — warnings #12-22 are dead-reckoned forward from that cadence plus BOM/ECHO's general trajectory, not tied to specific cited bulletins.
- **The Cancel bulletin (#22) is fabricated for test coverage**, not sourced — flagged inline in its own timeline row and in mailaWarnings.js.
- **Synthetic hazard geometry**: every warning's polygon is a convex hull of the named provinces' own real boundaries, not a captured storm polygon — this tests the geo-mapping *logic*, not whether a real Maila CAP polygon would have geometrically resolved the same way.
- **A real dedup bug was found and fixed by this replay, not just narrated**: the first run of this replay split TC Maila's 21 warnings into 2 event_ids, because the illustrative Cancel bulletin (#22) landed ~16h after the prior warning's expiry — past dedup.js's original 6h adjacency grace period. The doc's own stated reissue cadence is "roughly every 6-24 hours," so a 16h gap is normal, not anomalous; using the *lower* bound of that range as the grace period was the actual bug. Fixed in src/normalization/dedup.js by changing DEFAULT_ADJACENCY_GRACE_MS from 6h to 24h; the existing normalization test suite (tests/normalization/) still passes after the change. This is exactly the kind of gap this replay exercise exists to catch before a real cyclone.
- **turf.buffer() on Western Province's real multi-island boundary took 47 seconds** for one province, before this fixture switched to buffering a convex hull instead (~30ms). This is a fixture-construction performance detail, not a finding about src/geo/mapping.js itself, which never buffers anything — but worth knowing if this replay is ever extended to buffer real (not hull-simplified) province geometry directly.