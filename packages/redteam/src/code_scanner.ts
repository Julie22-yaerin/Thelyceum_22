/**
 * Code Flaw & Risk Scanner for Red Team.
 *
 * Scans claims, plans, and proposed code edits for:
 *   - WARN / ADVISE: Code heading in the wrong direction, anti-patterns, potential bugs,
 *     type unsafety, resource leaks, or missing error handling. (Does NOT block agent)
 *   - BLOCK: Deterministic crashes, syntax errors, infinite recursion, malicious payloads,
 *     or hardcoded credential leaks. (BLOCKS agent execution)
 */

import { FlawClass, RedFlag } from "./challenge.js";

export interface CodeScanRule {
  flaw: FlawClass;
  severity: "warning" | "blocking";
  explanation: string;
  counter: string;
  advice: string;
  pattern?: RegExp;
  evaluate?: (text: string) => { evidence: string; detail?: string } | null;
}

export const CODE_RULES: CodeScanRule[] = [
  // ── BLOCKING RULES ────────────────────────────────────────────────────────
  {
    flaw: "guaranteed_crash",
    severity: "blocking",
    explanation: "Code path contains a guaranteed runtime crash, infinite recursion without a base case, or divide by zero.",
    counter: "Fix the syntax or logic error before running. Ensure base case exists for recursion and guard against division by zero.",
    advice: "Check recursion termination conditions and mathematical operations.",
    evaluate: (text) => {
      // 1. Division by literal zero
      const divZero = text.match(/\b[\w\d_.]+\s*\/\s*0(?:\.0+)?\b/);
      if (divZero) return { evidence: divZero[0], detail: "Division by literal zero" };

      // 2. Direct infinite recursion (e.g. function foo() { foo(); } or const bar = () => bar())
      const infRec = text.match(/(?:function\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{[^}]*\b\1\s*\([^)]*\);?\s*\}|const\s+([a-zA-Z0-9_$]+)\s*=\s*\([^)]*\)\s*=>\s*\2\s*\([^)]*\))/);
      if (infRec) return { evidence: infRec[0], detail: "Direct infinite recursion without base condition" };

      // 3. Unhandled throw of raw literal without try/catch wrapper
      const unhandledThrow = text.match(/\bthrow\s+(?:new\s+Error\([^)]*\)|"[^"]*"|'[^']*');?(?!\s*\}|\s*catch)/);
      if (unhandledThrow && !text.includes("try {")) {
        return { evidence: unhandledThrow[0], detail: "Top-level unhandled exception throw" };
      }

      return null;
    },
  },
  {
    flaw: "malicious_payload",
    severity: "blocking",
    explanation: "Code contains destructive system operations, raw code evaluation on untrusted input, or hardcoded secrets.",
    counter: "Remove destructive commands, use safe execution paradigms, and move API keys to environment variables.",
    advice: "Never hardcode secret keys or execute raw dynamic code from request input.",
    evaluate: (text) => {
      // Destructive command check (ultra-fast regex + line comment check)
      const destructive = text.match(/\b(?:rm\s+-rf\s+(?:\/|~|\/\*)|mkfs|dd\s+if=|\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)/);
      if (destructive) {
        const lines = text.split("\n");
        const matchLine = lines.find((l) => l.includes(destructive[0]));
        if (matchLine && !/^\s*(?:\/\/|\/\*|\*|#)/.test(matchLine)) {
          return { evidence: destructive[0], detail: "Destructive command pattern" };
        }
      }

      // Raw eval / Function constructor on variable input
      const unsafeEval = text.match(/\b(?:eval\s*\(\s*(?:req|input|params|body|payload|userInput)|new\s+Function\s*\(\s*(?:req|input|params|body|payload))\b/i);
      if (unsafeEval) return { evidence: unsafeEval[0], detail: "Dynamic code execution on untrusted input" };

      // Hardcoded AWS Access Key, Private Key, GitHub token, OpenAI key, or Slack webhook
      const secret = text.match(/\b(?:AKIA[0-9A-Z]{16}|-----BEGIN\s+(?:RSA|EC|PGP)?\s*PRIVATE\s+KEY-----|ghp_[a-zA-Z0-9]{30,40}|sk-[a-zA-Z0-9]{32,}|https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+)\b/);
      if (secret) return { evidence: secret[0], detail: "Hardcoded secret credential or webhook token" };

      return null;
    },
  },
  {
    flaw: "infinite_loop_risk",
    severity: "blocking",
    explanation: "Code contains an unconditional loop (while(true) or for(;;)) without an internal break, return, or exit guard.",
    counter: "Ensure loop structures have explicit exit criteria, timeout guards, or iteration caps.",
    advice: "Add a break condition or maximum iteration cap to prevent process hang.",
    evaluate: (text) => {
      const loopMatch = text.match(/\b(?:while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{([^}]*)\}/s);
      if (loopMatch) {
        const body = loopMatch[1];
        if (!/\b(?:break|return|throw|process\.exit)\b/.test(body)) {
          return { evidence: loopMatch[0].slice(0, 150), detail: "Unbounded loop without break or exit condition" };
        }
      }
      return null;
    },
  },

  // ── WARNING RULES (WARN / ADVISE - DO NOT BLOCK) ──────────────────────────
  {
    flaw: "hallucinated_package_risk",
    severity: "warning",
    explanation: "Code or shell command attempts to install or import non-existent or typosquatted package dependencies.",
    counter: "Verify dependency names against official package registries (npm/PyPI) before adding them to requirements or package.json.",
    advice: "Verify package names in registry before installation to prevent typosquatting vulnerabilities.",
    pattern: /\b(?:npm\s+i(?:nstall)?|pip\s+install|yarn\s+add)\s+[^\n]*\b(?:non[-_]?existent|fake[-_]?pkg|test[-_]?dep[-_]?123)\b/i,
  },
  {
    flaw: "security_bypass",
    severity: "warning",
    explanation: "Code contains direct file reads of system secrets or cloud workspace metadata (.env, /run/secrets, REPL_IDENTITY).",
    counter: "Use proper configuration context or environment secret injectors instead of raw filesystem reads.",
    advice: "Avoid reading raw secret files directly in application code paths.",
    pattern: /\b(?:fs\.readFile|readFileSync)\s*\(\s*["'](?:.*\.env|\/run\/secrets\/.*|\.replit)["']\)/i,
  },
  {
    flaw: "code_drift",
    severity: "warning",
    explanation: "Code structure shows signs of drift: empty catch blocks swallowing errors, deep callback nesting, or global state mutation.",
    counter: "Refactor code to handle exceptions explicitly, flatten callback chains, and use immutable state management.",
    advice: "Do not swallow exceptions in empty catch blocks. Return clean error objects or rethrow.",
    evaluate: (text) => {
      // Empty catch block
      const emptyCatch = text.match(/catch\s*\([^)]*\)\s*\{\s*\}/);
      if (emptyCatch) return { evidence: emptyCatch[0], detail: "Empty catch block swallowing error" };

      // Direct global mutation
      const globalMutate = text.match(/\b(?:window|global|globalThis)\.[a-zA-Z0-9_$]+\s*=/);
      if (globalMutate) return { evidence: globalMutate[0], detail: "Direct global namespace mutation" };

      return null;
    },
  },
  {
    flaw: "unhandled_async_risk",
    severity: "warning",
    explanation: "Potential floating promise or unhandled async operation without await or .catch().",
    counter: "Ensure async calls are either awaited or have explicit error handling attached.",
    advice: "Add `await` or `.catch()` to handle async errors and prevent unhandled promise rejections.",
    evaluate: (text) => {
      // Floating async fetch / fs operation inside an async function without await
      const floatingAsync = text.match(/(?:async\s+function|\([^)]*\)\s*=>\s*\{)[^}]*?\b(?<!await\s+)(?:fetch|fs\.promises\.[a-zA-Z]+|axios\.[a-zA-Z]+)\s*\([^)]*\)(?!\s*\.(?:then|catch|finally))/);
      if (floatingAsync) return { evidence: floatingAsync[0], detail: "Floating promise without await or .catch()" };

      return null;
    },
  },
  {
    flaw: "null_pointer_risk",
    severity: "warning",
    explanation: "Deep nested property access without optional chaining (`?.`) or null checking, risking a TypeError.",
    counter: "Use optional chaining (`?.`) or add explicit null/undefined checks before reading properties.",
    advice: "Replace unsafe nested access (e.g., `a.b.c`) with `a?.b?.c`.",
    evaluate: (text) => {
      // 3+ level property chain without optional chaining (e.g. data.user.profile.name)
      const deepChain = text.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*\.[a-zA-Z_$][a-zA-Z0-9_$]*\b/);
      if (deepChain && !deepChain[0].includes("?.")) {
        return { evidence: deepChain[0], detail: "Deep property chain without optional chaining" };
      }
      return null;
    },
  },
  {
    flaw: "type_safety_risk",
    severity: "warning",
    explanation: "Heavy reliance on `any` cast or compiler suppression annotations.",
    counter: "Define explicit TypeScript interfaces or generic types instead of casting to `any`.",
    advice: "Avoid using `any` or disabling type checks.",
    pattern: /\b(?:as\s+any|:\s*any\b|\/\/\s*@ts-ignore|\/\/\s*@ts-nocheck)/i,
  },
  {
    flaw: "resource_leak_risk",
    severity: "warning",
    explanation: "Resource allocation (file handle, timer, event listener) without explicit cleanup or finally block.",
    counter: "Wrap resource usage in `try...finally` or ensure `close()` / `clearInterval()` is called.",
    advice: "Use `try...finally` to ensure resources are cleaned up even if errors occur.",
    evaluate: (text) => {
      const openWithoutClose = text.match(/\b(?:fs\.openSync|setInterval|addEventListener)\s*\([^)]*\)/);
      if (openWithoutClose) {
        const hasCleanup = /closeSync|clearInterval|removeEventListener|finally/i.test(text);
        if (!hasCleanup) return { evidence: openWithoutClose[0], detail: "Resource created without visible cleanup" };
      }
      return null;
    },
  },
];

export function scanCodeFlaws(text: string): RedFlag[] {
  const flags: RedFlag[] = [];

  for (const rule of CODE_RULES) {
    let evidence: string | null = null;
    let explanation = rule.explanation;

    if (rule.evaluate) {
      const res = rule.evaluate(text);
      if (res) {
        evidence = res.evidence;
        if (res.detail) explanation += ` (${res.detail})`;
      }
    } else if (rule.pattern) {
      const m = text.match(rule.pattern);
      if (m) evidence = m[0];
    }

    if (evidence) {
      flags.push({
        flaw: rule.flaw,
        severity: rule.severity,
        evidence: evidence.slice(0, 200),
        explanation,
        counter: rule.counter,
        advice: rule.advice,
      });
    }
  }

  return flags;
}
