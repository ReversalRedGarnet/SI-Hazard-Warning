import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMailaReplay } from "./runReplay.js";
import { renderMailaReplayReport } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "output", "tc-maila-replay-report.md");

/**
 * This suite is deliberately not a strict pass/fail gate on every outcome —
 * docs/PROJECT_HANDOFF.md asks for this replay specifically to surface
 * gaps before a real cyclone, not to rubber-stamp the pipeline. The
 * interesting findings (ground-truth mismatches, dedup over/under-merging)
 * belong in the generated report for a human to read and decide what to do
 * about, not baked into assertions that would need constant updating as
 * the pipeline's behavior legitimately evolves.
 */
// Real turf geometry work (convex hulls over multi-island province
// boundaries) — comfortably under a second per warning but well past
// vitest's 5s default across 21 warnings on a cold cache.
const REPLAY_TIMEOUT_MS = 30_000;

describe("TC Maila replay", () => {
  it(
    "runs the full reconstructed warning sequence through the pipeline without throwing, and writes a readable report",
    () => {
      const result = runMailaReplay();

      // The task's explicit minimum ("Numbers Two through at least Eighteen") — this dataset runs #2 through #22.
      expect(result.totalWarnings).toBeGreaterThanOrEqual(18);
      expect(result.timeline).toHaveLength(result.totalWarnings);

      const report = renderMailaReplayReport(result);
      mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, report, "utf8");

      console.log(`\nTC Maila replay report written to ${OUTPUT_PATH}\n`);
      console.log(report);
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "surfaces (but does not hide) any dedup or ground-truth gaps",
    () => {
      const result = runMailaReplay();

      expect(result.distinctEventIdCount).toBeGreaterThanOrEqual(1);
      expect(result.groundTruthProvinces).toEqual(["Western", "Choiseul", "Isabel", "Guadalcanal", "Central"]);

      if (result.falseNegatives.length > 0 || result.falsePositives.length > 0 || result.distinctEventIdCount > 1) {
        console.warn(
          `TC Maila replay surfaced a gap — falseNegatives=${JSON.stringify(result.falseNegatives)} falsePositives=${JSON.stringify(result.falsePositives)} distinctEventIds=${result.distinctEventIdCount}. See tests/replay/output/tc-maila-replay-report.md.`,
        );
      }
    },
    REPLAY_TIMEOUT_MS,
  );
});
