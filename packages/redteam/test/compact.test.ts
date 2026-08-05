import { describe, it, expect } from "vitest";
import { compactContext } from "../src/compact.js";

describe("compactContext", () => {
  it("returns empty result for empty string", () => {
    const res = compactContext("");
    expect(res.compactedText).toBe("");
    expect(res.removedTokensCount).toBe(0);
  });

  it("filters English hesitation fillers (uh, um, er, you know)", () => {
    const text = "We should, uh, use Postgres because, um, it is fast and, er, you know reliable.";
    const res = compactContext(text);
    expect(res.compactedText).toBe("We should use Postgres because it is fast and reliable.");
    expect(res.removedTokensCount).toBeGreaterThan(0);
    expect(res.removedFillers.length).toBeGreaterThan(0);
  });

  it("filters Vietnamese hesitation fillers (ừm, ờ, à, kiểu như là, thì là)", () => {
    const text = "Tôi nghĩ là, ừm, hệ thống này, kiểu như là, cần nâng cấp, ờ, ngay bây giờ.";
    const res = compactContext(text);
    expect(res.compactedText).toBe("Tôi nghĩ là hệ thống này cần nâng cấp ngay bây giờ.");
    expect(res.removedTokensCount).toBeGreaterThan(0);
  });

  it("cleans duplicate words (is is, the the, là là)", () => {
    const text = "This is is the the best approach mà mà chúng ta có.";
    const res = compactContext(text);
    expect(res.compactedText).toBe("This is the best approach mà chúng ta có.");
    expect(res.removedDuplicates).toContain("is is");
    expect(res.removedDuplicates).toContain("the the");
    expect(res.removedDuplicates).toContain("mà mà");
  });

  it("preserves legitimate Vietnamese reduplication (ngày ngày, nhà nhà)", () => {
    const text = "Chúng ta theo dõi log ngày ngày ở nhà nhà.";
    const res = compactContext(text, { preserveVietnameseReduplication: true });
    expect(res.compactedText).toContain("ngày ngày");
    expect(res.compactedText).toContain("nhà nhà");
  });

  it("preserves technical terms, numbers, and logical structure", () => {
    const text = "Function calculateTotal(items: Item[]) { return items.reduce((a, b) => a + b.price, 0); }";
    const res = compactContext(text);
    expect(res.compactedText).toBe(text);
    expect(res.removedTokensCount).toBe(0);
  });
});
