import { describe, it, expect } from "vitest";
import { deriveLifecycleTransition, LifecycleState } from "../../src/normalization/lifecycle.js";
import { reissueOne, reissueTwo } from "./fixtures.js";

describe("deriveLifecycleTransition", () => {
  it("is NEW with a send trigger for the first message of an event", () => {
    const transition = deriveLifecycleTransition(null, reissueOne());
    expect(transition.state).toBe(LifecycleState.NEW);
    expect(transition.sendTrigger).toBe(true);
  });

  it("is UPDATED with no send trigger for a same-severity reissue", () => {
    const transition = deriveLifecycleTransition(reissueOne(), reissueTwo());
    expect(transition.state).toBe(LifecycleState.UPDATED);
    expect(transition.sendTrigger).toBe(false);
  });

  it("is ESCALATED with a send trigger when severity increases", () => {
    const previous = reissueOne({ severity: "Moderate" });
    const current = reissueTwo({ severity: "Severe" });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).toBe(LifecycleState.ESCALATED);
    expect(transition.sendTrigger).toBe(true);
    expect(transition.reasons).toContain("severity increase");
  });

  it("is ESCALATED when the affected area count increases, even at unchanged severity", () => {
    const previous = reissueOne();
    const current = reissueTwo({
      alert_areas: [...previous.alert_areas, { description: "Western Province", polygon: [], circle: [], geocode: [] }],
    });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).toBe(LifecycleState.ESCALATED);
    expect(transition.reasons).toContain("affected-area increase");
  });

  it("is ESCALATED when urgency changes even though severity doesn't", () => {
    const previous = reissueOne({ urgency: "Expected" });
    const current = reissueTwo({ urgency: "Immediate" });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).toBe(LifecycleState.ESCALATED);
    expect(transition.reasons).toContain("material forecast change");
  });

  it("is WATCH with a send trigger on a downgrade", () => {
    const previous = reissueOne({ severity: "Severe" });
    const current = reissueTwo({ severity: "Moderate" });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).toBe(LifecycleState.WATCH);
    expect(transition.sendTrigger).toBe(true);
  });

  it("is CANCELLED with a send trigger regardless of severity comparison", () => {
    const previous = reissueOne();
    const current = reissueTwo({ msg_type: "Cancel" });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).toBe(LifecycleState.CANCELLED);
    expect(transition.sendTrigger).toBe(true);
  });

  it("never returns ALL_CLEAR automatically", () => {
    const previous = reissueOne();
    const current = reissueTwo({ msg_type: "Cancel" });
    const transition = deriveLifecycleTransition(previous, current);
    expect(transition.state).not.toBe(LifecycleState.ALL_CLEAR);
  });
});
