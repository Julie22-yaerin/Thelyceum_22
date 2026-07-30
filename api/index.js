var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/db/memoryFirestore.ts
function incrementAmount(value) {
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  if (typeof v.operand === "number") return v.operand;
  if (typeof v.__increment__ === "number") return v.__increment__;
  return null;
}
function applyUpdate(existing, patch) {
  const merged = { ...existing ?? {} };
  for (const [key, value] of Object.entries(patch)) {
    const inc = incrementAmount(value);
    if (inc !== null) {
      merged[key] = (typeof merged[key] === "number" ? merged[key] : 0) + inc;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
var MemoryQuery, MemoryCollection, MemoryFirestore;
var init_memoryFirestore = __esm({
  "server/db/memoryFirestore.ts"() {
    "use strict";
    MemoryQuery = class _MemoryQuery {
      constructor(rows) {
        this.rows = rows;
      }
      where(field, op, value) {
        const rows = this.rows.filter((r) => {
          const actual = r.data[field];
          switch (op) {
            case "==":
              return actual === value;
            case "!=":
              return actual !== value;
            case ">":
              return actual > value;
            case ">=":
              return actual >= value;
            case "<":
              return actual < value;
            case "<=":
              return actual <= value;
            case "in":
              return Array.isArray(value) && value.includes(actual);
            case "array-contains":
              return Array.isArray(actual) && actual.includes(value);
            default:
              throw new Error(`memoryFirestore: unsupported operator "${op}"`);
          }
        });
        return new _MemoryQuery(rows);
      }
      orderBy(field, dir = "asc") {
        const sorted = [...this.rows].sort((a, b) => {
          const av = a.data[field];
          const bv = b.data[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return dir === "desc" ? -cmp : cmp;
        });
        return new _MemoryQuery(sorted);
      }
      limit(n) {
        return new _MemoryQuery(this.rows.slice(0, n));
      }
      async get() {
        return {
          empty: this.rows.length === 0,
          size: this.rows.length,
          docs: this.rows.map((r) => ({
            id: String(r.data.id ?? ""),
            exists: true,
            data: () => ({ ...r.data })
          }))
        };
      }
    };
    MemoryCollection = class {
      store = /* @__PURE__ */ new Map();
      autoId = 0;
      doc(id) {
        const docId = id ?? `mem${(++this.autoId).toString(36).padStart(6, "0")}${Date.now().toString(36)}`;
        const store = this.store;
        return {
          id: docId,
          get: async () => {
            const doc = store.get(docId);
            return {
              id: docId,
              exists: !!doc,
              data: () => doc ? { ...doc.data } : void 0
            };
          },
          set: async (data, opts) => {
            const existing = store.get(docId);
            store.set(docId, {
              data: opts?.merge ? applyUpdate(existing?.data, data) : { ...data }
            });
          },
          update: async (data) => {
            const existing = store.get(docId);
            store.set(docId, { data: applyUpdate(existing?.data, data) });
          },
          delete: async () => {
            store.delete(docId);
          }
        };
      }
      where(field, op, value) {
        return new MemoryQuery(Array.from(this.store.values())).where(field, op, value);
      }
      orderBy(field, dir = "asc") {
        return new MemoryQuery(Array.from(this.store.values())).orderBy(field, dir);
      }
      async get() {
        return new MemoryQuery(Array.from(this.store.values())).get();
      }
    };
    MemoryFirestore = class {
      collections = /* @__PURE__ */ new Map();
      collection(name) {
        let c = this.collections.get(name);
        if (!c) {
          c = new MemoryCollection();
          this.collections.set(name, c);
        }
        return c;
      }
      /**
       * Runs the body immediately. There is no isolation and no retry: this is a
       * single-threaded process, so the read-modify-write inside a transaction
       * cannot interleave with another one. Callers relying on Firestore's
       * contention retries get the same *result* here, just without the
       * concurrency guarantee — which is fine because there is no concurrency.
       */
      async runTransaction(fn) {
        return fn({
          get: (ref) => ref.get(),
          set: (ref, data, opts) => {
            void ref.set(data, opts);
          },
          update: (ref, data) => {
            void ref.update(data);
          },
          delete: (ref) => {
            void ref.delete();
          }
        });
      }
    };
  }
});

// server/db/firestore.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
function getDb() {
  if (db) return db;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const configured = !!(projectId && clientEmail && privateKey);
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Firestore is not configured \u2014 set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY. The in-memory fallback is deliberately disabled in production because it is not durable."
      );
    }
    if (!warned) {
      warned = true;
      console.warn(
        "[Lyceum] No Firebase credentials \u2014 using the in-memory store. Data will be lost on restart and is not shared between instances. Set FIREBASE_* to persist."
      );
    }
    memory ??= new MemoryFirestore();
    return memory;
  }
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  db = getFirestore();
  return db;
}
function isEphemeralStore() {
  return memory !== null && db === null;
}
var db, memory, warned;
var init_firestore = __esm({
  "server/db/firestore.ts"() {
    "use strict";
    init_memoryFirestore();
    db = null;
    memory = null;
    warned = false;
  }
});

// server/lib/executionConfig.ts
function canAutoRetry(config, attempts, isSubtask) {
  if (attempts.length >= config.maxAttempts) return false;
  if (isSubtask && config.autoApproveSubtasks) return true;
  return false;
}
function formatErrorContext(error, endpoint, attemptNumber) {
  const lines = [
    `\u274C Attempt ${attemptNumber} failed at ${endpoint}`,
    `   Error: ${error}`
  ];
  return lines.join("\n");
}
var DEFAULT_MAX_ATTEMPTS, DEFAULT_AUTO_APPROVE_SUBTASKS, DEFAULT_EXECUTION_CONFIG;
var init_executionConfig = __esm({
  "server/lib/executionConfig.ts"() {
    "use strict";
    DEFAULT_MAX_ATTEMPTS = 2;
    DEFAULT_AUTO_APPROVE_SUBTASKS = false;
    DEFAULT_EXECUTION_CONFIG = {
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      autoApproveSubtasks: DEFAULT_AUTO_APPROVE_SUBTASKS
    };
  }
});

// server/db/tasks.ts
var tasks_exports = {};
__export(tasks_exports, {
  getTask: () => getTask,
  listTasks: () => listTasks,
  recordTask: () => recordTask,
  updateTaskApproval: () => updateTaskApproval,
  updateTaskAttempt: () => updateTaskAttempt
});
async function recordTask(params) {
  const ref = collection3().doc();
  const task = {
    id: ref.id,
    createdAt: Date.now(),
    attemptCount: params.attemptCount ?? 0,
    maxAttempts: params.maxAttempts ?? DEFAULT_EXECUTION_CONFIG.maxAttempts,
    attempts: params.attempts ?? [],
    autoApproveSubtasks: params.autoApproveSubtasks ?? DEFAULT_EXECUTION_CONFIG.autoApproveSubtasks,
    humanApprovalRequest: params.humanApprovalRequest ?? null,
    licenseKey: params.licenseKey,
    domain: params.domain,
    prompt: params.prompt,
    source: params.source,
    status: params.status,
    result: params.result,
    error: params.error,
    creditsCost: params.creditsCost
  };
  await ref.set(task);
  return task;
}
async function updateTaskAttempt(taskId, licenseKey, update) {
  const ref = collection3().doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const existing = snap.data();
  if (existing.licenseKey !== licenseKey) return null;
  const updated = {
    ...existing,
    status: update.status ?? existing.status,
    result: update.result ?? existing.result,
    error: update.error ?? existing.error,
    attemptCount: update.attemptCount ?? existing.attemptCount,
    humanApprovalRequest: update.humanApprovalRequest !== void 0 ? update.humanApprovalRequest : existing.humanApprovalRequest,
    // Append new attempts to the existing history
    attempts: update.newAttempts ? [...existing.attempts, ...update.newAttempts] : existing.attempts
  };
  await ref.set(updated);
  return updated;
}
async function updateTaskApproval(taskId, licenseKey, approval) {
  const ref = collection3().doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const existing = snap.data();
  if (existing.licenseKey !== licenseKey) return null;
  const updated = {
    ...existing,
    humanApprovalRequest: approval,
    status: approval.status === "approved" ? existing.status : "awaiting_approval"
  };
  await ref.set(updated);
  return updated;
}
async function listTasks(licenseKey, limit = 20) {
  const snap = await collection3().where("licenseKey", "==", licenseKey).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data());
}
async function getTask(taskId, licenseKey) {
  const snap = await collection3().doc(taskId).get();
  if (!snap.exists) return null;
  const task = snap.data();
  return task.licenseKey === licenseKey ? task : null;
}
var collection3;
var init_tasks = __esm({
  "server/db/tasks.ts"() {
    "use strict";
    init_firestore();
    init_executionConfig();
    collection3 = () => getDb().collection("tasks");
  }
});

// server/db/sessions.ts
var sessions_exports = {};
__export(sessions_exports, {
  confirmSession: () => confirmSession,
  createSession: () => createSession,
  deleteSession: () => deleteSession,
  getSession: () => getSession,
  listSessions: () => listSessions,
  updateSessionMeta: () => updateSessionMeta,
  updateSessionTasks: () => updateSessionTasks
});
async function createSession(params) {
  const ref = collection7().doc();
  const session = {
    id: ref.id,
    licenseKey: params.licenseKey,
    name: params.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    confirmed: false,
    active: false,
    activeTaskId: null,
    tasks: params.tasks
  };
  await ref.set(session);
  return session;
}
async function confirmSession(sessionId, licenseKey) {
  const ref = collection7().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return null;
  const updated = {
    confirmed: true,
    active: true,
    updatedAt: Date.now()
  };
  await ref.update(updated);
  return { ...data, ...updated };
}
async function updateSessionTasks(sessionId, licenseKey, tasks) {
  const ref = collection7().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return null;
  const updated = {
    tasks,
    updatedAt: Date.now()
  };
  await ref.update(updated);
  return { ...data, ...updated, tasks };
}
async function updateSessionMeta(sessionId, licenseKey, meta) {
  const ref = collection7().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return null;
  const updated = { ...meta, updatedAt: Date.now() };
  await ref.update(updated);
  return { ...data, ...updated };
}
async function getSession(sessionId, licenseKey) {
  const snap = await collection7().doc(sessionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data.licenseKey === licenseKey ? data : null;
}
async function listSessions(licenseKey, limit = 50) {
  const snap = await collection7().where("licenseKey", "==", licenseKey).orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data());
}
async function deleteSession(sessionId, licenseKey) {
  const ref = collection7().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return false;
  await ref.delete();
  return true;
}
var collection7;
var init_sessions = __esm({
  "server/db/sessions.ts"() {
    "use strict";
    init_firestore();
    collection7 = () => getDb().collection("sessions");
  }
});

// server/index.ts
import express2 from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto4 from "crypto";

// client/src/lib/modelConfig.ts
var DOMAINS = ["LAW", "FINANCE", "TECH", "MUSE", "KIMI"];
var MODEL_ROUTES = {
  LAW: {
    label: "Law",
    model: "anthropic/claude-sonnet-5",
    provider: "Anthropic \u2014 Claude Sonnet 5",
    rationale: "Superior reasoning, citation accuracy, and long-context statute analysis"
  },
  FINANCE: {
    label: "Finance",
    model: "openai/gpt-4o",
    provider: "OpenAI \u2014 GPT-4o",
    rationale: "Structured data handling, numerical precision, and table generation"
  },
  TECH: {
    label: "Tech",
    model: "google/gemini-2.5-flash",
    provider: "Google \u2014 Gemini 2.5 Flash",
    rationale: "Fast inference, strong code generation, and debugging capability"
  },
  MUSE: {
    label: "Muse",
    model: "meta/muse-spark-1.1",
    provider: "Meta \u2014 Muse Spark 1.1",
    rationale: "Document structure analysis, section extraction, and content group classification"
  },
  KIMI: {
    label: "Kimi",
    model: "moonshot/kimi-3",
    provider: "Moonshot \u2014 KIMI 3",
    rationale: "Advanced workflow generation, task decomposition, and optimization for AI-human collaboration pipelines"
  }
};

// server/lib/openrouter.ts
var KEY_MAP = {
  LAW: process.env.OPENROUTER_KEY_LAW || process.env.VITE_OPENROUTER_KEY_LAW || "",
  FINANCE: process.env.OPENROUTER_KEY_FINANCE || process.env.VITE_OPENROUTER_KEY_FINANCE || "",
  TECH: process.env.OPENROUTER_KEY_TECH || process.env.VITE_OPENROUTER_KEY_TECH || "",
  MUSE: process.env.OPENROUTER_KEY_MUSE || process.env.VITE_OPENROUTER_KEY_MUSE || "",
  KIMI: process.env.OPENROUTER_KEY_KIMI || process.env.VITE_OPENROUTER_KEY_KIMI || ""
};
var OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
async function proxyToOpenRouter(body) {
  const { domain, messages, temperature, maxTokens } = body;
  const apiKey = KEY_MAP[domain];
  if (!apiKey) {
    throw new Error(`No API key configured for domain "${domain}"`);
  }
  const route = MODEL_ROUTES[domain];
  if (!route) {
    throw new Error(`Unknown domain "${domain}"`);
  }
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://lyceum.internal",
      "X-Title": "The Lyceum"
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: false
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`OpenRouter (${domain}) returned ${response.status}: ${text}`);
  }
  return response.json();
}
function extractReplyText(completion) {
  const choice = completion?.choices?.[0]?.message?.content;
  return typeof choice === "string" ? choice : JSON.stringify(completion);
}
async function proxyStreamToOpenRouter(body) {
  const { domain, messages, temperature, maxTokens, onHeaders, onChunk, onDone, onError } = body;
  const apiKey = KEY_MAP[domain];
  if (!apiKey) {
    throw new Error(`No API key configured for domain "${domain}"`);
  }
  const route = MODEL_ROUTES[domain];
  if (!route) {
    throw new Error(`Unknown domain "${domain}"`);
  }
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://lyceum.internal",
      "X-Title": "The Lyceum"
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: true
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`OpenRouter stream (${domain}) returned ${response.status}: ${text}`);
  }
  onHeaders({ status: 200 });
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Stream response body is not readable");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          onChunk(line + "\n");
        }
      }
    }
    if (buffer.trim()) {
      onChunk(buffer + "\n");
    }
    onDone();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    onError(error);
  }
}

// server/db/accounts.ts
init_firestore();
import { FieldValue } from "firebase-admin/firestore";
var TIER_CREDITS = {
  vip: 2e3,
  basic: 500
};
var DEFAULT_CREDITS = TIER_CREDITS.basic;
function creditsForProduct(product) {
  if (!product) return DEFAULT_CREDITS;
  const key = Object.keys(TIER_CREDITS).find((k2) => product.toLowerCase().includes(k2));
  return key ? TIER_CREDITS[key] : DEFAULT_CREDITS;
}
var collection = () => getDb().collection("accounts");
async function provisionAccount(params) {
  const ref = collection().doc(params.licenseKey);
  const existing = await ref.get();
  if (existing.exists) {
    await ref.set(
      {
        email: params.email,
        name: params.name,
        organization: params.organization,
        product: params.product
      },
      { merge: true }
    );
    return (await ref.get()).data();
  }
  const credits = creditsForProduct(params.product);
  const account = {
    licenseKey: params.licenseKey,
    email: params.email,
    name: params.name,
    organization: params.organization,
    product: params.product,
    creditsTotal: credits,
    creditsRemaining: credits,
    createdAt: Date.now()
  };
  await ref.set(account);
  return account;
}
async function getAccount(licenseKey) {
  const snap = await collection().doc(licenseKey).get();
  return snap.exists ? snap.data() : null;
}
var InsufficientCreditsError = class extends Error {
  constructor(remaining, requested) {
    super(`Insufficient credits: have ${remaining}, need ${requested}`);
    this.remaining = remaining;
    this.requested = requested;
  }
};
async function deductCredits(licenseKey, amount) {
  const db2 = getDb();
  const ref = collection().doc(licenseKey);
  return db2.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error("Unknown license key");
    }
    const account = snap.data();
    if (account.creditsRemaining < amount) {
      throw new InsufficientCreditsError(account.creditsRemaining, amount);
    }
    const remaining = account.creditsRemaining - amount;
    tx.update(ref, { creditsRemaining: FieldValue.increment(-amount) });
    return remaining;
  });
}

// server/db/workers.ts
init_firestore();
import crypto from "crypto";
var collection2 = () => getDb().collection("workers");
function generateWorkerToken() {
  return `lyw_${crypto.randomBytes(18).toString("base64url")}`;
}
async function createWorker(params) {
  const ref = collection2().doc();
  const worker = {
    id: ref.id,
    licenseKey: params.licenseKey,
    name: params.name,
    role: params.role,
    departmentId: params.departmentId,
    departmentName: params.departmentName,
    model: params.model,
    mcpToken: generateWorkerToken(),
    tokensUsed: 0,
    stepsCompleted: 0,
    lastSeenAt: null,
    createdAt: Date.now()
  };
  await ref.set(worker);
  return worker;
}
async function listWorkers(licenseKey) {
  const snap = await collection2().where("licenseKey", "==", licenseKey).get();
  return snap.docs.map((d) => d.data()).filter((w) => !w.revokedAt).sort((a, b) => b.createdAt - a.createdAt);
}
async function resolveWorkerToken(token) {
  if (!token) return null;
  const snap = await collection2().where("mcpToken", "==", token).get();
  const doc = snap.docs?.[0];
  if (!doc) return null;
  const worker = doc.data();
  if (!worker || worker.revokedAt) return null;
  return worker;
}
async function touchWorker(workerId) {
  await collection2().doc(workerId).set({ lastSeenAt: Date.now() }, { merge: true }).catch(() => {
  });
}
async function recordWorkerUsage(workerId, patch) {
  const ref = collection2().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const current = snap.data();
  await ref.set(
    {
      tokensUsed: current.tokensUsed + (patch.tokens ?? 0),
      stepsCompleted: current.stepsCompleted + (patch.stepsCompleted ?? 0),
      lastSeenAt: Date.now()
    },
    { merge: true }
  );
}
async function revokeWorker(licenseKey, workerId) {
  const ref = collection2().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().licenseKey !== licenseKey) return false;
  await ref.set({ revokedAt: Date.now() }, { merge: true });
  return true;
}
async function rotateWorkerToken(licenseKey, workerId) {
  const ref = collection2().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().licenseKey !== licenseKey) return null;
  const mcpToken = generateWorkerToken();
  await ref.set({ mcpToken }, { merge: true });
  return mcpToken;
}

// server/lib/auth.ts
async function authenticateLicenseKey(req, res, next) {
  const header = req.header("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const licenseKey = match?.[1]?.trim();
  if (!licenseKey) {
    res.status(401).json({ error: "Missing Authorization: Bearer <license key> header" });
    return;
  }
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && licenseKey === adminToken) {
    req.lyceumAccount = {
      licenseKey: adminToken,
      product: "Admin (Beta)",
      creditsTotal: 999999,
      creditsRemaining: 999999,
      createdAt: Date.now()
    };
    next();
    return;
  }
  if (licenseKey.startsWith("lyw_")) {
    const worker = await resolveWorkerToken(licenseKey).catch(() => null);
    if (!worker) {
      res.status(401).json({ error: "Unknown or revoked AI token" });
      return;
    }
    const owner = await getAccount(worker.licenseKey).catch(() => null);
    req.lyceumAccount = owner ?? {
      licenseKey: worker.licenseKey,
      product: "Worker",
      creditsTotal: 0,
      creditsRemaining: 0,
      createdAt: worker.createdAt
    };
    req.lyceumWorker = worker;
    void touchWorker(worker.id);
    next();
    return;
  }
  try {
    const account = await getAccount(licenseKey);
    if (!account) {
      res.status(401).json({ error: "Invalid license key" });
      return;
    }
    req.lyceumAccount = account;
    next();
  } catch {
    res.status(503).json({ error: "Account lookup unavailable \u2014 Firestore may not be configured" });
  }
}

// server/index.ts
init_tasks();

// server/lib/runTask.ts
init_tasks();
init_executionConfig();
var TASK_COST = 10;
async function runTask(params) {
  const { licenseKey, domain, prompt, source, existingTaskId, executionConfig } = params;
  const config = executionConfig ?? DEFAULT_EXECUTION_CONFIG;
  const creditsRemaining = await deductCredits(licenseKey, TASK_COST);
  let existingAttemptCount = 0;
  if (existingTaskId) {
    const { getTask: getTask2 } = await Promise.resolve().then(() => (init_tasks(), tasks_exports));
    const existingTask = await getTask2(existingTaskId, licenseKey);
    existingAttemptCount = existingTask?.attempts.length ?? 0;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const attemptNumber = existingAttemptCount;
  const attempt = {
    attemptNumber,
    status: "running",
    startedAt: now,
    creditsCost: TASK_COST,
    endpoint: `openrouter:${domain}`
  };
  let taskId = existingTaskId ?? "";
  try {
    const completion = await proxyToOpenRouter({
      domain,
      messages: [{ role: "user", content: prompt }]
    });
    const result = extractReplyText(completion);
    attempt.status = "completed";
    attempt.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (existingTaskId) {
      const existing = await updateTaskAttempt(existingTaskId, licenseKey, {
        status: "completed",
        result,
        newAttempts: [attempt]
      });
      taskId = existing?.id ?? existingTaskId;
    } else {
      const task = await recordTask({
        licenseKey,
        domain,
        prompt,
        source,
        status: "completed",
        result,
        creditsCost: TASK_COST,
        attemptCount: attemptNumber,
        maxAttempts: config.maxAttempts,
        attempts: [attempt]
      });
      taskId = task.id;
    }
    return {
      taskId,
      result,
      creditsRemaining,
      creditsCost: TASK_COST,
      attemptCount: attemptNumber,
      needsHumanApproval: false
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task failed";
    const endpoint = `openrouter:${domain}`;
    const errorContext = formatErrorContext(message, endpoint, existingAttemptCount + 1);
    attempt.status = "failed";
    attempt.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    attempt.error = message;
    attempt.errorDetail = err instanceof Error ? err.stack : void 0;
    if (existingTaskId) {
      const existing = await updateTaskAttempt(existingTaskId, licenseKey, {
        status: "failed",
        error: message,
        newAttempts: [attempt]
      });
      if (existing) {
        const totalAttempts = existing.attempts.length;
        if (totalAttempts >= config.maxAttempts) {
          await updateTaskAttempt(existingTaskId, licenseKey, {
            status: "failed",
            error: `Max attempts (${config.maxAttempts}) exhausted. Last error: ${message}`
          });
          throw new MaxAttemptsError(existingTaskId, config.maxAttempts, message);
        }
        const isSubtask = source === "api" && prompt.length < 200;
        if (canAutoRetry(config, existing.attempts, isSubtask)) {
          throw new RetryableError(existingTaskId, message, totalAttempts);
        }
        const approvalRequest = {
          id: `approval-${existingTaskId}-${totalAttempts}`,
          taskId: existingTaskId,
          failedAttemptNumber: totalAttempts,
          errorContext,
          requestedAction: `Retry task "${prompt.slice(0, 80)}\u2026" on ${domain}`,
          requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "pending",
          isSubtask
        };
        await updateTaskAttempt(existingTaskId, licenseKey, {
          status: "awaiting_approval",
          humanApprovalRequest: approvalRequest
        });
        throw new NeedsHumanApprovalError(existingTaskId, message, approvalRequest);
      }
    }
    const task = await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "failed",
      error: message,
      creditsCost: TASK_COST,
      attemptCount: 0,
      maxAttempts: config.maxAttempts,
      attempts: [attempt],
      autoApproveSubtasks: config.autoApproveSubtasks
    });
    taskId = task.id;
    if (config.maxAttempts > 1) {
      const isSubtask = source === "api" && prompt.length < 200;
      const approvalRequest = {
        id: `approval-${task.id}-0`,
        taskId: task.id,
        failedAttemptNumber: 0,
        errorContext,
        requestedAction: `Retry task "${prompt.slice(0, 80)}\u2026" on ${domain}`,
        requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "pending",
        isSubtask
      };
      await updateTaskAttempt(task.id, licenseKey, {
        status: "awaiting_approval",
        humanApprovalRequest: approvalRequest
      });
      throw new NeedsHumanApprovalError(task.id, message, approvalRequest);
    }
    throw err;
  }
}
var MaxAttemptsError = class extends Error {
  constructor(taskId, maxAttempts, lastError) {
    super(`Max attempts (${maxAttempts}) exhausted. Last error: ${lastError}`);
    this.taskId = taskId;
    this.maxAttempts = maxAttempts;
    this.lastError = lastError;
    this.name = "MaxAttemptsError";
  }
};
var RetryableError = class extends Error {
  constructor(taskId, lastError, attemptNumber) {
    super(`Attempt ${attemptNumber} failed: ${lastError}. Retry available.`);
    this.taskId = taskId;
    this.lastError = lastError;
    this.attemptNumber = attemptNumber;
    this.name = "RetryableError";
  }
};
var NeedsHumanApprovalError = class extends Error {
  constructor(taskId, lastError, approvalRequest) {
    super(`Task failed: ${lastError}. Human approval required for retry.`);
    this.taskId = taskId;
    this.lastError = lastError;
    this.approvalRequest = approvalRequest;
    this.name = "NeedsHumanApprovalError";
  }
};

// server/mcp/http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
init_tasks();

// server/db/aiRoles.ts
init_firestore();
import { FieldValue as FieldValue2 } from "firebase-admin/firestore";
var collection4 = () => getDb().collection("aiRoles");
function roleId(licenseKey, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${licenseKey.slice(0, 12)}--${slug}`;
}
async function registerAiRole(params) {
  const id = roleId(params.licenseKey, params.name);
  const ref = collection4().doc(id);
  const existing = await ref.get();
  const now = Date.now();
  if (existing.exists) {
    await ref.set(
      {
        department: params.department,
        purpose: params.purpose,
        client: params.client,
        ...params.tokenBudget !== void 0 ? { tokenBudget: params.tokenBudget } : {},
        lastSeenAt: now
      },
      { merge: true }
    );
    return (await ref.get()).data();
  }
  const role = {
    id,
    licenseKey: params.licenseKey,
    name: params.name,
    department: params.department,
    purpose: params.purpose,
    client: params.client,
    tokensUsed: 0,
    tokenBudget: params.tokenBudget ?? 0,
    createdAt: now,
    lastSeenAt: now
  };
  await ref.set(role);
  return role;
}
async function listAiRoles(licenseKey) {
  const snap = await collection4().where("licenseKey", "==", licenseKey).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
var TokenBudgetExceededError = class extends Error {
  constructor(roleName, used, budget) {
    super(`Role "${roleName}" is over its token budget (${used}/${budget})`);
    this.roleName = roleName;
    this.used = used;
    this.budget = budget;
  }
};
async function reportTokens(licenseKey, name, tokens) {
  const db2 = getDb();
  const ref = collection4().doc(roleId(licenseKey, name));
  return db2.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`No AI role named "${name}" \u2014 register it first.`);
    const role = snap.data();
    if (role.licenseKey !== licenseKey) throw new Error(`No AI role named "${name}".`);
    const next = role.tokensUsed + tokens;
    if (role.tokenBudget > 0 && next > role.tokenBudget) {
      throw new TokenBudgetExceededError(name, role.tokensUsed, role.tokenBudget);
    }
    tx.update(ref, { tokensUsed: FieldValue2.increment(tokens), lastSeenAt: Date.now() });
    return { ...role, tokensUsed: next };
  });
}

// server/db/missions.ts
init_firestore();
var collection5 = () => getDb().collection("missions");
function progressOf(mission) {
  if (mission.steps.length === 0) return 0;
  const done = mission.steps.filter((s) => s.status === "done").length;
  return Math.round(done / mission.steps.length * 100);
}
async function createMission(params) {
  const ref = collection5().doc();
  const now = Date.now();
  const mission = {
    id: ref.id,
    licenseKey: params.licenseKey,
    department: params.department,
    title: params.title,
    goal: params.goal ?? "",
    status: (params.steps?.length ?? 0) > 0 ? "active" : "planning",
    headName: params.headName,
    steps: (params.steps ?? []).map((s, i) => ({
      id: `step-${i + 1}`,
      title: s.title,
      ownerKind: s.ownerKind,
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      status: "todo",
      tokensUsed: 0
    })),
    createdAt: now,
    updatedAt: now
  };
  await ref.set(mission);
  return mission;
}
async function listMissions(licenseKey, department) {
  const snap = await collection5().where("licenseKey", "==", licenseKey).get();
  return snap.docs.map((d) => d.data()).filter((m) => !department || m.department === department).sort((a, b) => b.updatedAt - a.updatedAt);
}
function derivedStatus(steps, current) {
  if (steps.length === 0) return current;
  if (steps.every((s) => s.status === "done")) return "review";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  return current === "planning" ? "active" : current;
}
async function updateStep(params) {
  const db2 = getDb();
  const ref = collection5().doc(params.missionId);
  return db2.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const mission = snap.data();
    if (mission.licenseKey !== params.licenseKey) return null;
    const steps = mission.steps.map(
      (s) => s.id === params.stepId ? {
        ...s,
        status: params.status ?? s.status,
        note: params.note ?? s.note,
        tokensUsed: s.tokensUsed + (params.addTokens ?? 0)
      } : s
    );
    const updated = {
      ...mission,
      steps,
      status: derivedStatus(steps, mission.status),
      updatedAt: Date.now()
    };
    tx.set(ref, updated);
    return updated;
  });
}
async function stepsForWorker(licenseKey, workerId, opts = {}) {
  const missions = await listMissions(licenseKey);
  const out = [];
  for (const mission of missions) {
    for (const step of mission.steps) {
      if (step.ownerKind !== "ai" || step.ownerId !== workerId) continue;
      if (!opts.includeDone && step.status === "done") continue;
      out.push({
        missionId: mission.id,
        missionTitle: mission.title,
        goal: mission.goal,
        department: mission.department,
        stepId: step.id,
        stepTitle: step.title,
        status: step.status,
        tokensUsed: step.tokensUsed,
        note: step.note
      });
    }
  }
  return out;
}

// server/mcp/http-server.ts
function buildServer(account, worker) {
  const server = new McpServer({ name: "the-lyceum", version: "1.0.0" });
  if (worker) {
    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description: "Identify yourself in this workspace: your name, the department you serve, and what you have done so far."
      },
      async () => ({
        content: [
          {
            type: "text",
            text: `You are "${worker.name}" \u2014 ${worker.role}
Department: ${worker.departmentName}
Model on file: ${worker.model}
Steps completed: ${worker.stepsCompleted} \xB7 Tokens reported: ${worker.tokensUsed.toLocaleString()}

Use my_steps to see what is waiting for you.`
          }
        ]
      })
    );
    server.registerTool(
      "my_steps",
      {
        title: "My assigned work",
        description: "List the steps assigned to you that still need doing, with the task and goal each belongs to. Start here.",
        inputSchema: {
          includeDone: z.boolean().optional().describe("Also show steps you already finished")
        }
      },
      async ({ includeDone }) => {
        const steps = await stepsForWorker(account.licenseKey, worker.id, { includeDone });
        if (steps.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Nothing is assigned to you right now."
              }
            ]
          };
        }
        const lines = steps.map(
          (s) => `\u2022 [${s.status}] ${s.stepTitle}
    task: ${s.missionTitle}${s.goal ? ` \u2014 ${s.goal}` : ""}
    department: ${s.department}
    ids: mission=${s.missionId} step=${s.stepId}` + (s.note ? `
    last note: ${s.note}` : "")
        );
        return {
          content: [
            {
              type: "text",
              text: `${steps.length} step(s) assigned to you:

${lines.join("\n\n")}`
            }
          ]
        };
      }
    );
    server.registerTool(
      "start_step",
      {
        title: "Start a step",
        description: "Mark one of your steps as in progress, so the team can see you picked it up before you spend anything on it.",
        inputSchema: {
          missionId: z.string().min(1),
          stepId: z.string().min(1)
        }
      },
      async ({ missionId, stepId }) => {
        const mine = await stepsForWorker(account.licenseKey, worker.id, { includeDone: true });
        if (!mine.some((s) => s.missionId === missionId && s.stepId === stepId)) {
          return {
            isError: true,
            content: [{ type: "text", text: "That step is not assigned to you." }]
          };
        }
        const updated = await updateStep({
          licenseKey: account.licenseKey,
          missionId,
          stepId,
          status: "doing"
        });
        return {
          content: [
            {
              type: "text",
              text: updated ? `Started. "${updated.title}" is now ${progressOf(updated)}%.` : "Task not found."
            }
          ]
        };
      }
    );
    server.registerTool(
      "complete_step",
      {
        title: "Finish a step",
        description: "Report a step as done (or stuck), with a plain-language note of what you produced and the tokens it cost. The team sees this immediately.",
        inputSchema: {
          missionId: z.string().min(1),
          stepId: z.string().min(1),
          note: z.string().min(1).describe("What you did or produced \u2014 a human reads this"),
          tokens: z.number().int().nonnegative().optional(),
          blocked: z.boolean().optional().describe("Set true if you could not finish and need a human")
        }
      },
      async (args) => {
        const mine = await stepsForWorker(account.licenseKey, worker.id, { includeDone: true });
        if (!mine.some((s) => s.missionId === args.missionId && s.stepId === args.stepId)) {
          return {
            isError: true,
            content: [{ type: "text", text: "That step is not assigned to you." }]
          };
        }
        const updated = await updateStep({
          licenseKey: account.licenseKey,
          missionId: args.missionId,
          stepId: args.stepId,
          status: args.blocked ? "blocked" : "done",
          note: args.note,
          addTokens: args.tokens
        });
        await recordWorkerUsage(worker.id, {
          tokens: args.tokens ?? 0,
          stepsCompleted: args.blocked ? 0 : 1
        }).catch(() => {
        });
        return {
          content: [
            {
              type: "text",
              text: updated ? `${args.blocked ? "Flagged as stuck" : "Done"}. "${updated.title}" is now ${progressOf(updated)}% (${updated.status}).` : "Task not found."
            }
          ]
        };
      }
    );
  }
  server.registerTool(
    "check_quota",
    {
      title: "Check quota",
      description: "Get remaining and total credits for this Lyceum account, and the cost per task."
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            creditsRemaining: account.creditsRemaining,
            creditsTotal: account.creditsTotal,
            costPerTask: TASK_COST,
            product: account.product,
            organization: account.organization
          })
        }
      ]
    })
  );
  server.registerTool(
    "assign_task",
    {
      title: "Assign task",
      description: "Assign a task or question to one of the Lyceum AI domains (LAW, FINANCE, TECH, MUSE) and get the result back synchronously. Deducts credits from your account.",
      inputSchema: {
        domain: z.enum(DOMAINS).describe("Which Lyceum AI domain should handle this task: LAW, FINANCE, TECH, or MUSE"),
        prompt: z.string().min(1).describe("The task or question to send to the AI")
      }
    },
    async ({ domain, prompt }) => {
      let lastResult = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await runTask({
            licenseKey: account.licenseKey,
            domain,
            prompt,
            source: "mcp",
            existingTaskId: lastResult?.taskId
          });
          lastResult = result;
          break;
        } catch (err) {
          if (err instanceof RetryableError) {
            continue;
          }
          return handleTaskError(err);
        }
      }
      if (!lastResult) {
        return {
          isError: true,
          content: [{ type: "text", text: "Task failed after 2 attempts. Please try again later." }]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${lastResult.result}

[task ${lastResult.taskId} \xB7 ${lastResult.creditsCost} credits used \xB7 ${lastResult.creditsRemaining} remaining]`
          }
        ]
      };
    }
  );
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: "List your most recent tasks and their status.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().describe("Max tasks to return (default 20)")
      }
    },
    async ({ limit }) => {
      const tasks = await listTasks(account.licenseKey, limit ?? 20);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              tasks.map((t) => ({
                id: t.id,
                domain: t.domain,
                status: t.status,
                prompt: t.prompt.length > 120 ? `${t.prompt.slice(0, 120)}\u2026` : t.prompt,
                createdAt: new Date(t.createdAt).toISOString()
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );
  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description: "Get the full result / deliverable for a specific task by its ID (from list_tasks or assign_task).",
      inputSchema: {
        taskId: z.string().min(1)
      }
    },
    async ({ taskId }) => {
      const task = await getTask(taskId, account.licenseKey);
      if (!task) {
        return { isError: true, content: [{ type: "text", text: "Task not found." }] };
      }
      return {
        content: [
          {
            type: "text",
            text: task.status === "completed" ? task.result ?? "" : `Task failed: ${task.error}`
          }
        ]
      };
    }
  );
  server.registerTool(
    "register_role",
    {
      title: "Register my role",
      description: "Declare which role you (the connected AI) are filling and which department you serve. Call this first \u2014 token reporting and mission updates are attributed to this role. Calling it again with the same name updates the description without losing usage history.",
      inputSchema: {
        name: z.string().min(1).describe('Your role name, e.g. "Newsletter Copywriter"'),
        department: z.string().min(1).describe('Department tag you serve, e.g. "marketing" or "coding"'),
        purpose: z.string().min(1).describe("One line on what you do \u2014 humans will read this"),
        client: z.string().optional().describe('Which app you are, e.g. "Claude Desktop"'),
        tokenBudget: z.number().int().nonnegative().optional().describe("Optional cap on your own token spend; 0 or omitted = no cap")
      }
    },
    async (args) => {
      const role = await registerAiRole({ licenseKey: account.licenseKey, ...args });
      return {
        content: [
          {
            type: "text",
            text: `Registered as "${role.name}" in ${role.department}.
Tokens used so far: ${role.tokensUsed.toLocaleString()}` + (role.tokenBudget > 0 ? ` of ${role.tokenBudget.toLocaleString()}` : " (no cap)")
          }
        ]
      };
    }
  );
  server.registerTool(
    "list_roles",
    {
      title: "List AI roles",
      description: "List every AI role registered on this account, with the department each serves and how many tokens it has used. This is the token report for the whole workspace."
    },
    async () => {
      const roles = await listAiRoles(account.licenseKey);
      if (roles.length === 0) {
        return {
          content: [
            { type: "text", text: "No AI roles registered yet. Use register_role first." }
          ]
        };
      }
      const total = roles.reduce((sum, r) => sum + r.tokensUsed, 0);
      const lines = roles.map(
        (r) => `\u2022 ${r.name} \u2014 ${r.department} \u2014 ${r.tokensUsed.toLocaleString()} tokens` + (r.tokenBudget > 0 ? ` / ${r.tokenBudget.toLocaleString()} budget` : "") + (r.client ? ` (${r.client})` : "")
      );
      return {
        content: [
          {
            type: "text",
            text: `${roles.length} role(s), ${total.toLocaleString()} tokens total:

${lines.join("\n")}`
          }
        ]
      };
    }
  );
  server.registerTool(
    "report_tokens",
    {
      title: "Report token usage",
      description: "Report tokens you have just consumed, so the workspace can track spend per AI role. Rejected if it would take the role past its own budget.",
      inputSchema: {
        roleName: z.string().min(1).describe("The role name you registered"),
        tokens: z.number().int().positive().describe("Tokens consumed since your last report")
      }
    },
    async ({ roleName, tokens }) => {
      try {
        const role = await reportTokens(account.licenseKey, roleName, tokens);
        const pct = role.tokenBudget > 0 ? ` (${Math.round(role.tokensUsed / role.tokenBudget * 100)}% of budget)` : "";
        return {
          content: [
            {
              type: "text",
              text: `Recorded ${tokens.toLocaleString()} tokens for "${role.name}". Total: ${role.tokensUsed.toLocaleString()}${pct}`
            }
          ]
        };
      } catch (err) {
        if (err instanceof TokenBudgetExceededError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `\u26D4 Token budget reached for "${err.roleName}" (${err.used.toLocaleString()}/${err.budget.toLocaleString()}). Ask the department head to raise it in the Lyceum workspace.`
              }
            ]
          };
        }
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "Failed" }]
        };
      }
    }
  );
  server.registerTool(
    "list_missions",
    {
      title: "List missions",
      description: "See the missions the team is running, with plain progress percentages. Optionally filter to one department.",
      inputSchema: {
        department: z.string().optional().describe('e.g. "marketing" \u2014 omit for all departments')
      }
    },
    async ({ department }) => {
      const missions = await listMissions(account.licenseKey, department);
      if (missions.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: department ? `No missions in ${department} yet.` : "No missions yet. Create one with create_mission."
            }
          ]
        };
      }
      const lines = missions.map((m) => {
        const steps = m.steps.map((s) => `    - [${s.status}] ${s.title} \u2014 ${s.ownerName} (${s.ownerKind})`).join("\n");
        return `\u2022 ${m.title} \u2014 ${m.department} \u2014 ${progressOf(m)}% \u2014 ${m.status}
  head: ${m.headName}
  id: ${m.id}
${steps}`;
      });
      return { content: [{ type: "text", text: lines.join("\n\n") }] };
    }
  );
  server.registerTool(
    "create_mission",
    {
      title: "Create a mission",
      description: "Create a mission (a piece of work broken into steps) in a department, so the whole team can see it and track progress.",
      inputSchema: {
        department: z.string().min(1).describe('Department tag, e.g. "marketing"'),
        title: z.string().min(1).describe("What needs to happen"),
        goal: z.string().optional().describe("Why it matters"),
        headName: z.string().min(1).describe("The person accountable for the decision"),
        steps: z.array(
          z.object({
            title: z.string().min(1),
            ownerKind: z.enum(["human", "ai"]),
            ownerName: z.string().min(1)
          })
        ).optional().describe("The steps, each owned by a person or an AI")
      }
    },
    async (args) => {
      const mission = await createMission({ licenseKey: account.licenseKey, ...args });
      return {
        content: [
          {
            type: "text",
            text: `Created "${mission.title}" in ${mission.department} with ${mission.steps.length} step(s).
id: ${mission.id}`
          }
        ]
      };
    }
  );
  server.registerTool(
    "update_mission_step",
    {
      title: "Update a mission step",
      description: "Move a step forward, leave a plain-language note on it, and optionally attribute tokens to it. The mission's own status is recalculated from its steps.",
      inputSchema: {
        missionId: z.string().min(1).describe("From list_missions"),
        stepId: z.string().min(1).describe('From list_missions, e.g. "step-1"'),
        status: z.enum(["todo", "doing", "done", "blocked"]).optional(),
        note: z.string().optional().describe("What happened \u2014 humans read this"),
        tokens: z.number().int().nonnegative().optional().describe("Tokens spent on this step")
      }
    },
    async (args) => {
      const mission = await updateStep({
        licenseKey: account.licenseKey,
        missionId: args.missionId,
        stepId: args.stepId,
        status: args.status,
        note: args.note,
        addTokens: args.tokens
      });
      if (!mission) {
        return { isError: true, content: [{ type: "text", text: "Mission not found." }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Updated. "${mission.title}" is now ${progressOf(mission)}% (${mission.status}).`
          }
        ]
      };
    }
  );
  return server;
}
function handleTaskError(err) {
  if (err instanceof InsufficientCreditsError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Insufficient credits: ${err.remaining} remaining, ${err.requested} needed for this task.`
        }
      ]
    };
  }
  if (err instanceof NeedsHumanApprovalError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `\u26A0\uFE0F Human approval required

${err.approvalRequest.errorContext}

Request: ${err.approvalRequest.requestedAction}
Submit retry approval via the Lyceum workspace.

[task ${err.taskId}]`
        }
      ]
    };
  }
  if (err instanceof MaxAttemptsError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `\u26D4 Max attempts exhausted (${err.maxAttempts}).

Last error: ${err.lastError}

[task ${err.taskId}]`
        }
      ]
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: err instanceof Error ? err.message : "Task failed" }]
  };
}
async function handleMcpRequest(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed \u2014 this is a stateless MCP endpoint (POST only)" });
    return;
  }
  const account = req.lyceumAccount;
  if (!account) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  const server = buildServer(account, req.lyceumWorker);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: void 0 });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// server/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
var client = null;
function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured \u2014 set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).");
  }
  client = createClient(url, key);
  return client;
}

// server/proxy/llmProxy.ts
import crypto2 from "crypto";
import express from "express";

// server/lib/breakerStore.ts
var MemoryBreakerStore = class {
  counters = /* @__PURE__ */ new Map();
  windows = /* @__PURE__ */ new Map();
  lastSweep = 0;
  /** Drop expired entries occasionally so a long-lived process can't leak. */
  sweep(now) {
    if (now - this.lastSweep < 3e4) return;
    this.lastSweep = now;
    for (const [k2, c] of Array.from(this.counters.entries())) {
      if (c.expiresAt <= now) this.counters.delete(k2);
    }
    for (const [k2, times] of Array.from(this.windows.entries())) {
      if (times.length === 0 || now - times[times.length - 1] > 36e5) {
        this.windows.delete(k2);
      }
    }
  }
  async incr(key, by, ttlMs) {
    const now = Date.now();
    this.sweep(now);
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, { value: by, expiresAt: now + ttlMs });
      return by;
    }
    existing.value += by;
    return existing.value;
  }
  async get(key) {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) return 0;
    return existing.value;
  }
  async pushWindow(key, at, windowMs) {
    this.sweep(at);
    const times = this.windows.get(key) ?? [];
    times.push(at);
    const cutoff = at - windowMs;
    let i = 0;
    while (i < times.length && times[i] < cutoff) i++;
    const trimmed = i > 0 ? times.slice(i) : times;
    this.windows.set(key, trimmed);
    return trimmed.length;
  }
  async countWindow(key, now, windowMs) {
    const times = this.windows.get(key);
    if (!times) return 0;
    const cutoff = now - windowMs;
    let count = 0;
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < cutoff) break;
      count++;
    }
    return count;
  }
  async resetSession(sessionId) {
    const prefix = `${sessionId}:`;
    for (const k2 of Array.from(this.counters.keys())) {
      if (k2.startsWith(prefix)) this.counters.delete(k2);
    }
    for (const k2 of Array.from(this.windows.keys())) {
      if (k2.startsWith(prefix)) this.windows.delete(k2);
    }
  }
};
var memoryStore = new MemoryBreakerStore();

// server/lib/circuitBreaker.ts
var DEFAULT_POLICY = {
  maxCentsPerSession: 500,
  // $5.00
  maxToolCalls: 50,
  maxTokensPerMinute: 12e4,
  maxCallsPerMinute: 120,
  loopThreshold: 5,
  loopWindowMs: 6e4
};
var DENY_RULES = [
  {
    code: "RESTRICTED_PAYLOAD",
    name: "recursive_filesystem_delete",
    // rm with a recursive+force flag pair aimed at a root-ish path.
    //
    // The target must be `/`, `~` or `$HOME` *terminated* by a delimiter, which
    // is what separates `rm -rf /` from the perfectly ordinary
    // `rm -rf ./build/tmp` or `rm -rf /tmp/cache`. The delimiter set includes
    // quotes and shell separators so the command is still caught when it is
    // nested inside JSON tool arguments — e.g. {"cmd":"rm -rf /"} — which is
    // how an agent actually emits it.
    pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR]|-r\s+-f|-f\s+-r)\s+(?:\/|~|\$HOME)(?=[\s"'`;&|)*\\]|$)/,
    reason: "Tried to recursively delete a root or home directory."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "disk_overwrite",
    pattern: /\b(mkfs(\.\w+)?\s|dd\s+[^\n]*\bof=\/dev\/(sd|nvme|disk|hd)|>\s*\/dev\/(sd|nvme|disk|hd))/,
    reason: "Tried to format or overwrite a raw disk device."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "fork_bomb",
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "Payload contains a fork bomb."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "pipe_to_shell",
    // curl/wget piped straight into a shell — the classic remote-exec pattern.
    pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/,
    reason: "Tried to download and execute a remote script."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "destructive_sql",
    pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*(;|$))/i,
    reason: "Tried to drop, truncate, or unconditionally delete database rows."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "credential_exfiltration",
    // Reading a known secret store and sending it somewhere in one breath.
    pattern: /(\.ssh\/id_[a-z0-9_]+|\.aws\/credentials|\.env(\.\w+)?|id_rsa)\b[^\n]{0,120}\b(curl|wget|nc|netcat|http:\/\/|https:\/\/)/i,
    reason: "Tried to read credentials and send them to a remote host."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "history_rewrite_force_push",
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f)\b[^\n]*\b(main|master|production)\b|\bgit\s+reset\s+--hard\b[^\n]*\borigin\//,
    reason: "Tried to force-push over a protected branch or hard-reset to remote."
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "permission_wideopen",
    pattern: /\bchmod\s+(-R\s+)?0?777\s+(\/\s*$|\/\s|\/etc|\/usr|\/var)/,
    reason: "Tried to make a system directory world-writable."
  }
];
function extractText(payload) {
  const out = [];
  const walk = (v, depth) => {
    if (depth > 8 || out.length > 400) return;
    if (typeof v === "string") {
      out.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (v && typeof v === "object") {
      for (const val of Object.values(v)) walk(val, depth + 1);
    }
  };
  walk(payload, 0);
  return out.join("\n");
}
function staticScan(payload, extra = []) {
  const text = extractText(payload);
  if (!text) return null;
  for (const rule of DENY_RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      return {
        rule: rule.name,
        code: rule.code,
        reason: rule.reason,
        excerpt: redact(m[0])
      };
    }
  }
  for (const rule of extra) {
    const m = rule.pattern.exec(text);
    if (m) {
      return {
        rule: rule.code,
        code: "RESTRICTED_PAYLOAD",
        reason: rule.reason,
        excerpt: redact(m[0])
      };
    }
  }
  return null;
}
function redact(s) {
  return s.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "$1-***REDACTED***").replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***REDACTED***").replace(/\bAKIA[0-9A-Z]{12,}/g, "AKIA***REDACTED***").replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "***REDACTED KEY***").slice(0, 200);
}
var MODEL_PRICES = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1e3 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
  "claude-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-opus": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-haiku": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "gemini-2.5-flash": { inputCentsPerMTok: 30, outputCentsPerMTok: 250 }
};
var FALLBACK_PRICE = { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 };
function priceFor(model) {
  const key = Object.keys(MODEL_PRICES).find((k2) => model.toLowerCase().includes(k2));
  return key ? MODEL_PRICES[key] : FALLBACK_PRICE;
}
function costInCents(model, inputTokens, outputTokens) {
  const p = priceFor(model);
  return inputTokens / 1e6 * p.inputCentsPerMTok + outputTokens / 1e6 * p.outputCentsPerMTok;
}
function estimateTokens(payload) {
  return Math.ceil(extractText(payload).length / 4);
}
var k = {
  spend: (c) => `${c.sessionId}:spend`,
  tools: (c) => `${c.sessionId}:tools`,
  tokens: (c) => `${c.sessionId}:tokens`,
  calls: (c) => `${c.sessionId}:calls`,
  loop: (c, hash) => `${c.sessionId}:loop:${hash}`
};
function payloadFingerprint(payload) {
  const text = extractText(payload);
  let h1 = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 16777619);
  }
  return (h1 >>> 0).toString(36) + ":" + text.length.toString(36);
}
var SESSION_TTL_MS = 24 * 60 * 60 * 1e3;
function createCircuitBreaker(opts = {}) {
  const store = opts.store ?? memoryStore;
  async function snapshot(sessionId) {
    const now = Date.now();
    const fake = { sessionId };
    const [spend, tools, granted] = await Promise.all([
      store.get(k.spend(fake)),
      store.get(k.tools(fake)),
      store.get(`${sessionId}:granted`)
    ]);
    return {
      spentCents: spend / 100,
      // stored as hundredths of a cent for precision
      toolCalls: tools,
      tokensLastMinute: await store.countWindow(k.tokens(fake), now, 6e4),
      callsLastMinute: await store.countWindow(k.calls(fake), now, 6e4),
      ...granted ? {} : {}
    };
  }
  return {
    async checkBefore(ctx, override = {}) {
      const startedAt = performance.now();
      const policy = { ...DEFAULT_POLICY, ...override };
      const now = ctx.now ?? Date.now();
      const finding = staticScan(ctx.payload, policy.extraDenyPatterns);
      if (finding) {
        return {
          allowed: false,
          breach: {
            code: finding.code,
            reason: finding.reason,
            observed: finding.excerpt,
            limit: `rule:${finding.rule}`,
            // A human raising a budget cannot make `rm -rf /` acceptable.
            recoverable: false
          },
          state: await snapshot(ctx.sessionId),
          evaluatedInMs: performance.now() - startedAt
        };
      }
      if (ctx.mcpServer && policy.allowedMcpServers && policy.allowedMcpServers.length > 0) {
        if (!policy.allowedMcpServers.includes(ctx.mcpServer)) {
          return {
            allowed: false,
            breach: {
              code: "UNAUTHORIZED_MCP",
              reason: `This agent is not allowed to reach the MCP server "${ctx.mcpServer}".`,
              observed: ctx.mcpServer,
              limit: policy.allowedMcpServers.join(", "),
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      const spentHundredths = await store.get(k.spend(ctx));
      const grantedExtra = await store.get(`${ctx.sessionId}:granted`);
      const ceilingCents = policy.maxCentsPerSession + grantedExtra / 100;
      const spentCents = spentHundredths / 100;
      if (policy.maxCentsPerSession > 0) {
        const estimateCents = costInCents(ctx.model, estimateTokens(ctx.payload), 0);
        if (spentCents + estimateCents > ceilingCents) {
          return {
            allowed: false,
            breach: {
              code: "BUDGET_EXCEEDED",
              reason: `This task has spent $${spentCents.toFixed(2)} of its $${ceilingCents.toFixed(2)} limit.`,
              observed: Number(spentCents.toFixed(4)),
              limit: Number(ceilingCents.toFixed(4)),
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      if (policy.maxToolCalls > 0 && ctx.isToolCall) {
        const used = await store.get(k.tools(ctx));
        if (used >= policy.maxToolCalls) {
          return {
            allowed: false,
            breach: {
              code: "TOOL_CALL_LIMIT",
              reason: `This task has already run ${used} tool calls, its limit is ${policy.maxToolCalls}.`,
              observed: used,
              limit: policy.maxToolCalls,
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      if (policy.maxCallsPerMinute > 0) {
        const inWindow = await store.countWindow(k.calls(ctx), now, 6e4);
        if (inWindow >= policy.maxCallsPerMinute) {
          return {
            allowed: false,
            breach: {
              code: "CALL_RATE",
              reason: `This agent is calling too fast \u2014 ${inWindow} calls in the last minute.`,
              observed: inWindow,
              limit: policy.maxCallsPerMinute,
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      if (policy.maxTokensPerMinute > 0) {
        const tokensInWindow = await store.countWindow(k.tokens(ctx), now, 6e4);
        if (tokensInWindow >= policy.maxTokensPerMinute) {
          return {
            allowed: false,
            breach: {
              code: "TOKEN_VELOCITY",
              reason: `This agent burned ${tokensInWindow.toLocaleString()} tokens in the last minute.`,
              observed: tokensInWindow,
              limit: policy.maxTokensPerMinute,
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      if (policy.loopThreshold > 0) {
        const fp = payloadFingerprint(ctx.payload);
        const repeats = await store.pushWindow(k.loop(ctx, fp), now, policy.loopWindowMs);
        if (repeats > policy.loopThreshold) {
          return {
            allowed: false,
            breach: {
              code: "LOOP_DETECTED",
              reason: `The same request repeated ${repeats} times in ${Math.round(policy.loopWindowMs / 1e3)}s \u2014 the agent looks stuck.`,
              observed: repeats,
              limit: policy.loopThreshold,
              recoverable: true
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt
          };
        }
      }
      await store.pushWindow(k.calls(ctx), now, 6e4);
      if (ctx.isToolCall) await store.incr(k.tools(ctx), 1, SESSION_TTL_MS);
      return {
        allowed: true,
        state: await snapshot(ctx.sessionId),
        evaluatedInMs: performance.now() - startedAt
      };
    },
    async recordAfter(ctx, usage) {
      const now = ctx.now ?? Date.now();
      const cents = costInCents(ctx.model, usage.inputTokens, usage.outputTokens);
      const totalHundredths = await store.incr(
        k.spend(ctx),
        Math.round(cents * 100),
        SESSION_TTL_MS
      );
      const total = usage.inputTokens + usage.outputTokens;
      const marks = Math.max(1, Math.round(total / 1e3));
      for (let i = 0; i < marks; i++) {
        await store.pushWindow(k.tokens(ctx), now, 6e4);
      }
      return { spentCents: totalHundredths / 100 };
    },
    async raiseBudget(sessionId, extraCents) {
      await memoryStoreSafeIncr(store, `${sessionId}:granted`, Math.round(extraCents * 100));
    },
    async resetSession(sessionId) {
      await store.resetSession(sessionId);
    },
    snapshot
  };
}
async function memoryStoreSafeIncr(store, key, by) {
  await store.incr(key, by, SESSION_TTL_MS);
}
var breaker = createCircuitBreaker();
function breachToErrorBody(breach, state, sessionId) {
  return {
    error: {
      // OpenAI-compatible envelope so existing SDK error handling still works.
      message: `[Lyceum] ${breach.reason}`,
      type: "lyceum_circuit_breaker",
      code: breach.code,
      param: null
    },
    lyceum: {
      halted: true,
      sessionId,
      breach,
      state,
      /** Told plainly so an agent author knows retrying is pointless. */
      retryable: false,
      humanActionRequired: breach.recoverable,
      docs: "https://www.thelyceum.site/docs/circuit-breaker"
    }
  };
}
function breachToStatus(code) {
  switch (code) {
    case "RESTRICTED_PAYLOAD":
    case "UNAUTHORIZED_MCP":
      return 403;
    case "BUDGET_EXCEEDED":
      return 402;
    // Payment Required — distinguishes money from rate limiting.
    default:
      return 429;
  }
}

// server/db/evidenceGraph.ts
init_firestore();
var nodes = () => getDb().collection("evidenceNodes");
var edges = () => getDb().collection("evidenceEdges");
function coordinatesFor(sessionId, depth, kind, actorKind) {
  let h = 2166136261;
  const seed = `${sessionId}:${depth}:${kind}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const spread = (h >>> 0) % 1e3 / 1e3;
  return {
    x: Math.round((spread * 800 - 400) * 100) / 100,
    y: depth * 120,
    z: actorKind === "human" ? 200 : actorKind === "system" ? 100 : 0
  };
}
function safePayload(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/^(authorization|api[-_]?key|secret|token|password|cookie)$/i.test(key)) {
      out[key] = "***REDACTED***";
      continue;
    }
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}
async function writeNode(input) {
  const parents = input.causedBy ?? [];
  let depth = 0;
  if (parents.length > 0) {
    const snaps = await Promise.all(parents.map((p) => nodes().doc(p.nodeId).get()));
    for (const s of snaps) {
      const parent = s.exists ? s.data() : void 0;
      if (parent) depth = Math.max(depth, parent.causalDepth + 1);
    }
  }
  const ref = nodes().doc();
  const node = {
    id: ref.id,
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: input.kind,
    occurredAt: Date.now(),
    actorKind: input.actorKind,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    summary: redact(input.summary),
    costCents: input.costCents ?? 0,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    model: input.model,
    upstream: input.upstream,
    breachCode: input.breachCode,
    evaluatedInMs: input.evaluatedInMs,
    payload: safePayload(input.payload ?? {}),
    pos: coordinatesFor(input.sessionId, depth, input.kind, input.actorKind),
    causalDepth: depth
  };
  await ref.set(stripUndefined(node));
  await Promise.all(
    parents.map((p, i) => {
      const eRef = edges().doc();
      const edge = {
        id: eRef.id,
        licenseKey: input.licenseKey,
        fromNode: p.nodeId,
        toNode: ref.id,
        kind: p.kind ?? "caused",
        createdAt: Date.now(),
        sequence: i,
        rationale: p.rationale
      };
      return eRef.set(stripUndefined(edge));
    })
  );
  return node;
}
function stripUndefined(obj) {
  const out = {};
  for (const [k2, v] of Object.entries(obj)) if (v !== void 0) out[k2] = v;
  return out;
}
async function recordProxyCall(input) {
  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "proxy_call",
    actorKind: "ai",
    actorId: input.model,
    actorLabel: input.model,
    summary: `${input.model} via ${input.upstream} \u2192 ${input.status}`,
    // Cost of this single call: total-after minus what it was before is not
    // available here, so we price the call from its own usage in the breaker
    // and store the running total in the payload for reconciliation.
    costCents: 0,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    model: input.model,
    upstream: input.upstream,
    evaluatedInMs: input.evaluatedInMs,
    payload: {
      status: input.status,
      keyFingerprint: input.keyFingerprint,
      sessionSpentCents: input.spentCentsAfter,
      latencyMs: Math.round(input.latencyMs),
      streamed: !!input.streamed,
      request: input.redactedRequest
    },
    causedBy: input.causedBy ? [{ nodeId: input.causedBy }] : void 0
  });
}
async function recordBreach(input) {
  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "breach",
    actorKind: "system",
    actorId: "circuit_breaker",
    actorLabel: "Circuit breaker",
    summary: input.breach.reason,
    breachCode: input.breach.code,
    model: input.model,
    evaluatedInMs: input.evaluatedInMs,
    payload: {
      observed: input.breach.observed,
      limit: input.breach.limit,
      recoverable: input.breach.recoverable,
      state: input.state,
      excerpt: input.redactedExcerpt
    },
    causedBy: input.causedBy ? [{ nodeId: input.causedBy, kind: "blocked_by" }] : void 0
  });
}
async function recordHumanApproval(input) {
  const verb = input.decision === "approve" ? `approved +$${((input.grantedCents ?? 0) / 100).toFixed(2)}` : input.decision === "abort" ? "aborted the task" : "changed the limits";
  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "human_approval",
    actorKind: "human",
    actorId: input.memberId,
    actorLabel: input.memberName,
    summary: `${input.memberName} ${verb}`,
    payload: {
      decision: input.decision,
      note: input.note ?? "",
      grantedCents: input.grantedCents ?? 0,
      newLimits: input.newLimits ?? {}
    },
    causedBy: [
      {
        nodeId: input.breachNodeId,
        kind: input.decision === "abort" ? "rejected_by" : "approved_by",
        rationale: input.note
      }
    ]
  });
}
async function lineage(licenseKey, nodeId, maxDepth = 50) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let frontier = [{ id: nodeId }];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const snaps = await Promise.all(frontier.map((f) => nodes().doc(f.id).get()));
    const next = [];
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (!snap.exists) continue;
      const node = snap.data();
      if (node.licenseKey !== licenseKey || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ depth, node, via: frontier[i].via });
      const parentEdges = await edges().where("toNode", "==", node.id).get();
      for (const e of parentEdges.docs) {
        const edge = e.data();
        if (!seen.has(edge.fromNode)) next.push({ id: edge.fromNode, via: edge.kind });
      }
    }
    frontier = next;
  }
  return out;
}
async function sessionSummary(licenseKey, sessionId) {
  const snap = await nodes().where("licenseKey", "==", licenseKey).where("sessionId", "==", sessionId).get();
  const all = snap.docs.map((d) => d.data());
  const spent = all.reduce(
    (max, n) => Math.max(max, Number(n.payload?.sessionSpentCents ?? 0)),
    0
  );
  return {
    sessionId,
    nodeCount: all.length,
    totalTokens: all.reduce((s, n) => s + n.inputTokens + n.outputTokens, 0),
    spentCents: spent,
    breachCount: all.filter((n) => n.kind === "breach").length,
    humanDecisionCount: all.filter((n) => n.kind === "human_approval").length,
    deepestCausalChain: all.reduce((m, n) => Math.max(m, n.causalDepth), 0),
    startedAt: all.reduce((m, n) => Math.min(m, n.occurredAt), Date.now()),
    lastActivityAt: all.reduce((m, n) => Math.max(m, n.occurredAt), 0)
  };
}
async function pendingBreaches(licenseKey, limit = 20) {
  const snap = await nodes().where("licenseKey", "==", licenseKey).where("kind", "==", "breach").get();
  const breaches = snap.docs.map((d) => d.data()).filter((n) => n.payload?.recoverable === true).sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  const answered = /* @__PURE__ */ new Set();
  for (const b of breaches) {
    const es = await edges().where("fromNode", "==", b.id).get();
    if (es.docs.some((e) => ["approved_by", "rejected_by"].includes(e.data().kind))) {
      answered.add(b.id);
    }
  }
  return breaches.filter((b) => !answered.has(b.id));
}

// server/proxy/llmProxy.ts
var UPSTREAMS = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api",
  google: "https://generativelanguage.googleapis.com"
};
function inferUpstream(model, fallback) {
  if (!model) return fallback;
  const m = model.toLowerCase();
  if (m.startsWith("claude") || m.includes("anthropic")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.includes("/")) return "openrouter";
  return fallback;
}
function fingerprintKey(authHeader) {
  if (!authHeader) return "none";
  const salt = process.env.LYCEUM_FINGERPRINT_SALT ?? "";
  if (!salt) {
    return "unsalted";
  }
  return crypto2.createHash("sha256").update(salt).update(authHeader).digest("hex").slice(0, 8);
}
function resolveSessionId(req, tenant, body) {
  const header = req.header("x-lyceum-session");
  if (header) return `${tenant.token}:${header}`;
  const user = typeof body.user === "string" ? body.user : void 0;
  if (user) return `${tenant.token}:user:${user}`;
  return `${tenant.token}:default:${fingerprintKey(req.header("authorization"))}`;
}
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "content-length"
]);
var LYCEUM_HEADERS = /* @__PURE__ */ new Set(["x-lyceum-key", "x-lyceum-session"]);
function forwardableHeaders(req) {
  const out = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || LYCEUM_HEADERS.has(lower)) continue;
    if (typeof value === "string") out[name] = value;
    else if (Array.isArray(value)) out[name] = value.join(", ");
  }
  return out;
}
function createProxyRouter(opts) {
  const router = express.Router();
  const doFetch = opts.fetchImpl ?? fetch;
  const rawJson = express.raw({ type: () => true, limit: "20mb" });
  const handler = async (req, res) => {
    const startedAt = performance.now();
    const token = req.params.token ?? req.header("x-lyceum-key");
    if (!token) {
      res.status(401).json({
        error: {
          message: "[Lyceum] Missing proxy token. Point your baseURL at https://proxy.thelyceum.ai/t/<your-token>/v1",
          type: "lyceum_config",
          code: "MISSING_PROXY_TOKEN"
        }
      });
      return;
    }
    const tenant = await opts.resolveTenant(token);
    if (!tenant) {
      res.status(401).json({
        error: {
          message: "[Lyceum] Unknown proxy token.",
          type: "lyceum_config",
          code: "UNKNOWN_PROXY_TOKEN"
        }
      });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = req.header("content-type") ?? "";
    let body = {};
    if (contentType.includes("json") && rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({
          error: {
            message: "[Lyceum] Request body is not valid JSON, so it cannot be governed.",
            type: "lyceum_config",
            code: "UNPARSEABLE_BODY"
          }
        });
        return;
      }
    }
    const model = typeof body.model === "string" ? body.model : void 0;
    const sessionId = resolveSessionId(req, tenant, body);
    const isStream = body.stream === true;
    const isToolCall = Array.isArray(body.tools) || Array.isArray(body.functions);
    const ctx = {
      sessionId,
      tenantId: tenant.licenseKey,
      model: model ?? "unknown",
      payload: body,
      isToolCall,
      mcpServer: req.header("x-lyceum-mcp-server") ?? void 0
    };
    const verdict = await breaker.checkBefore(ctx, tenant.policy);
    if (!verdict.allowed && verdict.breach) {
      const status = breachToStatus(verdict.breach.code);
      const payload = breachToErrorBody(verdict.breach, verdict.state, sessionId);
      await recordBreach({
        licenseKey: tenant.licenseKey,
        sessionId,
        model: ctx.model,
        breach: verdict.breach,
        state: verdict.state,
        redactedExcerpt: redact(JSON.stringify(body).slice(0, 2e3)),
        evaluatedInMs: verdict.evaluatedInMs
      }).catch(() => {
      });
      res.status(status).set("x-lyceum-decision", "blocked").set("x-lyceum-breach", verdict.breach.code).set("x-lyceum-eval-ms", verdict.evaluatedInMs.toFixed(2)).json(payload);
      return;
    }
    const upstreamName = inferUpstream(model, tenant.defaultUpstream);
    const upstreamBase = UPSTREAMS[upstreamName];
    const suffix = req.params[0] ?? "";
    const qIndex = req.originalUrl.indexOf("?");
    const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
    const upstreamUrl = `${upstreamBase}/v1/${suffix}${query}`;
    let upstreamRes;
    try {
      upstreamRes = await doFetch(upstreamUrl, {
        method: req.method,
        headers: forwardableHeaders(req),
        body: req.method === "GET" || req.method === "HEAD" ? void 0 : rawBody
      });
    } catch (err) {
      res.status(502).json({
        error: {
          message: `[Lyceum] Could not reach ${upstreamName}: ${err instanceof Error ? err.message : "unknown"}`,
          type: "lyceum_upstream",
          code: "UPSTREAM_UNREACHABLE"
        }
      });
      return;
    }
    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) res.setHeader(name, value);
    });
    res.setHeader("x-lyceum-decision", "allowed");
    res.setHeader("x-lyceum-eval-ms", verdict.evaluatedInMs.toFixed(2));
    res.setHeader("x-lyceum-session", sessionId);
    if (isStream && upstreamRes.body) {
      await pipeAndMeter(upstreamRes, res, ctx, {
        licenseKey: tenant.licenseKey,
        sessionId,
        upstream: upstreamName,
        keyFingerprint: fingerprintKey(req.header("authorization")),
        startedAt,
        verdict,
        body
      });
      return;
    }
    const text = await upstreamRes.text();
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const parsed = JSON.parse(text);
      usage = readUsage(parsed);
    } catch {
    }
    const after = await breaker.recordAfter(ctx, usage);
    await recordProxyCall({
      licenseKey: tenant.licenseKey,
      sessionId,
      model: ctx.model,
      upstream: upstreamName,
      keyFingerprint: fingerprintKey(req.header("authorization")),
      status: upstreamRes.status,
      usage,
      spentCentsAfter: after.spentCents,
      latencyMs: performance.now() - startedAt,
      evaluatedInMs: verdict.evaluatedInMs,
      redactedRequest: redact(JSON.stringify(body).slice(0, 2e3))
    }).catch(() => {
    });
    res.send(text);
  };
  router.all("/t/:token/v1/*", rawJson, handler);
  router.all("/v1/*", rawJson, handler);
  return router;
}
function readUsage(parsed) {
  const u = parsed?.usage;
  if (!u) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    outputTokens: u.completion_tokens ?? u.output_tokens ?? 0
  };
}
async function pipeAndMeter(upstreamRes, res, ctx, meta) {
  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      tail = (tail + decoder.decode(value, { stream: true })).slice(-8192);
    }
  } finally {
    res.end();
  }
  for (const line of tail.split("\n")) {
    const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!trimmed || trimmed === "[DONE]" || !trimmed.startsWith("{")) continue;
    try {
      const found = readUsage(JSON.parse(trimmed));
      if (found.inputTokens || found.outputTokens) usage = found;
    } catch {
    }
  }
  const after = await breaker.recordAfter(ctx, usage);
  await recordProxyCall({
    licenseKey: meta.licenseKey,
    sessionId: meta.sessionId,
    model: ctx.model,
    upstream: meta.upstream,
    keyFingerprint: meta.keyFingerprint,
    status: upstreamRes.status,
    usage,
    spentCentsAfter: after.spentCents,
    latencyMs: performance.now() - meta.startedAt,
    evaluatedInMs: meta.verdict.evaluatedInMs,
    redactedRequest: redact(JSON.stringify(meta.body).slice(0, 2e3)),
    streamed: true
  }).catch(() => {
  });
}

// server/db/proxyTokens.ts
init_firestore();
import crypto3 from "crypto";
var collection6 = () => getDb().collection("proxyTokens");
function generateProxyToken() {
  return `lyc_live_${crypto3.randomBytes(18).toString("base64url")}`;
}
async function mintProxyToken(params) {
  const record = {
    token: generateProxyToken(),
    licenseKey: params.licenseKey,
    label: params.label ?? "Default",
    defaultUpstream: params.defaultUpstream ?? "openai",
    policy: params.policy ?? {},
    createdAt: Date.now()
  };
  await collection6().doc(record.token).set(record);
  return record;
}
async function resolveProxyToken(token) {
  const snap = await collection6().doc(token).get();
  if (!snap.exists) return null;
  const record = snap.data();
  if (record.revokedAt) return null;
  collection6().doc(token).set({ lastUsedAt: Date.now() }, { merge: true }).catch(() => {
  });
  return record;
}
async function listProxyTokens(licenseKey) {
  const snap = await collection6().where("licenseKey", "==", licenseKey).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt);
}
async function revokeProxyToken(licenseKey, token) {
  const ref = collection6().doc(token);
  const snap = await ref.get();
  if (!snap.exists || snap.data().licenseKey !== licenseKey) return false;
  await ref.set({ revokedAt: Date.now() }, { merge: true });
  return true;
}
async function updateProxyPolicy(licenseKey, token, policy) {
  const ref = collection6().doc(token);
  const snap = await ref.get();
  if (!snap.exists || snap.data().licenseKey !== licenseKey) return false;
  await ref.set({ policy }, { merge: true });
  return true;
}

// server/index.ts
init_firestore();
var orders = /* @__PURE__ */ new Map();
var BETA_SLOT_BASELINE = Number(process.env.BETA_SLOT_BASELINE ?? 84);
var BETA_SLOT_CAP = Number(process.env.BETA_SLOT_CAP ?? 100);
function verifyLemonSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const digest = crypto4.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");
  return expected.length === actual.length && crypto4.timingSafeEqual(expected, actual);
}
function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_TOKEN || "";
  const provided = req.header("x-admin-token") || "";
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(provided, "utf8");
  const valid = configured.length > 0 && expected.length === actual.length && crypto4.timingSafeEqual(expected, actual);
  if (!valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
function createApiApp() {
  const app2 = express2();
  app2.use(
    createProxyRouter({
      resolveTenant: async (token) => {
        const record = await resolveProxyToken(token).catch(() => null);
        if (!record) return null;
        return {
          token: record.token,
          licenseKey: record.licenseKey,
          defaultUpstream: record.defaultUpstream,
          policy: record.policy
        };
      }
    })
  );
  app2.post(
    "/api/webhooks/lemonsqueezy",
    express2.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";
      const signature = req.header("X-Signature");
      const rawBody = req.body;
      if (!verifyLemonSignature(rawBody, signature, secret)) {
        return res.status(401).json({ error: "invalid signature" });
      }
      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "invalid json" });
      }
      const eventName = payload?.meta?.event_name;
      const ref = payload?.meta?.custom_data?.ref;
      const customData = payload?.meta?.custom_data ?? {};
      const existing = ref ? orders.get(ref) : void 0;
      if (ref && eventName === "license_key_created") {
        const licenseKey = payload?.data?.attributes?.key;
        const product = payload?.data?.attributes?.product_name;
        const email = payload?.data?.attributes?.user_email ?? existing?.email;
        const name = customData?.name ?? existing?.name;
        const organization = customData?.organization ?? existing?.organization;
        orders.set(ref, {
          ...existing,
          status: "paid",
          licenseKey,
          product,
          email,
          name,
          organization,
          paidAt: Date.now()
        });
        if (licenseKey) {
          try {
            await provisionAccount({ licenseKey, email, name, organization, product });
          } catch (err) {
            console.error("[Lyceum] Failed to provision account for", licenseKey, err);
          }
        }
      } else if (ref && eventName === "order_created") {
        orders.set(ref, {
          ...existing,
          status: existing?.status === "paid" ? "paid" : "pending",
          email: payload?.data?.attributes?.user_email ?? existing?.email,
          name: customData?.name ?? existing?.name,
          organization: customData?.organization ?? existing?.organization
        });
      }
      res.json({ received: true });
    }
  );
  app2.get("/api/orders/:ref", (req, res) => {
    const order = orders.get(req.params.ref);
    res.json(order ?? { status: "pending" });
  });
  app2.get("/api/beta-slots", (_req, res) => {
    const paidCount = Array.from(orders.values()).filter((o) => o.status === "paid").length;
    const claimed = Math.min(BETA_SLOT_BASELINE + paidCount, BETA_SLOT_CAP);
    res.json({ claimed, cap: BETA_SLOT_CAP });
  });
  app2.get("/api/admin/orders", requireAdmin, (_req, res) => {
    const list = Array.from(orders.entries()).map(([ref, order]) => ({ ref, ...order })).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
    res.json({ orders: list });
  });
  app2.use(express2.json({ limit: "1mb" }));
  app2.post("/api/chat", async (req, res) => {
    try {
      const result = await proxyToOpenRouter(req.body);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(502).json({ error: message });
    }
  });
  app2.post("/api/chat/stream", async (req, res) => {
    const { domain, messages, temperature, maxTokens } = req.body ?? {};
    if (!domain || !messages) {
      return res.status(400).json({ error: "Both 'domain' and 'messages' are required" });
    }
    const apiKey = KEY_MAP[domain];
    if (!apiKey) {
      return res.status(502).json({ error: `No API key configured for domain "${domain}"` });
    }
    const route = MODEL_ROUTES[domain];
    if (!route) {
      return res.status(400).json({ error: `Unknown domain "${domain}"` });
    }
    try {
      await proxyStreamToOpenRouter({
        domain,
        messages,
        temperature,
        maxTokens,
        onHeaders: (headers) => {
          res.writeHead(headers.status || 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
          });
        },
        onChunk: (chunk) => {
          res.write(chunk);
        },
        onDone: () => {
          res.write("data: [DONE]\n\n");
          res.end();
        },
        onError: (err) => {
          if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: err.message })}

`);
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            res.status(502).json({ error: err.message });
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.status(502).json({ error: message });
      } else {
        res.end();
      }
    }
  });
  app2.post("/api/sessions", authenticateLicenseKey, async (req, res) => {
    try {
      const { name, tasks } = req.body ?? {};
      if (!name || !tasks) {
        return res.status(400).json({ error: "Both 'name' and 'tasks' are required" });
      }
      const { createSession: createSession2 } = await Promise.resolve().then(() => (init_sessions(), sessions_exports));
      const session = await createSession2({
        licenseKey: req.lyceumAccount.licenseKey,
        name,
        tasks
      });
      res.status(201).json({ session });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to create session" });
    }
  });
  app2.get("/api/sessions", authenticateLicenseKey, async (req, res) => {
    try {
      const { listSessions: listSessions2 } = await Promise.resolve().then(() => (init_sessions(), sessions_exports));
      const sessions = await listSessions2(req.lyceumAccount.licenseKey);
      res.json({ sessions });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to list sessions" });
    }
  });
  app2.get("/api/sessions/:id", authenticateLicenseKey, async (req, res) => {
    try {
      const { getSession: getSession2 } = await Promise.resolve().then(() => (init_sessions(), sessions_exports));
      const session = await getSession2(req.params.id, req.lyceumAccount.licenseKey);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ session });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to get session" });
    }
  });
  app2.put("/api/sessions/:id", authenticateLicenseKey, async (req, res) => {
    try {
      const { updateSessionTasks: updateSessionTasks2, updateSessionMeta: updateSessionMeta2, getSession: getSession2 } = await Promise.resolve().then(() => (init_sessions(), sessions_exports));
      const body = req.body ?? {};
      const licenseKey = req.lyceumAccount.licenseKey;
      const hasTasks = Array.isArray(body.tasks);
      const hasMeta = body.active !== void 0 || body.activeTaskId !== void 0 || body.name !== void 0;
      const hasAuditLog = body.autoAnswerAuditLog !== void 0;
      if (!hasTasks && !hasMeta && !hasAuditLog) {
        return res.status(400).json({ error: "No updatable fields provided" });
      }
      if (hasTasks) {
        const session = await updateSessionTasks2(req.params.id, licenseKey, body.tasks);
        if (!session) return res.status(404).json({ error: "Session not found" });
      }
      if (hasMeta || hasAuditLog) {
        const metaToSave = {};
        if (body.active !== void 0) metaToSave.active = body.active;
        if (body.activeTaskId !== void 0) metaToSave.activeTaskId = body.activeTaskId;
        if (body.name !== void 0) metaToSave.name = body.name;
        if (hasAuditLog) metaToSave.autoAnswerAuditLog = body.autoAnswerAuditLog;
        const session = await updateSessionMeta2(req.params.id, licenseKey, metaToSave);
        if (!session) return res.status(404).json({ error: "Session not found" });
        return res.json({ session });
      }
      const finalSession = await getSession2(req.params.id, licenseKey);
      res.json({ session: finalSession });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to update session" });
    }
  });
  app2.delete("/api/sessions/:id", authenticateLicenseKey, async (req, res) => {
    try {
      const { deleteSession: deleteSession2 } = await Promise.resolve().then(() => (init_sessions(), sessions_exports));
      const deleted = await deleteSession2(req.params.id, req.lyceumAccount.licenseKey);
      if (!deleted) return res.status(404).json({ error: "Session not found" });
      res.json({ deleted: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete session" });
    }
  });
  app2.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      domains: Object.keys(KEY_MAP),
      keysConfigured: Object.entries(KEY_MAP).filter(([, v]) => !!v).map(([k2]) => k2),
      mcpEndpoint: "/api/mcp",
      apiEndpoint: "/api/v1/chat",
      timestamp: Date.now()
    });
  });
  app2.get("/api/notes", async (_req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("notes").select();
      if (error) return res.status(502).json({ error: error.message });
      res.json({ notes: data });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : "Supabase not configured" });
    }
  });
  app2.get("/api/v1/account", authenticateLicenseKey, (req, res) => {
    const account = req.lyceumAccount;
    res.json({
      // name/organization come from the checkout, which is why the app needs
      // no onboarding wizard to learn who the customer is.
      name: account.name ?? null,
      organization: account.organization ?? null,
      product: account.product,
      creditsRemaining: account.creditsRemaining,
      creditsTotal: account.creditsTotal
    });
  });
  app2.post("/api/v1/chat", authenticateLicenseKey, async (req, res) => {
    const { domain, prompt } = req.body ?? {};
    if (!domain || !prompt) {
      return res.status(400).json({ error: "Both 'domain' and 'prompt' are required" });
    }
    if (!DOMAINS.includes(domain)) {
      return res.status(400).json({ error: `domain must be one of: ${DOMAINS.join(", ")}` });
    }
    try {
      const result = await runTask({
        licenseKey: req.lyceumAccount.licenseKey,
        domain,
        prompt,
        source: "api"
      });
      res.json(result);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({ error: err.message, remaining: err.remaining });
      }
      res.status(502).json({ error: err instanceof Error ? err.message : "Task failed" });
    }
  });
  app2.get("/api/v1/tasks", authenticateLicenseKey, async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const tasks = await listTasks(req.lyceumAccount.licenseKey, limit);
    res.json({ tasks });
  });
  app2.get("/api/v1/tasks/:id", authenticateLicenseKey, async (req, res) => {
    const task = await getTask(req.params.id, req.lyceumAccount.licenseKey);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ task });
  });
  app2.all(
    "/api/mcp/w/:token",
    (req, _res, next) => {
      req.headers.authorization = `Bearer ${req.params.token}`;
      next();
    },
    authenticateLicenseKey,
    handleMcpRequest
  );
  app2.all("/api/mcp", authenticateLicenseKey, handleMcpRequest);
  const mcpUrlFor = (req, token) => `${req.protocol}://${req.get("host")}/api/mcp/w/${token}`;
  app2.get("/api/v1/workers", authenticateLicenseKey, async (req, res) => {
    const workers = await listWorkers(req.lyceumAccount.licenseKey);
    res.json({
      ephemeralStore: isEphemeralStore(),
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        departmentId: w.departmentId,
        departmentName: w.departmentName,
        model: w.model,
        tokensUsed: w.tokensUsed,
        stepsCompleted: w.stepsCompleted,
        lastSeenAt: w.lastSeenAt,
        // Full URL: this is the thing the customer pastes into their client,
        // and they will need it again every time they set up a new machine.
        mcpUrl: mcpUrlFor(req, w.mcpToken)
      }))
    });
  });
  app2.post("/api/v1/workers", authenticateLicenseKey, async (req, res) => {
    const { name, role, departmentId, departmentName, model } = req.body ?? {};
    if (!name || !departmentId) {
      return res.status(400).json({ error: "name and departmentId are required" });
    }
    const worker = await createWorker({
      licenseKey: req.lyceumAccount.licenseKey,
      name,
      role: role || "Assistant",
      departmentId,
      departmentName: departmentName || departmentId,
      model: model || "gpt-4o"
    });
    res.json({ worker: { ...worker, mcpUrl: mcpUrlFor(req, worker.mcpToken) } });
  });
  app2.post("/api/v1/workers/:id/rotate", authenticateLicenseKey, async (req, res) => {
    const token = await rotateWorkerToken(req.lyceumAccount.licenseKey, req.params.id);
    if (!token) return res.status(404).json({ error: "Worker not found" });
    res.json({ mcpUrl: mcpUrlFor(req, token) });
  });
  app2.delete("/api/v1/workers/:id", authenticateLicenseKey, async (req, res) => {
    const ok = await revokeWorker(req.lyceumAccount.licenseKey, req.params.id);
    if (!ok) return res.status(404).json({ error: "Worker not found" });
    res.json({ revoked: true });
  });
  app2.get("/api/v1/missions", authenticateLicenseKey, async (req, res) => {
    const missions = await listMissions(
      req.lyceumAccount.licenseKey,
      typeof req.query.department === "string" ? req.query.department : void 0
    );
    res.json({ missions: missions.map((m) => ({ ...m, progress: progressOf(m) })) });
  });
  app2.post("/api/v1/missions", authenticateLicenseKey, async (req, res) => {
    const { department, title, goal, headName, steps } = req.body ?? {};
    if (!department || !title) {
      return res.status(400).json({ error: "department and title are required" });
    }
    const mission = await createMission({
      licenseKey: req.lyceumAccount.licenseKey,
      department,
      title,
      goal,
      headName: headName || "You",
      steps
    });
    res.json({ mission });
  });
  app2.patch("/api/v1/missions/:id/steps/:stepId", authenticateLicenseKey, async (req, res) => {
    const { status, note, addTokens } = req.body ?? {};
    const updated = await updateStep({
      licenseKey: req.lyceumAccount.licenseKey,
      missionId: req.params.id,
      stepId: req.params.stepId,
      status,
      note,
      addTokens
    });
    if (!updated) return res.status(404).json({ error: "Task or step not found" });
    res.json({ mission: { ...updated, progress: progressOf(updated) } });
  });
  app2.get("/api/v1/proxy-tokens", authenticateLicenseKey, async (req, res) => {
    const tokens = await listProxyTokens(req.lyceumAccount.licenseKey);
    res.json({
      // The token itself is only shown at mint time; listing returns a prefix
      // so a leaked screenshot of this page isn't a working credential.
      tokens: tokens.map((t) => ({
        preview: `${t.token.slice(0, 16)}\u2026`,
        label: t.label,
        defaultUpstream: t.defaultUpstream,
        policy: t.policy,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        revoked: !!t.revokedAt
      }))
    });
  });
  app2.post("/api/v1/proxy-tokens", authenticateLicenseKey, async (req, res) => {
    const { label, defaultUpstream, policy } = req.body ?? {};
    const record = await mintProxyToken({
      licenseKey: req.lyceumAccount.licenseKey,
      label,
      defaultUpstream,
      policy
    });
    res.json({
      token: record.token,
      baseUrl: `${req.protocol}://${req.get("host")}/t/${record.token}/v1`,
      // Said explicitly because there is no second chance to copy it.
      notice: "Copy this now \u2014 the full token is not shown again."
    });
  });
  app2.delete("/api/v1/proxy-tokens/:token", authenticateLicenseKey, async (req, res) => {
    const ok = await revokeProxyToken(req.lyceumAccount.licenseKey, req.params.token);
    if (!ok) return res.status(404).json({ error: "Token not found" });
    res.json({ revoked: true });
  });
  app2.patch("/api/v1/proxy-tokens/:token/policy", authenticateLicenseKey, async (req, res) => {
    const ok = await updateProxyPolicy(
      req.lyceumAccount.licenseKey,
      req.params.token,
      req.body ?? {}
    );
    if (!ok) return res.status(404).json({ error: "Token not found" });
    res.json({ updated: true });
  });
  app2.get("/api/v1/decisions", authenticateLicenseKey, async (req, res) => {
    const licenseKey = req.lyceumAccount.licenseKey;
    const breaches = await pendingBreaches(licenseKey, 20);
    const cards = await Promise.all(
      breaches.map(async (b) => {
        const summary = await sessionSummary(licenseKey, b.sessionId);
        const live = await breaker.snapshot(b.sessionId);
        return {
          breachNodeId: b.id,
          sessionId: b.sessionId,
          taskName: b.payload?.excerpt?.slice(0, 80) ?? b.sessionId,
          reason: b.summary,
          breachCode: b.breachCode,
          observed: b.payload?.observed,
          limit: b.payload?.limit,
          model: b.model,
          occurredAt: b.occurredAt,
          evaluatedInMs: b.evaluatedInMs,
          spend: {
            spentCents: live.spentCents,
            // The ceiling the breach was measured against.
            limitCents: typeof b.payload?.limit === "number" ? b.payload.limit : null
          },
          session: summary
        };
      })
    );
    res.json({ cards });
  });
  app2.post("/api/v1/decisions/:breachNodeId", authenticateLicenseKey, async (req, res) => {
    const licenseKey = req.lyceumAccount.licenseKey;
    const { decision, sessionId, grantCents, newLimits, note, memberId, memberName } = req.body ?? {};
    if (!decision || !sessionId) {
      return res.status(400).json({ error: "decision and sessionId are required" });
    }
    if (decision === "approve") {
      await breaker.raiseBudget(sessionId, grantCents ?? 100);
    } else if (decision === "abort") {
    } else if (decision === "modify" && newLimits) {
      if (typeof newLimits.grantCents === "number") {
        await breaker.raiseBudget(sessionId, newLimits.grantCents);
      }
    }
    const node = await recordHumanApproval({
      licenseKey,
      sessionId,
      memberId: memberId ?? "member-owner",
      memberName: memberName ?? "You",
      decision,
      breachNodeId: req.params.breachNodeId,
      note,
      grantedCents: decision === "approve" ? grantCents ?? 100 : newLimits?.grantCents,
      newLimits
    });
    res.json({ recorded: true, decisionNodeId: node.id, state: await breaker.snapshot(sessionId) });
  });
  app2.get("/api/v1/evidence/:nodeId/lineage", authenticateLicenseKey, async (req, res) => {
    const trail = await lineage(req.lyceumAccount.licenseKey, req.params.nodeId);
    res.json({
      lineage: trail.map(({ depth, node, via }) => ({
        depth,
        via,
        id: node.id,
        kind: node.kind,
        actor: { kind: node.actorKind, label: node.actorLabel ?? node.actorId },
        summary: node.summary,
        costCents: node.costCents,
        breachCode: node.breachCode,
        occurredAt: node.occurredAt,
        pos: node.pos
      }))
    });
  });
  return app2;
}
async function startServer() {
  const app2 = createApiApp();
  const server = createServer(app2);
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app2.use(express2.static(staticPath));
  app2.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
  const port = process.env.PORT || 3e3;
  server.listen(port, () => {
    const configured = Object.entries(KEY_MAP).filter(([, v]) => !!v).length;
    console.log(`[Lyceum] Server running on http://localhost:${port}/`);
    console.log(`[Lyceum] MCP endpoint: POST http://localhost:${port}/api/mcp`);
    console.log(`[Lyceum] API proxy: POST http://localhost:${port}/api/chat`);
    console.log(`[Lyceum] API keys configured: ${configured}/3 domains`);
  });
}
var isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().catch(console.error);
}

// server/vercel-entry.ts
var app = createApiApp();
var vercel_entry_default = app;
export {
  vercel_entry_default as default
};
