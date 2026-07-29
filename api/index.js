var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/db/firestore.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
function getDb() {
  if (db) return db;
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firestore is not configured \u2014 set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
      );
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  db = getFirestore();
  return db;
}
var db;
var init_firestore = __esm({
  "server/db/firestore.ts"() {
    "use strict";
    db = null;
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
  const ref = collection2().doc();
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
  const ref = collection2().doc(taskId);
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
  const ref = collection2().doc(taskId);
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
  const snap = await collection2().where("licenseKey", "==", licenseKey).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data());
}
async function getTask(taskId, licenseKey) {
  const snap = await collection2().doc(taskId).get();
  if (!snap.exists) return null;
  const task = snap.data();
  return task.licenseKey === licenseKey ? task : null;
}
var collection2;
var init_tasks = __esm({
  "server/db/tasks.ts"() {
    "use strict";
    init_firestore();
    init_executionConfig();
    collection2 = () => getDb().collection("tasks");
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
  const ref = collection3().doc();
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
  const ref = collection3().doc(sessionId);
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
  const ref = collection3().doc(sessionId);
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
  const ref = collection3().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return null;
  const updated = { ...meta, updatedAt: Date.now() };
  await ref.update(updated);
  return { ...data, ...updated };
}
async function getSession(sessionId, licenseKey) {
  const snap = await collection3().doc(sessionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data.licenseKey === licenseKey ? data : null;
}
async function listSessions(licenseKey, limit = 50) {
  const snap = await collection3().where("licenseKey", "==", licenseKey).orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data());
}
async function deleteSession(sessionId, licenseKey) {
  const ref = collection3().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  if (data.licenseKey !== licenseKey) return false;
  await ref.delete();
  return true;
}
var collection3;
var init_sessions = __esm({
  "server/db/sessions.ts"() {
    "use strict";
    init_firestore();
    collection3 = () => getDb().collection("sessions");
  }
});

// server/index.ts
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

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
  const key = Object.keys(TIER_CREDITS).find((k) => product.toLowerCase().includes(k));
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
function buildServer(account) {
  const server = new McpServer({ name: "the-lyceum", version: "1.0.0" });
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
  const server = buildServer(account);
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

// server/index.ts
var orders = /* @__PURE__ */ new Map();
var BETA_SLOT_BASELINE = Number(process.env.BETA_SLOT_BASELINE ?? 84);
var BETA_SLOT_CAP = Number(process.env.BETA_SLOT_CAP ?? 100);
function verifyLemonSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_TOKEN || "";
  const provided = req.header("x-admin-token") || "";
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(provided, "utf8");
  const valid = configured.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
function createApiApp() {
  const app2 = express();
  app2.post(
    "/api/webhooks/lemonsqueezy",
    express.raw({ type: "application/json", limit: "1mb" }),
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
  app2.use(express.json({ limit: "1mb" }));
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
      keysConfigured: Object.entries(KEY_MAP).filter(([, v]) => !!v).map(([k]) => k),
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
      product: account.product,
      organization: account.organization,
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
  app2.all("/api/mcp", authenticateLicenseKey, handleMcpRequest);
  return app2;
}
async function startServer() {
  const app2 = createApiApp();
  const server = createServer(app2);
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app2.use(express.static(staticPath));
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
