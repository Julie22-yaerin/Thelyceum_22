/**
 * AlertDashboard — The Lyceum Enterprise Hub
 *
 * Real-time dashboard showing:
 *   - Agent status overview (green/yellow/red per agent)
 *   - Active alerts with severity badges and dismiss actions
 *   - Domain budget usage bars with 50%/80%/100% thresholds
 *   - MCP connection status
 *   - Total team spend to-date
 *
 * This is the "central management console" for the AI workforce.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Coins,
  Gavel,
  DollarSign,
  Cpu,
  X,
  RefreshCw,
  Loader2,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useMCPClient } from "@/hooks/useMCPClient";
import {
  useWorkforceStore,
  type AgentData,
  type Alert,
  type AlertSeverity,
  type Domain,
  DOMAINS,
  type AgentStatus,
} from "@/store/useWorkforceStore";

// ── Constants ────────────────────────────────────────────────────────────────

const DOMAIN_META: Record<Domain, { label: string; icon: React.ElementType; color: string }> = {
  LAW: { label: "Law", icon: Gavel, color: "text-purple-400" },
  FINANCE: { label: "Finance", icon: DollarSign, color: "text-emerald-400" },
  TECH: { label: "Tech", icon: Cpu, color: "text-cyan-400" },
};

const STATUS_META: Record<AgentStatus, { label: string; color: string; bg: string }> = {
  AWAKE_WORKING: { label: "Working", color: "text-green-400", bg: "bg-green-500/15" },
  DROWSY_WARNING: { label: "Low Funds", color: "text-yellow-400", bg: "bg-yellow-500/15" },
  ON_STRIKE_ASLEEP: { label: "On Strike", color: "text-red-400", bg: "bg-red-500/15" },
};

const SEVERITY_META: Record<AlertSeverity, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-500/15", icon: AlertTriangle },
  warning: { label: "Warning", color: "text-yellow-400", bg: "bg-yellow-500/15", icon: AlertTriangle },
  info: { label: "Info", color: "text-blue-400", bg: "bg-blue-500/15", icon: Bell },
};

const MCP_URL = `ws://${window.location.hostname}:${window.location.port || "5173"}/mcp`;

// ── Sub-Components ───────────────────────────────────────────────────────────

function AgentStatusCard({ agent }: { agent: AgentData & { id: string } }) {
  const status = STATUS_META[agent.status];
  const domain = useWorkforceStore((s) => s.agentDomains[agent.id]);
  const pct = agent.wallet.budgetLimit > 0
    ? Math.round((agent.wallet.balance / agent.wallet.budgetLimit) * 100)
    : 0;

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
      {/* Status dot */}
      <div className={cn("w-2 h-2 rounded-full shrink-0", status.color.replace("text-", "bg-"))} />

      {/* Name + role */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-white truncate">{agent.label}</span>
          {domain && (
            <span className={cn("text-[8px]", DOMAIN_META[domain]?.color)}>
              {DOMAIN_META[domain]?.label}
            </span>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground truncate">{agent.role}</p>
      </div>

      {/* Token bar */}
      <div className="w-14">
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              pct > 20 ? "bg-green-500" : pct > 0 ? "bg-yellow-500" : "bg-red-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={cn("text-[8px] text-right mt-0.5", status.color)}>
          {status.label}
        </p>
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  onDismiss,
}: {
  alert: Alert;
  onDismiss: (id: string) => void;
}) {
  const meta = SEVERITY_META[alert.severity];
  const Icon = meta.icon;
  const timeAgo = formatRelativeTime(alert.timestamp);

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-2.5 py-2 rounded-md border transition-all",
        alert.dismissed
          ? "opacity-40 border-white/5"
          : "bg-white/[0.02] border-white/10",
      )}
    >
      <Icon className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", meta.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-white/90">{alert.title}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-[7px] h-3.5 px-1",
              meta.color,
              meta.bg,
            )}
          >
            {meta.label}
          </Badge>
        </div>
        <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">
          {alert.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Clock className="w-2.5 h-2.5 text-muted-foreground/60" />
          <span className="text-[8px] text-muted-foreground/60">{timeAgo}</span>
          {alert.domain && (
            <span className={cn("text-[8px]", DOMAIN_META[alert.domain]?.color)}>
              {DOMAIN_META[alert.domain]?.label}
            </span>
          )}
        </div>
      </div>
      {!alert.dismissed && (
        <button
          type="button"
          onClick={() => onDismiss(alert.id)}
          className="text-muted-foreground/50 hover:text-white transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function BudgetUsageBar({ domain }: { domain: Domain }) {
  const { domainSpend, budgetCaps } = useWorkforceStore();
  const meta = DOMAIN_META[domain];
  const Icon = meta.icon;
  const spend = domainSpend[domain] || 0;
  const cap = budgetCaps[domain]?.cap || 1;
  const ratio = Math.min(spend / cap, 1);
  const pct = Math.round(ratio * 100);

  const barColor =
    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : pct >= 50 ? "bg-amber-500" : "bg-green-500";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("w-3 h-3", meta.color)} />
          <span className="text-[9px] text-white/70">{meta.label}</span>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          ${spend.toFixed(1)} / ${cap}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[7px] text-green-500/60">50%</span>
        <span className="text-[7px] text-yellow-500/60">80%</span>
        <span className="text-[7px] text-red-500/60">100%</span>
      </div>
    </div>
  );
}

function MCPStatusBadge() {
  const mcp = useMCPClient();
  const [checking, setChecking] = useState(true);

  const connectedRef = useRef(false);

  useEffect(() => {
    if (connectedRef.current || mcp.status === "connected") {
      setChecking(false);
      return;
    }
    connectedRef.current = true;
    mcp.connect(MCP_URL).catch(() => setChecking(false));
  }, [mcp.status]);

  const statusColor =
    mcp.status === "connected"
      ? "text-green-400 border-green-500/30 bg-green-500/10"
      : mcp.status === "connecting"
        ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
        : "text-red-400 border-red-500/30 bg-red-500/10";

  const StatusIcon = mcp.status === "connected" ? Wifi : mcp.status === "connecting" ? Loader2 : WifiOff;

  return (
    <Badge variant="outline" className={cn("text-[9px] px-2 py-0.5 gap-1", statusColor)}>
      <StatusIcon className={cn("w-2.5 h-2.5", mcp.status === "connecting" && "animate-spin")} />
      {mcp.status === "connected"
        ? "MCP Live"
        : mcp.status === "connecting"
          ? "Connecting..."
          : checking
            ? "Checking..."
            : "MCP Offline"}
    </Badge>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AlertDashboard() {
  const {
    nodes,
    alerts,
    domainSpend,
    dismissAlert,
    dismissAllAlerts,
    checkBudgetThresholds,
    alertsPanelOpen,
    setAlertsPanelOpen,
    getTotalTokenBurn,
  } = useWorkforceStore();

  const activeAlerts = alerts.filter((a) => !a.dismissed);
  const totalBurn = getTotalTokenBurn();
  const totalSpend = Object.values(domainSpend).reduce((s, v) => s + v, 0);

  // Check budget thresholds on mount and when spend changes
  useEffect(() => {
    if (alertsPanelOpen) {
      checkBudgetThresholds();
    }
  }, [alertsPanelOpen, domainSpend, checkBudgetThresholds]);

  if (!alertsPanelOpen) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-500/15 flex items-center justify-center">
              <Bell className="w-3 h-3 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">Enterprise Hub</h3>
              <p className="text-[8px] text-muted-foreground">Central AI Workforce Management</p>
            </div>
          </div>
          <MCPStatusBadge />
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          <div className="bg-white/[0.03] rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] font-mono text-white/90">{totalBurn.toLocaleString()}</p>
            <p className="text-[7px] text-muted-foreground">Tokens Burned</p>
          </div>
          <div className="bg-white/[0.03] rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] font-mono text-white/90">${totalSpend.toFixed(1)}</p>
            <p className="text-[7px] text-muted-foreground">Total Spend</p>
          </div>
          <div className="bg-white/[0.03] rounded-md px-2 py-1.5 text-center">
            <p className="text-[9px] font-mono text-white/90">{activeAlerts.length}</p>
            <p className="text-[7px] text-muted-foreground">Active Alerts</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Agent Status Overview */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-medium text-white/70 flex items-center gap-1">
                <UserCheck className="w-3 h-3" />
                Agent Fleet Status
              </h4>
              <span className="text-[8px] text-muted-foreground">
                {nodes.filter((n) => n.data.status === "AWAKE_WORKING").length}/{nodes.length} active
              </span>
            </div>
            <div className="space-y-1">
              {nodes.map((node) => (
                <AgentStatusCard
                  key={node.id}
                  agent={{ ...node.data, id: node.id }}
                />
              ))}
            </div>
          </section>

          <Separator className="bg-white/5" />

          {/* Domain Budget Usage */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-medium text-white/70 flex items-center gap-1">
                <Coins className="w-3 h-3" />
                Domain Budget Usage
              </h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[8px] text-muted-foreground hover:text-white"
                onClick={checkBudgetThresholds}
              >
                <RefreshCw className="w-2.5 h-2.5 mr-1" />
                Check
              </Button>
            </div>
            <div className="space-y-2.5">
              {DOMAINS.map((domain) => (
                <BudgetUsageBar key={domain} domain={domain} />
              ))}
            </div>
          </section>

          <Separator className="bg-white/5" />

          {/* Active Alerts */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-medium text-white/70 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Alerts & Notifications
              </h4>
              {activeAlerts.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[8px] text-muted-foreground hover:text-white"
                  onClick={dismissAllAlerts}
                >
                  <BellOff className="w-2.5 h-2.5 mr-1" />
                  Dismiss All
                </Button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 className="w-5 h-5 text-green-500/40 mx-auto mb-1.5" />
                <p className="text-[10px] text-muted-foreground">No alerts. All systems nominal.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {alerts.slice(0, 20).map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onDismiss={dismissAlert}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
