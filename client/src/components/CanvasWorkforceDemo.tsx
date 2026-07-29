/**
 * CanvasWorkforceDemo — Calm, serene workspace preview
 *
 * Slower orbits, fewer agents, no live activity feed.
 * Peaceful visual that suggests capability without chaos.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import OrbitCanvas from "./OrbitCanvas";
import type { OrbitCanvasAgent, OrbitCanvasConnection, OrbitCanvasAgentMeta } from "./OrbitCanvas";

// ── Agent definitions (slower orbits, fewer agents) ─────────────────────────

const AGENTS: OrbitCanvasAgent[] = [
  { id: "a1", label: "Data Scout AI", type: "ai", orbitRadius: 170, speed: 0.0006, color: "#0d9488", size: 16 },
  { id: "a2", label: "CodeForge AI", type: "ai", orbitRadius: 220, speed: -0.0005, color: "#6366f1", size: 18 },
  { id: "a3", label: "ReviewBot AI", type: "ai", orbitRadius: 190, speed: 0.0008, color: "#f59e0b", size: 14 },
  { id: "a4", label: "Insight AI", type: "ai", orbitRadius: 250, speed: -0.0004, color: "#ec4899", size: 15 },
  { id: "a5", label: "Alex Chen", type: "human", orbitRadius: 150, speed: 0.0005, color: "#94a3b8", size: 12 },
  { id: "a6", label: "Jordan Lee", type: "human", orbitRadius: 240, speed: -0.0003, color: "#94a3b8", size: 12 },
];

const CONNECTIONS: OrbitCanvasConnection[] = [
  { from: 0, to: 2, hue: 160 },
  { from: 1, to: 3, hue: 230 },
  { from: 0, to: 4, hue: 180 },
  { from: 1, to: 5, hue: 200 },
  { from: 2, to: 0, hue: 140 },
];

const AGENT_META: Record<string, OrbitCanvasAgentMeta> = {
  a1: { role: "Market Research Agent", status: "Analyzing competitors", lastAction: "Completed landscape report" },
  a2: { role: "Code Generation Agent", status: "Building API module", lastAction: "Generated rate limiter" },
  a3: { role: "Code Review Agent", status: "Reviewing PR #247", lastAction: "Flagged auth vulnerability" },
  a4: { role: "Lead Scoring Agent", status: "Scoring pipeline", lastAction: "Scored 47 new leads" },
  a5: { role: "Marketing Lead", status: "Online — campaign review", lastAction: "Approved Q3 creative brief" },
  a6: { role: "Engineering Lead", status: "Online — code review", lastAction: "Reviewed PR #247" },
};

// ── Static seed activities (no live updates) ────────────────────────────────

interface ActivityEvent {
  id: number;
  text: string;
  agent: string;
  type: "ai" | "human";
  timestamp: string;
}

const SEED_ACTIVITIES: ActivityEvent[] = [
  { id: 1, text: "completed market analysis for Q3", agent: "Data Scout AI", type: "ai", timestamp: "9:42 AM" },
  { id: 2, text: "scored 47 new enterprise leads", agent: "Insight AI", type: "ai", timestamp: "9:38 AM" },
  { id: 3, text: "approved campaign creative brief", agent: "Alex Chen", type: "human", timestamp: "9:31 AM" },
  { id: 4, text: "passed security audit for deployment", agent: "ReviewBot AI", type: "ai", timestamp: "9:22 AM" },
  { id: 5, text: "reviewed PR #247 from CodeForge", agent: "Jordan Lee", type: "human", timestamp: "9:15 AM" },
];

// ── Component ───────────────────────────────────────────────────────────────

export default function CanvasWorkforceDemo({
  onNavigateToWorkspace,
}: {
  onNavigateToWorkspace?: () => void;
}) {
  const [selectedAgentIndex, setSelectedAgentIndex] = useState<number | null>(null);
  const [activities] = useState<ActivityEvent[]>(SEED_ACTIVITIES);
  const feedEndRef = useRef<HTMLDivElement>(null);

  // One-time scroll to bottom
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  const handleAgentClick = useCallback((index: number) => {
    setSelectedAgentIndex((prev) => (index >= 0 ? (prev === index ? null : index) : null));
  }, []);

  return (
    <div
      style={{
        width: "100%",
        background: "#fff",
        padding: "24px 24px 0",
        maxWidth: 1100,
        margin: "0 auto",
        position: "relative",
      }}
    >
      {/* ── Title ──────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <p style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 500, fontSize: 11,
          textTransform: "uppercase", letterSpacing: "0.1em", color: "#888", marginBottom: 8,
        }}>
          Live Demo
        </p>
        <h2 style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 600,
          fontSize: "clamp(1.25rem, 3vw, 1.75rem)", color: "#111",
          letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: 8,
        }}>
          Your AI Workforce in Action
        </h2>
        <p style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 400, fontSize: 13,
          color: "#888", maxWidth: 480, margin: "0 auto", lineHeight: 1.6,
        }}>
          Humans and AI agents collaborating in a simulated enterprise workspace.
        </p>
      </div>

      {/* ── OrbitCanvas ────────────────────────────────────────────────── */}
      <OrbitCanvas
        config={{
          agents: AGENTS,
          connections: CONNECTIONS,
          agentMeta: AGENT_META,
          orbitalRings: [140, 190, 240],
        }}
        selectedAgentIndex={selectedAgentIndex}
        onAgentClick={handleAgentClick}
        minHeight={320}
        maxHeight={500}
        renderTooltip={({ agent, meta, x, y }, cy) => {
          if (!meta) return null;
          const isAI = agent.type === "ai";
          const above = y > cy;

          return (
            <div
              style={{
                position: "absolute",
                left: x,
                top: above ? y - 10 : y + 10,
                pointerEvents: "auto",
                transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
                zIndex: 20,
              }}
            >
              {/* Arrow */}
              <div
                style={{
                  position: "absolute",
                  [above ? "bottom" : "top"]: -4,
                  left: "50%",
                  marginLeft: -4,
                  width: 8, height: 8,
                  background: "#1e1e36",
                  borderLeft: "1px solid rgba(255,255,255,0.1)",
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  transform: above ? "rotate(225deg)" : "rotate(45deg)",
                }}
              />

              {/* Card */}
              <div
                style={{
                  background: "#1e1e36",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  padding: 0,
                  minWidth: 200,
                  maxWidth: 240,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                  overflow: "hidden",
                }}
              >
                <div style={{ height: 3, background: isAI ? agent.color : "#64748b" }} />
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div
                        style={{
                          width: 22, height: 22, borderRadius: "50%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10,
                          background: isAI
                            ? `linear-gradient(135deg, ${agent.color}, ${agent.color}cc)`
                            : "linear-gradient(135deg, #64748b, #475569)",
                          color: "#fff", fontWeight: 500, fontFamily: "'Inter', sans-serif",
                        }}
                      >
                        {isAI ? "◆" : "●"}
                      </div>
                      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                        {agent.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "'Inter', sans-serif", fontSize: 8, fontWeight: 500,
                        padding: "2px 6px", borderRadius: 4,
                        background: isAI ? `${agent.color}25` : "rgba(148,163,184,0.15)",
                        color: isAI ? agent.color : "rgba(255,255,255,0.5)",
                      }}
                    >
                      {isAI ? "AI Agent" : "Human"}
                    </span>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 2 }}>
                      Role
                    </span>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                      {meta.role}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)", marginBottom: 6 }}>
                    <span
                      style={{
                        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                        background: isAI ? agent.color : "#22c55e",
                      }}
                    />
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.6)" }}>
                      {meta.status}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 2 }}>
                      Last Action
                    </span>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>
                      {meta.lastAction}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
        overlay={
          <>
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 16px", pointerEvents: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: "linear-gradient(135deg, #0d9488, #0f766e)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, color: "#fff", fontWeight: 600, fontFamily: "'Inter', sans-serif",
                  }}
                >
                  L
                </div>
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                  The Lyceum
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(13,148,136,0.15)", borderRadius: 9999, padding: "3px 10px", border: "1px solid rgba(13,148,136,0.25)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0d9488" }} />
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 500, color: "#0d9488" }}>DEMO</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.06)", borderRadius: 6, padding: "4px 8px" }}>
                  <span style={{ fontSize: 11 }}>⚡</span>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>247/500</span>
                </div>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 16px", background: "rgba(22,22,42,0.85)",
                borderTop: "1px solid rgba(255,255,255,0.05)",
                backdropFilter: "blur(8px)", pointerEvents: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>👤</span>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.4)" }}>
                    <span style={{ color: "rgba(255,255,255,0.7)" }}>2</span> Humans ·{" "}
                    <span style={{ color: "#0d9488" }}>4</span> AI Agents
                  </span>
                </div>
                <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.08)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>✓</span>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, color: "rgba(255,255,255,0.4)" }}>
                    <span style={{ color: "rgba(255,255,255,0.7)" }}>5</span> tasks completed
                  </span>
                </div>
              </div>

              <button
                onClick={onNavigateToWorkspace}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 6, fontSize: 8,
                  fontWeight: 500, fontFamily: "'Inter', sans-serif",
                  background: "linear-gradient(135deg, rgba(13,148,136,0.2), rgba(16,185,129,0.2))",
                  color: "#0d9488", border: "1px solid rgba(13,148,136,0.3)",
                  cursor: "pointer", transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(13,148,136,0.3), rgba(16,185,129,0.3))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, rgba(13,148,136,0.2), rgba(16,185,129,0.2))"; }}
              >
                Real Workspace →
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#94a3b8" }} />
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, color: "rgba(148,163,184,0.4)" }}>Simulated</span>
              </div>
            </div>
          </>
        }
      />

      {/* ── Activity Feed (static, right side) ──────────────────────────── */}
      <div
        style={{
          position: "absolute",
          top: 44,
          right: 0,
          bottom: 36,
          width: 200,
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "none",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)",
            pointerEvents: "auto",
          }}
        >
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, fontWeight: 500, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Activity
          </span>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>
            {activities.length} events
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px", pointerEvents: "auto" }}>
          {activities.map((event) => (
            <div
              key={event.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 6,
                padding: "4px 6px", borderRadius: 4, marginBottom: 2,
              }}
            >
              <span
                style={{
                  width: 16, height: 16, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, flexShrink: 0, marginTop: 1,
                  background: event.type === "ai"
                    ? "linear-gradient(135deg, #0d9488, #0f766e)"
                    : "linear-gradient(135deg, #64748b, #475569)",
                  color: "#fff", fontWeight: 500, fontFamily: "'Inter', sans-serif",
                }}
              >
                {event.type === "ai" ? "◆" : "●"}
              </span>
              <div>
                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, lineHeight: 1.4, color: "rgba(255,255,255,0.65)", margin: 0 }}>
                  <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{event.agent}</span>{" "}
                  {event.text}
                </p>
                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 6, color: "rgba(255,255,255,0.2)", margin: "1px 0 0" }}>
                  {event.timestamp}
                </p>
              </div>
            </div>
          ))}
          <div ref={feedEndRef} />
        </div>
      </div>
    </div>
  );
}
