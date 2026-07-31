/**
 * Integration providers — the connect surface.
 *
 * Two modes, and the server decides which one a card uses, not the browser:
 *
 *   REAL    the operator has registered an OAuth app with the provider
 *           (CLIENT_ID + CLIENT_SECRET in env). `authorizeUrl` is the real
 *           provider consent URL; `exchangeCode()` trades the code for a
 *           token server-side so the secret never touches the browser.
 *
 *   SANDBOX no OAuth app is registered yet. `authorizeUrl` points at our own
 *           consent page (`renderAuthPage`), which mimics the provider's
 *           flow so the integration experience is real end-to-end even before
 *           the operator finishes registering apps. The page says plainly
 *           that it is sandbox mode — a governance product that fakes a
 *           credential would be lying about the one thing it sells.
 *
 * Scope minimization (performing-oauth-scope-minimization-review): every
 * provider requests the smallest scope set that does the job, and the
 * plain-language labels below are shown BEFORE consent, never after.
 */

export interface OAuthProvider {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  envPrefix: string;
  scopes: string[];
  /** Plain-language description of what each scope lets the app do. */
  scopeLabels: Record<string, string>;
  /** Real OAuth endpoints — used when credentials are configured. */
  authorizeEndpoint: string;
  tokenEndpoint: string;
  /** Where the authorize URL lands (only used when creds configured). */
  responseType?: string;
  extraParams?: Record<string, string>;
}

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: "gmail",
    name: "Gmail",
    emoji: "✉️",
    blurb: "Read and draft mail",
    envPrefix: "GOOGLE",
    scopes: ["gmail.readonly", "gmail.compose"],
    scopeLabels: {
      "gmail.readonly": "Read your emails and labels",
      "gmail.compose": "Draft and send emails on your behalf",
    },
    authorizeEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    responseType: "code",
    extraParams: { access_type: "offline", prompt: "consent" },
  },
  {
    id: "slack",
    name: "Slack",
    emoji: "💬",
    blurb: "Read channels, post with approval",
    envPrefix: "SLACK",
    scopes: ["channels:history", "chat:write"],
    scopeLabels: {
      "channels:history": "Read messages from public channels",
      "chat:write": "Post messages to channels, only after you approve",
    },
    authorizeEndpoint: "https://slack.com/oauth/v2/authorize",
    tokenEndpoint: "https://slack.com/api/oauth.v2.access",
  },
  {
    id: "notion",
    name: "Notion",
    emoji: "📓",
    blurb: "Read and write pages",
    envPrefix: "NOTION",
    scopes: ["read_content", "update_content"],
    scopeLabels: {
      read_content: "Read pages and databases in your workspace",
      update_content: "Create and update pages you grant access to",
    },
    authorizeEndpoint: "https://api.notion.com/v1/oauth/authorize",
    tokenEndpoint: "https://api.notion.com/v1/oauth/token",
    extraParams: { owner: "user" },
  },
  {
    id: "github",
    name: "GitHub",
    emoji: "🐙",
    blurb: "Issues, PRs, code search",
    envPrefix: "GITHUB",
    scopes: ["repo", "read:org"],
    scopeLabels: {
      repo: "Read and write to the repositories you choose",
      "read:org": "Read your organization and team membership",
    },
    authorizeEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
  },
];

export function providerFor(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS.find((p) => p.id === id);
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  return !!(
    process.env[`${provider.envPrefix}_CLIENT_ID`] &&
    process.env[`${provider.envPrefix}_CLIENT_SECRET`]
  );
}

export interface AuthorizeOutcome {
  mode: "real" | "sandbox";
  authorizeUrl: string;
  /** Why sandbox, if sandbox — shown before consent, never after. */
  notice?: string;
}

/**
 * Build the authorize URL. Real URLs are assembled server-side on purpose:
 * a browser-built one lets the caller rewrite `state`/`redirect_uri` before
 * the redirect. Sandbox URLs point back at our own consent page.
 */
export function buildAuthorizeUrl(
  provider: OAuthProvider,
  params: { origin: string; state: string; redirectUri: string }
): AuthorizeOutcome {
  const clientId = process.env[`${provider.envPrefix}_CLIENT_ID`];

  if (isProviderConfigured(provider) && clientId) {
    const url = new URL(provider.authorizeEndpoint);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("state", params.state);
    if (provider.responseType) url.searchParams.set("response_type", provider.responseType);
    url.searchParams.set("scope", provider.scopes.join(" "));
    for (const [k, v] of Object.entries(provider.extraParams ?? {})) {
      url.searchParams.set(k, v);
    }
    return { mode: "real", authorizeUrl: url.toString() };
  }

  return {
    mode: "sandbox",
    authorizeUrl: `${params.origin}/api/v1/integrations/${provider.id}/sandbox-auth?state=${params.state}`,
    notice: `No ${provider.name} OAuth app is registered on this server yet, so this is a sandbox connection. It walks the real consent flow; no live ${provider.name} account is touched.`,
  };
}

/**
 * Exchange an authorization code for a token. Real mode uses the provider's
 * token endpoint with the server-side secret. Returns the account identifier
 * to display on the card (never the token itself).
 */
export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string
): Promise<{ connectedAs: string; accessToken?: string }> {
  const clientId = process.env[`${provider.envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${provider.envPrefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) {
    throw new Error(`${provider.name} OAuth app is not configured on the server.`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // GitHub returns form-encoded by default; force JSON like everyone else.
      Accept: "application/json",
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(
      `${provider.name} rejected the token exchange: ${String(data.error_description ?? data.error ?? res.status)}`
    );
  }

  // Provider-specific account identifier extraction. `data` is opaque JSON,
  // so each access is guarded and cast — never trust the shape.
  let connectedAs = `${provider.name} account`;
  if (provider.id === "gmail" && typeof (data as { email?: unknown }).email === "string") {
    connectedAs = (data as { email: string }).email;
  } else if (provider.id === "slack") {
    const authedUser = (data as { authed_user?: { email?: unknown } }).authed_user;
    if (typeof authedUser?.email === "string") connectedAs = authedUser.email;
  } else if (provider.id === "notion" && typeof (data as { workspace_name?: unknown }).workspace_name === "string") {
    connectedAs = `${(data as { workspace_name: string }).workspace_name} workspace`;
  } else if (provider.id === "github") {
    const user = (data as { user?: { login?: unknown } }).user;
    if (typeof user?.login === "string") connectedAs = `@${user.login}`;
  }

  return {
    connectedAs,
    accessToken: typeof data.access_token === "string" ? data.access_token : undefined,
  };
}

// ── Sandbox consent + callback pages (self-contained HTML, no assets) ───────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

/**
 * A consent screen that behaves exactly like the provider's own page — the
 * user sees what will be granted before anything happens, and "Allow" is an
 * explicit act. The page is honest that no real account is touched in sandbox.
 */
export function renderAuthPage(opts: {
  provider: OAuthProvider;
  state: string;
  origin: string;
}): string {
  const { provider, state, origin } = opts;
  const callbackUrl = `${origin}/api/v1/integrations/callback?state=${encodeURIComponent(state)}&code=sandbox_code`;
  const cancelUrl = `${origin}/war-room?connect=cancelled&provider=${provider.id}`;

  const scopeItems = provider.scopes
    .map((s) => {
      const label = provider.scopeLabels[s] ?? s;
      return `<li><span class="dot"></span><span><strong>${esc(label)}</strong><br/><code>${esc(s)}</code></span></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(provider.name)} · Authorize The Lyceum</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #eef0f3; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.12); width: 100%; max-width: 440px; padding: 32px; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .brand .logo { font-size: 30px; }
  .brand h1 { font-size: 18px; font-weight: 600; color: #111; }
  .brand p { font-size: 12px; color: #667; }
  h2 { font-size: 16px; font-weight: 600; color: #111; margin-bottom: 6px; }
  .sub { font-size: 13px; color: #667; margin-bottom: 20px; line-height: 1.5; }
  ul { list-style: none; border: 1px solid #e3e6ea; border-radius: 12px; padding: 14px 16px; margin-bottom: 20px; }
  li { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; font-size: 13px; color: #222; line-height: 1.45; }
  li .dot { width: 8px; height: 8px; border-radius: 50%; background: #1a7f5a; margin-top: 5px; flex-shrink: 0; }
  li code { display: inline-block; margin-top: 3px; font-size: 11px; color: #889; background: #f6f7f9; border-radius: 4px; padding: 1px 6px; }
  .notice { background: #fff7e6; border: 1px solid #ffe1a8; color: #8a5b00; font-size: 12px; line-height: 1.5; border-radius: 10px; padding: 10px 12px; margin-bottom: 20px; }
  .actions { display: flex; gap: 10px; }
  .btn { flex: 1; text-align: center; padding: 11px 0; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; transition: filter .15s; }
  .btn-cancel { background: #fff; border: 1px solid #d5d9de; color: #444; }
  .btn-allow { background: #111; color: #fff; }
  .btn:hover { filter: brightness(1.08); }
  .footer { margin-top: 18px; font-size: 11px; color: #99a; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="logo">${provider.emoji}</span>
      <div><h1>${esc(provider.name)}</h1><p>Sign in to continue</p></div>
    </div>
    <h2>The Lyceum wants to access your ${esc(provider.name)} account</h2>
    <p class="sub">This will let your Lyceum agents use ${esc(provider.name)} with the permissions below. You can disconnect any time from the workspace.</p>
    <ul>${scopeItems}</ul>
    <div class="notice"><strong>Sandbox connection.</strong> ${esc(
      `No ${provider.name} OAuth app is registered on this server yet, so this walks the real consent flow without touching a live account.`
    )}</div>
    <div class="actions">
      <a class="btn btn-cancel" href="${cancelUrl}">Cancel</a>
      <a class="btn btn-allow" href="${callbackUrl}">Allow</a>
    </div>
    <p class="footer">The Lyceum · governance layer for AI workforces</p>
  </div>
</body>
</html>`;
}

/**
 * What the callback page shows after a successful connect. In the normal
 * popup flow the window closes itself and the workspace (which was polling)
 * flips the card. The fallback link covers popup-blocked browsers.
 */
export function renderCallbackSuccessPage(providerName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0faf5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { background: #fff; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.1); padding: 36px; text-align: center; max-width: 360px; }
  .check { width: 52px; height: 52px; border-radius: 50%; background: #e6f6ee; color: #1a7f5a; font-size: 28px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; }
  h1 { font-size: 18px; color: #111; margin-bottom: 6px; }
  p { font-size: 13px; color: #667; line-height: 1.5; }
  a { display: inline-block; margin-top: 18px; color: #1a7f5a; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
  <div class="box">
    <div class="check">✓</div>
    <h1>${esc(providerName)} connected</h1>
    <p>You can close this window — your workspace has already updated.</p>
    <a href="/war-room">Return to workspace →</a>
  </div>
  <script>try { window.close(); } catch (e) {}</script>
</body>
</html>`;
}
