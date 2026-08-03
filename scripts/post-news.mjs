#!/usr/bin/env node
/**
 * The Lyceum — post to the waiting-room feed.
 *
 * There is deliberately no web form for this: POST /api/news is gated by
 * LYCEUM_DEV_TOKEN (see packages/server/src/admin.ts, authenticateDevToken),
 * a narrower credential than the admin console's keys, so it's safe to hand
 * to a CI job that posts a benchmark result automatically. This script is
 * the thing that holds it.
 *
 * Usage:
 *   LYCEUM_DEV_TOKEN=... node scripts/post-news.mjs \
 *     --category benchmark --title "..." --body "..." \
 *     [--server https://thelyceum.dev] [--token ...]
 *
 * --body can also be piped on stdin:
 *   cat report.txt | LYCEUM_DEV_TOKEN=... node scripts/post-news.mjs \
 *     --category benchmark --title "nightly run, 2026-08-03"
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const category = args.category;
  const title = args.title;
  const token = args.token ?? process.env.LYCEUM_DEV_TOKEN;
  const server = args.server ?? process.env.LYCEUM_PUBLIC_URL ?? "http://localhost:3000";

  if (!["progress", "test", "benchmark"].includes(category)) {
    console.error("error: --category must be one of progress | test | benchmark");
    process.exit(1);
  }
  if (!title) {
    console.error("error: --title is required");
    process.exit(1);
  }
  if (!token) {
    console.error("error: no dev token. Pass --token or set LYCEUM_DEV_TOKEN.");
    process.exit(1);
  }

  const body = typeof args.body === "string" ? args.body : await readStdin();
  if (!body) {
    console.error("error: --body is required, or pipe content on stdin.");
    process.exit(1);
  }

  const res = await fetch(new URL("/api/news", server), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ category, title, body }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`error: ${res.status} ${JSON.stringify(json)}`);
    process.exit(1);
  }

  console.log(`posted: ${json.entry.id} (${json.entry.category}) "${json.entry.title}"`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
