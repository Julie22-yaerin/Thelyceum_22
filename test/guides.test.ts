/**
 * Guide gating.
 *
 * The invariant: redteam (free product) is never gated, and brake (paid
 * product) never gives more than the first step without an active
 * subscription — checked here at the pure-function level, and exercised end
 * to end over HTTP in the manual verification this file's sibling tests
 * don't reach (signup → checkout → unlock), documented in the guide's own
 * module comment.
 */

import { describe, expect, it } from "vitest";
import { BRAKE_GUIDE, REDTEAM_GUIDE, guideFor, previewOf } from "../server/src/guides.js";

describe("guideFor", () => {
  it("resolves known products", () => {
    expect(guideFor("brake")?.product).toBe("brake");
    expect(guideFor("redteam")?.product).toBe("redteam");
  });

  it("returns null for anything else", () => {
    expect(guideFor("nonexistent")).toBeNull();
  });
});

describe("gating flags", () => {
  it("redteam is never gated — it is free end to end", () => {
    expect(REDTEAM_GUIDE.gated).toBe(false);
  });

  it("brake is gated — it is the paid product", () => {
    expect(BRAKE_GUIDE.gated).toBe(true);
  });
});

describe("previewOf", () => {
  it("returns exactly the first step, not a summary of it", () => {
    const preview = previewOf(BRAKE_GUIDE);
    expect(preview.steps).toHaveLength(1);
    expect(preview.steps[0]).toEqual(BRAKE_GUIDE.steps[0]);
  });

  it("the preview step is real and runnable, not a teaser", () => {
    // If the one free step doesn't actually work, an unlicensed visitor's
    // first experience of the product is a broken command — worse than no
    // preview at all.
    const preview = previewOf(BRAKE_GUIDE);
    expect(preview.steps[0].command).toBeTruthy();
    expect(preview.steps[0].expect).toBeTruthy();
  });

  it("does not mutate the source guide", () => {
    const before = BRAKE_GUIDE.steps.length;
    previewOf(BRAKE_GUIDE);
    expect(BRAKE_GUIDE.steps.length).toBe(before);
  });
});

describe("guide content integrity", () => {
  it("every step has a title and a detail", () => {
    for (const guide of [BRAKE_GUIDE, REDTEAM_GUIDE]) {
      for (const step of guide.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("a step with a command also states what to expect", () => {
    // A command with no stated output leaves the operator unable to tell
    // whether it worked — exactly the gap a guided setup exists to close.
    for (const guide of [BRAKE_GUIDE, REDTEAM_GUIDE]) {
      for (const step of guide.steps) {
        if (step.command) expect(step.expect).toBeTruthy();
      }
    }
  });
});
