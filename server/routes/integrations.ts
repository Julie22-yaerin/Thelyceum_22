/**
 * Integration and cloud routes.
 *
 * The OAuth flow is server-driven end to end: the server issues a single-use
 * `state` bound to the license key, builds the authorize URL, and exchanges the
 * code. The browser never assembles an OAuth URL and never sees a token.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import {
  OAUTH_PROVIDERS, providerFor, isProviderConfigured, buildAuthorizeUrl,
  exchangeCode, renderAuthPage, renderCallbackSuccessPage,
} from "../lib/integrations.js";
import { issueAuthState, consumeAuthState } from "../lib/security.js";
import {
  readSlot, listConnections, saveConnection, removeConnection, publicConnection,
} from "../db/workspaceState.js";

type Authenticate = express.RequestHandler;

export function registerIntegrationsRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Integrations (MCP connections to external tools) ─────────────────────
  // The connect flow is real end-to-end: the server issues a single-use
  // `state` bound to the license key, builds the authorize URL (the real
  // provider consent page when OAuth apps are registered, our own sandbox
  // consent page otherwise), and the callback exchanges the code
  // server-side. The browser never sees a secret.

  // Connections live in Firestore, not a Map: a connection made on one
  // instance was invisible to every other, and vanished on the next deploy
  // with no message to the operator.

  app.get("/api/v1/integrations", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const mine = await listConnections(licenseKey);

    res.json({
      integrations: OAUTH_PROVIDERS.map((p) => {
        // Projected through publicConnection so a token added to the stored
        // shape later cannot leak into an API response by being forgotten.
        const stored = mine[p.id];
        const live = stored ? publicConnection(stored) : undefined;
        const configured = isProviderConfigured(p);
        return {
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          blurb: p.blurb,
          auth: "oauth" as const,
          scopes: p.scopes,
          scopeLabels: p.scopeLabels,
          // Honest state: a card reads "connected" only when a connection
          // exists. Every card is connectable — either to the real provider
          // (mode: real) or through the sandbox consent flow (mode: sandbox).
          mode: configured ? "real" : "sandbox",
          state: live ? ("connected" as const) : ("available" as const),
          blockedReason: undefined,
          connectedAs: live?.connectedAs,
          connectedAt: live?.connectedAt,
          connectedMode: live?.mode,
        };
      }),
    });
  });

  app.post("/api/v1/integrations/:id/authorize", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const provider = providerFor(req.params.id);
    if (!provider) return res.status(404).json({ error: "Unknown integration." });

    const origin = `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/v1/integrations/callback`;

    // Single-use state binds this authorization to the caller's license key,
    // so the unauthenticated callback (a browser redirect) can safely complete
    // the connection for the right account. Never store the license key in the
    // URL itself — it would leak via referrers and logs.
    const state = issueAuthState({
      provider: provider.id,
      licenseKey: req.lyceumAccount!.licenseKey,
      mode: isProviderConfigured(provider) ? "real" : "sandbox",
      createdAt: Date.now(),
    });

    const outcome = buildAuthorizeUrl(provider, { origin, state, redirectUri });
    res.json({ authorizeUrl: outcome.authorizeUrl, mode: outcome.mode, notice: outcome.notice });
  });

  /** Sandbox consent page — the provider's auth screen until OAuth apps exist. */
  app.get("/api/v1/integrations/:id/sandbox-auth", async (req: express.Request, res: express.Response) => {
    const provider = providerFor(req.params.id);
    const state = String(req.query.state ?? "");
    if (!provider || !state) {
      return res.status(400).send("Invalid integration request.");
    }
    const origin = `${req.protocol}://${req.get("host")}`;
    res.type("html").send(renderAuthPage({ provider, state, origin }));
  });

  /** OAuth callback — browser redirect, so deliberately NOT authenticated. */
  app.get("/api/v1/integrations/callback", async (req: express.Request, res: express.Response) => {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");

    const auth = consumeAuthState(state);
    if (!auth) {
      return res.status(400).send("This link is invalid or has expired. Go back and try again.");
    }
    const provider = providerFor(auth.provider);
    if (!provider) {
      return res.status(400).send("Unknown integration.");
    }

    const origin = `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/v1/integrations/callback`;

    try {
      let connectedAs = `${provider.name} sandbox account`;
      if (auth.mode === "real") {
        if (!code) {
          return res.status(400).send(`${provider.name} returned no authorization code.`);
        }
        const exchanged = await exchangeCode(provider, code, redirectUri);
        connectedAs = exchanged.connectedAs;
      }

      await saveConnection(auth.licenseKey, provider.id, {
        provider: provider.id,
        connectedAs,
        connectedAt: Date.now(),
        mode: auth.mode,
      });

      // The popup flow polls the list and flips the card; this page closes
      // itself. The fallback link covers popup-blocked browsers.
      res.type("html").send(renderCallbackSuccessPage(provider.name));
    } catch (err) {
      res
        .status(502)
        .type("html")
        .send(`<h3>Connection failed</h3><p>${String(err instanceof Error ? err.message : err)}</p>`);
    }
  });

  app.delete("/api/v1/integrations/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    await removeConnection(req.lyceumAccount!.licenseKey, req.params.id);
    res.json({ disconnected: true });
  });

  // ── Bring your own cloud ─────────────────────────────────────────────────

  app.get("/api/v1/cloud", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({
      config: (await readSlot(req.lyceumAccount!.licenseKey, "cloudConfig", null)) ?? {
        provider: "lyceum",
        verified: true,
      },
    });
  });

}
