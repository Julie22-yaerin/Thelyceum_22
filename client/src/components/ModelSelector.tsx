/**
 * Model Selector — The Lyceum
 *
 * Displays per-domain model configuration in the NodeInspectorDrawer's Config tab.
 * For each domain (Law, Finance, Tech):
 *   - Dropdown to select any model from the OpenRouter catalog
 *   - Live pricing display (per-1K-tokens prompt & completion cost)
 *   - Cumulative USD spend for this session
 *   - "Apply to Domain" button
 *
 * When the domain model is changed, it persists to the Zustand store
 * (selectedModels) and updates the agent's config.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Coins,
  Check,
  AlertCircle,
  Loader2,
  Gavel,
  DollarSign,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useWorkforceStore,
  type Domain,
} from "@/store/useWorkforceStore";
import { MODEL_ROUTES } from "@/lib/modelConfig";
import {
  fetchModelCatalog,
  formatPricePer1K,
  formatUsd,
  type OpenRouterModel,
} from "@/lib/modelPricing";

// ── Domain presentation ──────────────────────────────────────────────────────

const DOMAIN_META: Record<
  Domain,
  { label: string; icon: React.ElementType; color: string; accent: string }
> = {
  LAW: {
    label: "Law",
    icon: Gavel,
    color: "text-purple-700",
    accent: "border-purple-200 bg-purple-50",
  },
  FINANCE: {
    label: "Finance",
    icon: DollarSign,
    color: "text-emerald-700",
    accent: "border-emerald-200 bg-emerald-50",
  },
  TECH: {
    label: "Tech",
    icon: Cpu,
    color: "text-cyan-700",
    accent: "border-cyan-200 bg-cyan-50",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Group models by their provider prefix (e.g. "anthropic", "openai", "google") */
function groupByProvider(models: OpenRouterModel[]): Map<string, OpenRouterModel[]> {
  const groups = new Map<string, OpenRouterModel[]>();
  for (const model of models) {
    const provider = model.id.split("/")[0] || "other";
    const list = groups.get(provider) || [];
    list.push(model);
    groups.set(provider, list);
  }
  return groups;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ModelSelectorProps {
  nodeId: string;
  /** The domain assigned to this agent */
  domain: Domain;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ModelSelector({ nodeId, domain }: ModelSelectorProps) {
  const { selectedModels, domainSpend, setDomainModel, recordDomainSpend } =
    useWorkforceStore();

  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string>(
    selectedModels[domain] || MODEL_ROUTES[domain].model,
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const meta = DOMAIN_META[domain];
  const Icon = meta.icon;

  // ── Fetch models on mount ──────────────────────────────────────────────

  const loadModels = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) setRefreshing(true);
      setLoading(true);
      setError(null);
      const catalog = await fetchModelCatalog(forceRefresh);
      setModels(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
      setModels([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  // Keep selected model ID in sync with store
  useEffect(() => {
    const storeOverride = selectedModels[domain];
    if (storeOverride) {
      setSelectedModelId(storeOverride);
    } else {
      setSelectedModelId(MODEL_ROUTES[domain].model);
    }
  }, [selectedModels, domain]);

  // ── Select model ───────────────────────────────────────────────────────

  const isDefaultModel =
    selectedModelId === MODEL_ROUTES[domain].model && !selectedModels[domain];

  const selectedModelInfo = models.find((m) => m.id === selectedModelId);

  const handleApply = () => {
    setDomainModel(domain, selectedModelId);
    setShowDropdown(false);

    // Simulate a call cost for demo purposes
    const promptCost = selectedModelInfo
      ? Number.parseFloat(selectedModelInfo.pricing.prompt) * 500
      : 0;
    const completionCost = selectedModelInfo
      ? Number.parseFloat(selectedModelInfo.pricing.completion) * 200
      : 0;
    const totalCost = promptCost + completionCost;
    recordDomainSpend(domain, totalCost);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const spend = domainSpend[domain] || 0;
  const groups = groupByProvider(models);

  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-200",
        meta.accent,
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-ws-subtle transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("w-3.5 h-3.5", meta.color)} />
          <span className="text-xs font-medium text-ws-text">{meta.label} Domain</span>
          {!isDefaultModel && (
            <Badge
              variant="outline"
              className="text-[8px] h-4 px-1 border-teal-200 text-teal-700"
            >
              Custom
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Model Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <p className="text-[9px] text-muted-foreground mb-1">Model</p>
            <button
              type="button"
              onClick={() => !loading && setShowDropdown(!showDropdown)}
              disabled={loading}
              className={cn(
                "w-full h-8 flex items-center justify-between px-2.5 rounded-md text-xs transition-colors",
                "bg-ws-subtle border border-ws-border hover:border-ws-border",
                loading && "opacity-50 cursor-wait",
              )}
            >
              {loading ? (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading models...
                </span>
              ) : selectedModelInfo ? (
                <span className="text-ws-text truncate">{selectedModelInfo.name}</span>
              ) : (
                <span className="text-muted-foreground truncate">{selectedModelId}</span>
              )}
              <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 ml-1" />
            </button>

            {/* Dropdown */}
            {showDropdown && !loading && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-64 rounded-md border border-ws-border bg-ws-hover shadow-2xl overflow-hidden">
                <div className="overflow-y-auto max-h-64">
                  {models.length === 0 ? (
                    <div className="p-3 text-center text-[10px] text-muted-foreground">
                      {error ? "Failed to load models" : "No models available"}
                    </div>
                  ) : (
                    Array.from(groups.entries()).map(([provider, providerModels]) => (
                      <div key={provider}>
                        <div className="px-2.5 py-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider bg-ws-subtle">
                          {provider}
                        </div>
                        {providerModels.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              setSelectedModelId(model.id);
                              setShowDropdown(false);
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-left hover:bg-ws-hover transition-colors",
                              model.id === selectedModelId && "bg-teal-50 text-teal-700",
                            )}
                          >
                            <span className="flex-1 truncate">{model.name}</span>
                            <span className="text-[9px] text-muted-foreground shrink-0">
                              {formatPricePer1K(model.pricing.prompt)} / {formatPricePer1K(model.pricing.completion)}
                            </span>
                            {model.id === selectedModelId && (
                              <Check className="w-3 h-3 text-teal-700 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Pricing Info */}
          {selectedModelInfo && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-ws-subtle border border-ws-border rounded-md px-2 py-1.5">
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-0.5">
                  Prompt /1K
                </p>
                <p className="text-xs font-mono text-ws-text">
                  {formatPricePer1K(selectedModelInfo.pricing.prompt)}
                </p>
              </div>
              <div className="bg-ws-subtle border border-ws-border rounded-md px-2 py-1.5">
                <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-0.5">
                  Completion /1K
                </p>
                <p className="text-xs font-mono text-ws-text">
                  {formatPricePer1K(selectedModelInfo.pricing.completion)}
                </p>
              </div>
            </div>
          )}

          {/* Cumulative Spend */}
          <div className="flex items-center justify-between bg-ws-subtle border border-ws-border rounded-md px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3 h-3 text-amber-700" />
              <span className="text-[10px] text-muted-foreground">Session Spend</span>
            </div>
            <span className="text-xs font-mono text-ws-text">{formatUsd(spend)}</span>
          </div>

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-1.5 text-[9px] text-red-700">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>Failed to load pricing — using default rates</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[9px] flex-1 text-muted-foreground hover:text-ws-text hover:bg-ws-hover"
              onClick={() => loadModels(true)}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn(
                  "w-3 h-3 mr-1",
                  refreshing && "animate-spin",
                )}
              />
              {refreshing ? "Refreshing..." : "Refresh Prices"}
            </Button>
            <Button
              size="sm"
              className={cn(
                "h-7 text-[9px] flex-1 transition-all",
                isDefaultModel
                  ? "bg-ws-subtle text-muted-foreground cursor-not-allowed"
                  : "bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100",
              )}
              onClick={handleApply}
              disabled={isDefaultModel}
            >
              <Check className="w-3 h-3 mr-1" />
              Apply to {meta.label}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
