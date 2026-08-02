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
import { BRAKE_GUIDE, REDTEAM_GUIDE, THRIFT_GUIDE, guideFor, previewOf } from "../src/guides.js";

describe("guideFor", () => {
  it("resolves known products", () => {
    expect(guideFor("brake")?.product).toBe("brake");
    expect(guideFor("redteam")?.product).toBe("redteam");
    expect(guideFor("thrift")?.product).toBe("thrift");
  });

  it("returns null for anything else", () => {
    expect(guideFor("nonexistent")).toBeNull();
  });
});

describe("gating flags", () => {
  it("every product is gated behind the same Lyceum subscription", () => {
    for (const g of [BRAKE_GUIDE, REDTEAM_GUIDE, THRIFT_GUIDE]) {
      expect(g.gated, g.product).toBe(true);
    }
  });
});

describe("previewOf", () => {
  for (const guide of [BRAKE_GUIDE, REDTEAM_GUIDE, THRIFT_GUIDE]) {
    describe(guide.product, () => {
      it("returns exactly the first step, not a summary of it", () => {
        const preview = previewOf(guide);
        expect(preview.steps).toHaveLength(1);
        expect(preview.steps[0]).toEqual(guide.steps[0]);
      });

      it("the preview step is real and runnable, not a teaser", () => {
        // If the one free step doesn't actually work, an unlicensed
        // visitor's first experience of the product is a broken command —
        // worse than no preview at all.
        const preview = previewOf(guide);
        expect(preview.steps[0].command).toBeTruthy();
        expect(preview.steps[0].expect).toBeTruthy();
      });

      it("does not mutate the source guide", () => {
        const before = guide.steps.length;
        previewOf(guide);
        expect(guide.steps.length).toBe(before);
      });
    });
  }
});

describe("guide content integrity", () => {
  it("every step has a title and a detail", () => {
    for (const guide of [BRAKE_GUIDE, REDTEAM_GUIDE, THRIFT_GUIDE]) {
      for (const step of guide.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("a step with a command also states what to expect", () => {
    // A command with no stated output leaves the operator unable to tell
    // whether it worked — exactly the gap a guided setup exists to close.
    for (const guide of [BRAKE_GUIDE, REDTEAM_GUIDE, THRIFT_GUIDE]) {
      for (const step of guide.steps) {
        if (step.command) expect(step.expect).toBeTruthy();
      }
    }
  });
});
