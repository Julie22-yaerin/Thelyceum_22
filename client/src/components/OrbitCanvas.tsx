/**
 * OrbitCanvas — Generic Reusable Canvas Orbital Visualization
 *
 * Extracted from CanvasWorkforceDemo. Encapsulates:
 * - Canvas render loop (nodes, connections, particles, core, orbital rings)
 * - Hit-testing for node clicks
 * - Tooltip overlay rendering via render prop
 *
 * The consumer manages selection state (`selectedAgentIndex` + `onAgentClick`)
 * so it can react to clicks (e.g. show related info in a sidebar).
 *
 * Zero scroll impact — pure requestAnimationFrame canvas rendering.
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";

// ── Public Types ────────────────────────────────────────────────────────────

export interface OrbitCanvasAgent {
  id: string;
  label: string;
  type: "ai" | "human";
  orbitRadius: number;
  speed: number;
  color: string;
  size: number;
}

export interface OrbitCanvasConnection {
  from: number;
  to: number;
  hue: number;
}

export interface OrbitCanvasAgentMeta {
  role: string;
  status: string;
  lastAction: string;
}

export interface OrbitCanvasConfig {
  agents: OrbitCanvasAgent[];
  connections: OrbitCanvasConnection[];
  agentMeta?: Record<string, OrbitCanvasAgentMeta>;
  coreColor?: string;
  backgroundColor?: string;
  gridColor?: string;
  gridSize?: number;
  orbitalRings?: number[];
  centerXFraction?: number;
  initialAngles?: number[];
}

export interface OrbitCanvasTooltipData {
  agent: OrbitCanvasAgent;
  meta: OrbitCanvasAgentMeta | undefined;
  x: number;
  y: number;
}

interface OrbitCanvasProps {
  config: OrbitCanvasConfig;
  /** Current selected agent index, or -1/null for none. Managed by consumer. */
  selectedAgentIndex?: number | null;
  /** Called when a node is clicked (index >= 0) or empty space is clicked (index = -1). */
  onAgentClick?: (agentIndex: number) => void;
  /**
   * Called when the mouse moves within `hoverRadius` px of a node.
   * Fires with the agent data on proximity, or `null` when the mouse moves away.
   * Use this for hover previews, highlights, or preview tooltips.
   */
  onHoverAgent?: ((data: OrbitCanvasTooltipData | null) => void) | null;
  /**
   * Distance in px from a node's center that triggers the hover callback.
   * Default: 40 (node.size + padding).
   */
  hoverRadius?: number;
  /**
   * Renders the tooltip content for a selected agent.
   * If not provided, no tooltip is rendered.
   * The returned element is positioned automatically near the node.
   * `cy` is the vertical center of the canvas (for flip logic).
   */
  renderTooltip?: ((data: OrbitCanvasTooltipData, cy: number) => ReactNode) | null;
  /** Optional content overlaid on top of the canvas (e.g. top bar, status bar).
   *  Receives the canvas height so it can size itself correctly. */
  overlay?: ReactNode;
  /** Minimum canvas height (default: 320) */
  minHeight?: number;
  /** Maximum canvas height (default: 560) */
  maxHeight?: number;
  /** Aspect ratio: height = width * ratio (default: 0.55) */
  aspectRatio?: number;
}

interface InternalAgent extends OrbitCanvasAgent {
  angle: number;
  pulsePhase: number;
}

interface PositionedAgent {
  x: number;
  y: number;
  agent: InternalAgent;
}

interface Particle {
  t: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hue: number;
  speed: number;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function OrbitCanvas({
  config,
  selectedAgentIndex = null,
  onAgentClick,
  onHoverAgent,
  hoverRadius = 40,
  renderTooltip,
  overlay,
  minHeight = 320,
  maxHeight = 560,
  aspectRatio = 0.55,
}: OrbitCanvasProps) {
  const {
    agents: agentDefs,
    connections,
    agentMeta,
    coreColor = "#0d9488",
    backgroundColor = "#1a1a2e",
    gridColor = "rgba(255,255,255,0.03)",
    gridSize = 24,
    orbitalRings = [140, 180, 210],
    centerXFraction = 0.38,
    initialAngles,
  } = config;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<InternalAgent[]>([]);
  const nodePositionsRef = useRef<PositionedAgent[]>([]);
  const timeRef = useRef(0);
  const rafRef = useRef(0);
  const dimsRef = useRef({ w: 0, h: 0, cx: 0, cy: 0 });
  const [dimensions, setDimensions] = useState({ w: 800, h: 500 });
  // Tracks the last hovered agent index to avoid duplicate onHoverAgent(null) calls
  const lastHoverRef = useRef<number | null>(null);
  // Throttle mousemove checks to ~12fps (83ms)
  const hoverThrottleRef = useRef(0);

  // ── Responsive sizing ─────────────────────────────────────────────────

  const updateSize = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width;
    const h = Math.min(Math.max(w * aspectRatio, minHeight), maxHeight);
    setDimensions({ w, h });
    dimsRef.current = { w, h, cx: w * centerXFraction, cy: h * 0.5 };
  }, [aspectRatio, minHeight, maxHeight, centerXFraction]);

  useEffect(() => {
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [updateSize]);

  // ── Initialize nodes ──────────────────────────────────────────────────

  useEffect(() => {
    nodesRef.current = agentDefs.map((agent, i) => ({
      ...agent,
      angle: initialAngles?.[i] ?? ((i / agentDefs.length) * Math.PI * 2 + Math.random() * 0.5),
      pulsePhase: Math.random() * Math.PI * 2,
    }));
  }, [agentDefs, initialAngles]);

  // ── Canvas Render Loop ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = dimensions;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const cx = w * centerXFraction;
    const cy = h * 0.5;
    dimsRef.current = { w, h, cx, cy };

    let particles: Particle[] = [];

    const render = (timestamp: number) => {
      timeRef.current = timestamp;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, w, h);

      // Dot grid
      ctx.fillStyle = gridColor;
      for (let x = 0; x < w; x += gridSize) {
        for (let y = 0; y < h; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Update node positions
      const nodes = nodesRef.current;
      const positions = nodes.map((node) => {
        const angle = node.angle + timeRef.current * node.speed;
        return {
          x: cx + Math.cos(angle) * node.orbitRadius,
          y: cy + Math.sin(angle) * node.orbitRadius,
          agent: node,
        };
      });
      nodePositionsRef.current = positions;

      // Connections
      connections.forEach((conn) => {
        const a = positions[conn.from];
        const b = positions[conn.to];
        if (!a || !b) return;

        const pulse = 0.3 + 0.7 * Math.abs(Math.sin(timeRef.current * 0.001 + conn.hue));

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2 - 30;
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.strokeStyle = `hsla(${conn.hue}, 60%, 55%, ${pulse * 0.25})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        particles.push({
          t: 0,
          from: { x: a.x, y: a.y },
          to: { x: b.x, y: b.y },
          hue: conn.hue,
          speed: 0.008 + Math.random() * 0.006,
        });
      });        // Flowing particles — calmer: fewer, slower, smaller
      const aliveParticles: Particle[] = [];
      particles.forEach((p) => {
        p.t += p.speed;
        if (p.t >= 1) return;

        const t = p.t;
        const x =
          (1 - t) * (1 - t) * p.from.x +
          2 * (1 - t) * t * ((p.from.x + p.to.x) / 2 - 30) +
          t * t * p.to.x;
        const y =
          (1 - t) * (1 - t) * p.from.y +
          2 * (1 - t) * t * ((p.from.y + p.to.y) / 2 - 30) +
          t * t * p.to.y;

        if (Math.random() > 0.15) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 2.5);
          glow.addColorStop(0, `hsla(${p.hue}, 60%, 60%, ${(1 - p.t) * 0.6})`);
          glow.addColorStop(1, `hsla(${p.hue}, 60%, 60%, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        aliveParticles.push(p);
      });

      if (aliveParticles.length > 20) {
        aliveParticles.splice(0, aliveParticles.length - 20);
      }
      particles = aliveParticles;

      // Central core
      const corePulse = 0.92 + 0.08 * Math.sin(timeRef.current * 0.001);
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
      const ca = (v: number) => `${Math.round(v * 255).toString(16).padStart(2, "0")}`;
      coreGlow.addColorStop(0, `${coreColor}${ca(0.3 * corePulse)}`);
      coreGlow.addColorStop(0.4, `${coreColor}${ca(0.1 * corePulse)}`);
      coreGlow.addColorStop(1, `${coreColor}00`);
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, 60, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = `${coreColor}${ca(0.6 * corePulse)}`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.strokeStyle = `${coreColor}${ca(0.15 * corePulse)}`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Orbital rings
      orbitalRings.forEach((radius) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Agent nodes
      positions.forEach(({ x, y, agent }) => {
        const pulse = 0.92 + 0.08 * Math.sin(timeRef.current * 0.001 + agent.pulsePhase);
        const size = agent.size * pulse;
        const isAI = agent.type === "ai";

        const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
        if (isAI) {
          glow.addColorStop(0, `${agent.color}40`);
          glow.addColorStop(1, "transparent");
        } else {
          glow.addColorStop(0, "rgba(148,163,184,0.15)");
          glow.addColorStop(1, "transparent");
        }
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        if (isAI) {
          const grad = ctx.createRadialGradient(x - size * 0.3, y - size * 0.3, 0, x, y, size);
          grad.addColorStop(0, agent.color);
          grad.addColorStop(1, `${agent.color}99`);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = "rgba(148,163,184,0.7)";
        }
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = isAI ? `${size * 0.7}px sans-serif` : `${size * 0.55}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isAI ? "◆" : "●", x, y + 1);

        ctx.fillStyle = `rgba(255,255,255,${0.35 * pulse})`;
        ctx.font = "9px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(agent.label, x, y + size + 6);
      });

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [dimensions, connections, backgroundColor, gridColor, gridSize, orbitalRings, centerXFraction, coreColor]);

  // ── Click handler ─────────────────────────────────────────────────────

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onAgentClick) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const positions = nodePositionsRef.current;
      for (let i = 0; i < positions.length; i++) {
        const { x, y, agent } = positions[i];
        const dist = Math.sqrt((clickX - x) ** 2 + (clickY - y) ** 2);
        if (dist <= agent.size + 8) {
          onAgentClick(i);
          return;
        }
      }
      onAgentClick(-1);
    },
    [onAgentClick],
  );

  // ── Hover handler (throttled) ─────────────────────────────────────────

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onHoverAgent) return;

      // Throttle: skip if last check was < 80ms ago
      const now = performance.now();
      if (now - hoverThrottleRef.current < 80) return;
      hoverThrottleRef.current = now;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const positions = nodePositionsRef.current;

      let hitIndex: number | null = null;
      for (let i = 0; i < positions.length; i++) {
        const { x, y, agent } = positions[i];
        // Larger hover radius than click radius — easier to trigger
        const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);
        // Check against configurable hoverRadius, but at minimum the agent's visual size
        const effectiveRadius = Math.max(hoverRadius, agent.size + 6);
        if (dist <= effectiveRadius) {
          hitIndex = i;
          break;
        }
      }

      // Only fire the callback if the hover target changed
      if (hitIndex !== lastHoverRef.current) {
        lastHoverRef.current = hitIndex;
        if (hitIndex !== null) {
          const pos = positions[hitIndex];
          const meta = agentMeta?.[pos.agent.id];
          onHoverAgent({ agent: pos.agent, meta, x: pos.x, y: pos.y });
        } else {
          onHoverAgent(null);
        }
      }
    },
    [onHoverAgent, hoverRadius, agentMeta],
  );

  /** Fire null when the mouse leaves the canvas — clear the hover. */
  const handleCanvasMouseLeave = useCallback(() => {
    if (lastHoverRef.current !== null) {
      lastHoverRef.current = null;
      onHoverAgent?.(null);
    }
  }, [onHoverAgent]);

  // ── Keyboard close ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedAgentIndex != null && selectedAgentIndex >= 0) {
        onAgentClick?.(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedAgentIndex, onAgentClick]);

  // ── Outside click close ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (selectedAgentIndex == null || selectedAgentIndex < 0) return;
      const target = e.target as HTMLElement;
      if (containerRef.current && !containerRef.current.contains(target)) {
        onAgentClick?.(-1);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [selectedAgentIndex, onAgentClick]);

  const { w, h } = dimensions;
  const cy = h * 0.5;

  // ── Build tooltip data ────────────────────────────────────────────────

  let tooltipEl: ReactNode = null;
  if (renderTooltip && selectedAgentIndex != null && selectedAgentIndex >= 0) {
    const pos = nodePositionsRef.current[selectedAgentIndex];
    if (pos) {
      const meta = agentMeta?.[pos.agent.id];
      tooltipEl = renderTooltip(
        { agent: pos.agent, meta, x: pos.x, y: pos.y },
        cy,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        borderRadius: 20,
        overflow: "hidden",
        background: backgroundColor,
      }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          position: "absolute",
          inset: 0,
          zIndex: 0,
          cursor: onAgentClick ? "pointer" : "default",
        }}
      />

      {/* Overlay (top bar, status bar, etc.) */}
      {overlay && (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: h,
            display: "flex",
            flexDirection: "column",
            pointerEvents: "none",
          }}
        >
          {overlay}
        </div>
      )}

      {/* Tooltip */}
      {tooltipEl && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>
          {tooltipEl}
        </div>
      )}
    </div>
  );
}
