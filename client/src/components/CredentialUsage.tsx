import { useState } from "react";
import { Check, Copy } from "lucide-react";

/*
 * Shown on the Waiting page once a license key is issued — the two ways to
 * actually use it: a plain REST call (works from anywhere, incl. GPT
 * Actions / custom integrations) and an MCP entry for IDEs/Claude.
 */

function CodeBlock({ id, code }: { id: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative text-left">
      <pre className="rounded-lg border border-border bg-[#0f0f13] text-[11px] leading-relaxed text-white/90 px-4 py-3 overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        aria-label={`Copy ${id} snippet`}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-teal" /> : <Copy className="w-3.5 h-3.5 text-white/60" />}
      </button>
    </div>
  );
}

export function CredentialUsage({ licenseKey }: { licenseKey: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.thelyceum.site";

  const apiSnippet = `curl ${origin}/api/v1/chat \\
  -H "Authorization: Bearer ${licenseKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"domain":"TECH","prompt":"Summarize this PR diff"}'`;

  const mcpSnippet = `{
  "mcpServers": {
    "the-lyceum": {
      "url": "${origin}/api/mcp",
      "headers": { "Authorization": "Bearer ${licenseKey}" }
    }
  }
}`;

  return (
    <div className="text-left border-t border-border pt-6">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-4">
        Connect your license key
      </p>

      <p className="text-xs text-muted-foreground mb-2">
        <span className="font-medium text-foreground">API</span> — call it from anywhere (scripts, GPT Actions, your own backend):
      </p>
      <CodeBlock id="api" code={apiSnippet} />

      <p className="text-xs text-muted-foreground mt-4 mb-2">
        <span className="font-medium text-foreground">MCP</span> — add this to your IDE's MCP config (Claude Code, Claude Desktop, Cursor):
      </p>
      <CodeBlock id="mcp" code={mcpSnippet} />

      <p className="text-[10px] text-muted-foreground leading-relaxed mt-3">
        Domains: LAW, FINANCE, TECH, MUSE.
        <br />
        MCP tools — work: <code>assign_task</code>, <code>list_tasks</code>, <code>get_report</code>;
        your role &amp; spend: <code>register_role</code>, <code>list_roles</code>,{" "}
        <code>report_tokens</code>, <code>check_quota</code>; team progress:{" "}
        <code>create_mission</code>, <code>list_missions</code>, <code>update_mission_step</code>.
      </p>
    </div>
  );
}
