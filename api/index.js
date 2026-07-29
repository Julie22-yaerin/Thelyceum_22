// server/index.ts
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// client/src/lib/modelConfig.ts
var DOMAINS = ["LAW", "FINANCE", "TECH", "MUSE"];
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
  }
};

// server/lib/openrouter.ts
var KEY_MAP = {
  LAW: process.env.OPENROUTER_KEY_LAW || process.env.VITE_OPENROUTER_KEY_LAW || "",
  FINANCE: process.env.OPENROUTER_KEY_FINANCE || process.env.VITE_OPENROUTER_KEY_FINANCE || "",
  TECH: process.env.OPENROUTER_KEY_TECH || process.env.VITE_OPENROUTER_KEY_TECH || "",
  MUSE: process.env.OPENROUTER_KEY_MUSE || process.env.VITE_OPENROUTER_KEY_MUSE || ""
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

// server/db/accounts.ts
import { FieldValue } from "firebase-admin/firestore";

// server/db/firestore.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
var db = null;
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

// server/db/accounts.ts
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

// server/db/tasks.ts
var collection2 = () => getDb().collection("tasks");
async function recordTask(params) {
  const ref = collection2().doc();
  const task = { id: ref.id, createdAt: Date.now(), ...params };
  await ref.set(task);
  return task;
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

// server/lib/runTask.ts
var TASK_COST = 10;
async function runTask(params) {
  const { licenseKey, domain, prompt, source } = params;
  const creditsRemaining = await deductCredits(licenseKey, TASK_COST);
  try {
    const completion = await proxyToOpenRouter({
      domain,
      messages: [{ role: "user", content: prompt }]
    });
    const result = extractReplyText(completion);
    const task = await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "completed",
      result,
      creditsCost: TASK_COST
    });
    return { taskId: task.id, result, creditsRemaining, creditsCost: TASK_COST };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task failed";
    await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "failed",
      error: message,
      creditsCost: TASK_COST
    });
    throw err;
  }
}

// server/mcp/http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
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
      try {
        const result = await runTask({
          licenseKey: account.licenseKey,
          domain,
          prompt,
          source: "mcp"
        });
        return {
          content: [
            {
              type: "text",
              text: `${result.result}

[task ${result.taskId} \xB7 ${result.creditsCost} credits used \xB7 ${result.creditsRemaining} remaining]`
            }
          ]
        };
      } catch (err) {
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
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "Task failed" }]
        };
      }
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
