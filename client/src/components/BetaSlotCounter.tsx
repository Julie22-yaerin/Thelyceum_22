import { useEffect, useState } from "react";

/*
 * Live "Beta Slots Claimed" counter — backed by GET /api/beta-slots
 * (server/index.ts), which counts real paid orders on top of a manual
 * baseline. Not a fake ticking number.
 */

export default function BetaSlotCounter() {
  const [data, setData] = useState<{ claimed: number; cap: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/beta-slots");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // keep last known value on failure
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const claimed = data?.claimed ?? 84;
  const cap = data?.cap ?? 100;
  const pct = Math.min(100, Math.round((claimed / cap) * 100));

  return (
    <div className="inline-block w-full max-w-sm">
      <div className="flex items-baseline justify-between mb-2 font-mono">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          [ {claimed} / {cap} Beta Slots Claimed ]
        </span>
        <span className="text-xs text-teal font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full bg-teal transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
        Capped by server capacity, not marketing — every seat over the limit adds
        latency to the Adaptive Audit Engine. We hold the line at {cap} to keep
        response times under 1000ms for every team.
      </p>
    </div>
  );
}
