import { describe, it, expect } from "vitest";
import { challenge } from "../src/challenge.js";

describe("Red Team Code Flaw & Wrong Direction Detection", () => {
  it("generates WARNING for code drift (empty catch block) without blocking execution", () => {
    const code = `
      try {
        doSomething();
      } catch (err) {}
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "code_drift")).toBe(true);
    expect(res.verdict.blocked).toBe(false);
    expect(res.verdict.action).toBe("warn");
    expect(res.verdict.warnings.length).toBeGreaterThan(0);
  });

  it("generates WARNING for deep null pointer risk without blocking execution", () => {
    const code = `
      const name = response.data.user.profile.details.firstName;
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "null_pointer_risk")).toBe(true);
    expect(res.verdict.blocked).toBe(false);
    expect(res.verdict.action).toBe("warn");
  });

  it("generates WARNING for type safety risk (as any)", () => {
    const code = `
      const config = loadConfig() as any;
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "type_safety_risk")).toBe(true);
    expect(res.verdict.blocked).toBe(false);
    expect(res.verdict.action).toBe("warn");
  });

  it("BLOCKS on guaranteed crash (divide by zero)", () => {
    const code = `
      const ratio = total / 0;
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "guaranteed_crash")).toBe(true);
    expect(res.verdict.blocked).toBe(true);
    expect(res.verdict.action).toBe("block");
  });

  it("BLOCKS on guaranteed crash (direct infinite recursion)", () => {
    const code = `
      function crashLoop() {
        crashLoop();
      }
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "guaranteed_crash")).toBe(true);
    expect(res.verdict.blocked).toBe(true);
    expect(res.verdict.action).toBe("block");
  });

  it("BLOCKS on malicious payload (rm -rf /)", () => {
    const code = `
      exec("rm -rf /");
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "malicious_payload")).toBe(true);
    expect(res.verdict.blocked).toBe(true);
    expect(res.verdict.action).toBe("block");
  });

  it("BLOCKS on malicious payload (hardcoded secret)", () => {
    const code = `
      const awsKey = "AKIAIOSFODNN7EXAMPLE";
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "malicious_payload")).toBe(true);
    expect(res.verdict.blocked).toBe(true);
    expect(res.verdict.action).toBe("block");
  });

  it("BLOCKS on infinite loop risk (while(true) with no break/return)", () => {
    const code = `
      while (true) {
        doSomethingWithoutBreak();
      }
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "infinite_loop_risk")).toBe(true);
    expect(res.verdict.blocked).toBe(true);
    expect(res.verdict.action).toBe("block");
  });

  it("generates WARNING for hallucinated package risk", () => {
    const code = `
      npm install fake-pkg-dep-123
    `;
    const res = challenge(code);
    expect(res.flags.some((f) => f.flaw === "hallucinated_package_risk")).toBe(true);
    expect(res.verdict.action).toBe("warn");
  });
});
