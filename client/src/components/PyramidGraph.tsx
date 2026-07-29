/**
 * PyramidGraph — The Lyceum
 *
 * Static SVG pyramid visualization replacing React Flow.
 *
 * Layout:
 *   Level 0 (top, "head"): Human tasks
 *   Level 1 (middle):       AI agents serving those tasks
 *
 * Each entity (human task / AI role) gets a unique color from a curated
 * palette. A gradient ring (stroke-dasharray) around each node shows
 * completion percentage. Click any node to select its parent task.
 *
 * No dragging, no pan/zoom, no React Flow dependency — pure SVG.
 */

import { useMemo, useCallback } from "react";
import type { SelectedTask } from "@/store/useSessionStore";

// ── Color Palette ───────────────────────────────────────────────────────────
// 12 distinct, harmonious colors for humans + AI agents.
// Assigned by index across all entities so each person/agent is unique.

const NODE_COLORS = [
  { fill: "#0d9488", ring: "#14b8a6", label: "teal" },      // 0
  { fill: "#7c3aed", ring: "#8b5cf6", label: "violet" },    // 1
  { fill: "#dc2626", ring: "#ef4444", label: "red" },        // 2
  { fill: "#2563eb", ring: "#3b82f6", label: "blue" },       // 3
  { fill: "#d97706", ring: "#f59e0b", label: "amber" },      // 4
  { fill: "#059669", ring: "#10b981", label: "emerald" },    // 5
  { fill: "#db2777", ring: "#ec4899", label: "pink" },       // 6
  { fill: "#9333ea", ring: "#a855f7", label: "purple" },     // 7
  { fill: "#0891b2", ring: "#06b6d4", label: "cyan" },       // 8
  { fill: "#ca8a04", ring: "#eab308", label: "yellow" },     // 9
  { fill: "#4f46e5", ring: "#6366f1", label: "indigo" },     // 10
  { fill: "#be185d", ring: "#f43f5e", label: "rose" },       // 11
];

function getNodeColor(index: number) {
  return NODE_COLORS[index % NODE_COLORS.length];
}

// ── SVG Constants ───────────────────────────────────────────────────────────

const NODE_RADIUS = 28;
const RING_WIDTH = 3.5;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 90;
const ARROW_LENGTH = 30;
const PADDING_X = 40;
const PADDING_Y = 40;
const LABEL_OFFSET_Y = 38;
const SUB_LABEL_OFFSET_Y = 50;
const RING_RADIUS = NODE_RADIUS + RING_WIDTH + 2;

// ── Circle circumference for stroke-dasharray ───────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function completionOffset(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return CIRCUMFERENCE * (1 - clamped);
}

// ── Entity Data ─────────────────────────────────────────────────────────────

interface PyramidEntity {
  id: string;
  taskId: string;
  label: string;
  subLabel: string;
  type: "human" | "ai";
  colorIndex: number;
  completion: number; // 0–1
  isActive: boolean;
}

// ── Component ───────────────────────────────────────────────────────────────

interface PyramidGraphProps {
  tasks: SelectedTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export default function PyramidGraph({ tasks, activeTaskId, onSelectTask }: PyramidGraphProps) {
  // Build the entity list — assign a unique color index to every human and AI
  const entities = useMemo(() => {
    const list: PyramidEntity[] = [];
    let colorIdx = 0;

    for (const task of tasks) {
      // Human entity (the "head" of this pyramid branch)
      const humanCompletion =
        task.status === "completed"
          ? 1
          : task.status === "in_progress"
            ? 0.5
            : task.status === "ai_working" || task.status === "awaiting_ai"
              ? 0.3
              : 0;

      list.push({
        id: `human-${task.id}`,
        taskId: task.id,
        label: task.title,
        subLabel: task.status.replace(/_/g, " "),
        type: "human" as const,
        colorIndex: colorIdx++,
        completion: humanCompletion,
        isActive: task.id === activeTaskId,
      });

      // AI entities under this task
      for (const ai of task.assignedAIs) {
        const aiCompletion =
          task.status === "completed"
            ? 1
            : task.status === "ai_working" && task.aiOutputs?.[ai.roleName]
              ? 0.7
              : task.status === "ai_working"
                ? 0.4
                : 0;

        list.push({
          id: `ai-${task.id}-${ai.roleName}`,
          taskId: task.id,
          label: ai.roleName.length > 18 ? ai.roleName.slice(0, 16) + "…" : ai.roleName,
          subLabel: ai.domain,
          type: "ai" as const,
          colorIndex: colorIdx++,
          completion: aiCompletion,
          isActive: task.id === activeTaskId,
        });
      }
    }

    return list;
  }, [tasks, activeTaskId]);

  // Compute SVG dimensions and positions
  const { svgWidth, svgHeight, nodePositions, arrows } = useMemo(() => {
    const positions: Record<string, { cx: number; cy: number }> = {};
    const arrowList: { from: string; to: string }[] = [];

    // Group human tasks
    const humanEntities = entities.filter((e) => e.type === "human");
    const totalHumans = humanEntities.length;
    if (totalHumans === 0) return { svgWidth: 200, svgHeight: 200, nodePositions: positions, arrows: arrowList };

    // Compute width needed
    const maxAiPerHuman = Math.max(
      ...humanEntities.map(
        (h) => entities.filter((e) => e.taskId === h.taskId && e.type === "ai").length
      ),
      1
    );

    // SVG width: enough room for all humans + their AIs
    const totalColumns = totalHumans * (maxAiPerHuman + 1);
    const svgWidth = Math.max(400, totalColumns * NODE_GAP_X + PADDING_X * 2);
    const svgHeight = PADDING_Y * 2 + NODE_RADIUS * 2 + NODE_GAP_Y + ARROW_LENGTH + 60;

    // Place humans at the top (Level 0) — evenly spread
    const humanStartX = (svgWidth - totalHumans * NODE_GAP_X) / 2;
    const humanY = PADDING_Y + NODE_RADIUS;

    humanEntities.forEach((h, i) => {
      const cx = humanStartX + i * NODE_GAP_X + NODE_GAP_X / 2;
      positions[h.id] = { cx, cy: humanY };

      // Place AI agents below this human (Level 1)
      const aiEntities = entities.filter((e) => e.taskId === h.taskId && e.type === "ai");
      const aiCount = aiEntities.length;
      if (aiCount === 0) return;

      const aiStartX = cx - ((aiCount - 1) * NODE_GAP_X) / 2;
      const aiY = humanY + NODE_GAP_Y;

      aiEntities.forEach((ai, aiIdx) => {
        const aiCx = aiStartX + aiIdx * NODE_GAP_X;
        positions[ai.id] = { cx: aiCx, cy: aiY };
        // Arrow from human to AI
        arrowList.push({ from: h.id, to: ai.id });
      });
    });

    return { svgWidth, svgHeight, nodePositions: positions, arrows: arrowList };
  }, [entities]);

  const handleClick = useCallback(
    (taskId: string) => {
      onSelectTask(taskId);
    },
    [onSelectTask]
  );

  if (tasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground">
        No tasks to display
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="w-full h-full"
      style={{ minHeight: svgHeight }}
    >
      <defs>
        {/* Glow filter for active nodes */}
        <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Arrows (human → AI) */}
      {arrows.map((arrow) => {
        const fromPos = nodePositions[arrow.from];
        const toPos = nodePositions[arrow.to];
        if (!fromPos || !toPos) return null;

        const fromEntity = entities.find((e) => e.id === arrow.from);
        const toEntity = entities.find((e) => e.id === arrow.to);
        const fromColor = getNodeColor(fromEntity?.colorIndex ?? 0);
        const toColor = getNodeColor(toEntity?.colorIndex ?? 0);

        const x1 = fromPos.cx;
        const y1 = fromPos.cy + NODE_RADIUS + RING_WIDTH + 2;
        const x2 = toPos.cx;
        const y2 = toPos.cy - NODE_RADIUS - RING_WIDTH - 2;

        // Compute angle for arrowhead rotation
        const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);

        return (
          <g key={`arrow-${arrow.from}-${arrow.to}`}>
            {/* Straight diagonal arrow from human bottom to AI top */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={fromColor.ring}
              strokeWidth={1.5}
              strokeOpacity={0.3}
            />
            {/* Arrowhead rotated to match line direction */}
            <polygon
              points="0,-4 8,0 0,4"
              fill={toColor.ring}
              opacity={0.5}
              transform={`translate(${x2},${y2}) rotate(${angle})`}
            />
          </g>
        );
      })}

      {/* Nodes */}
      {entities.map((entity) => {
        const pos = nodePositions[entity.id];
        if (!pos) return null;

        const color = getNodeColor(entity.colorIndex);
        const offset = completionOffset(entity.completion);
        const isActive = entity.isActive;

        return (
          <g
            key={entity.id}
            onClick={() => handleClick(entity.taskId)}
            style={{ cursor: "pointer" }}
          >
            {/* Background completion ring (empty track) */}
            <circle
              cx={pos.cx}
              cy={pos.cy}
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={RING_WIDTH}
            />

            {/* Foreground completion ring (colored arc) */}
            <circle
              cx={pos.cx}
              cy={pos.cy}
              r={RING_RADIUS}
              fill="none"
              stroke={color.ring}
              strokeWidth={RING_WIDTH}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${pos.cx} ${pos.cy})`}
              opacity={entity.completion > 0 ? 0.85 : 0.3}
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />

            {/* Active glow ring */}
            {isActive && (
              <circle
                cx={pos.cx}
                cy={pos.cy}
                r={RING_RADIUS + 3}
                fill="none"
                stroke={color.ring}
                strokeWidth={1.5}
                strokeOpacity={0.3}
                filter="url(#node-glow)"
              />
            )}

            {/* Node circle */}
            <circle
              cx={pos.cx}
              cy={pos.cy}
              r={NODE_RADIUS}
              fill={color.fill}
              fillOpacity={isActive ? 0.35 : 0.2}
              stroke={isActive ? color.ring : "rgba(255,255,255,0.1)"}
              strokeWidth={isActive ? 2 : 1}
              style={{ transition: "fill-opacity 0.2s ease, stroke-width 0.2s ease" }}
            />

            {/* Icon indicator (H for human, A for AI) */}
            <text
              x={pos.cx}
              y={pos.cy + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fill={isActive ? color.ring : "rgba(255,255,255,0.6)"}
              fontSize={entity.type === "human" ? 15 : 11}
              fontWeight={600}
              fontFamily="'Inter', sans-serif"
              style={{ pointerEvents: "none" }}
            >
              {entity.type === "human" ? "H" : "AI"}
            </text>

            {/* Label */}
            <text
              x={pos.cx}
              y={pos.cy + LABEL_OFFSET_Y}
              textAnchor="middle"
              fill={isActive ? color.ring : "rgba(255,255,255,0.7)"}
              fontSize={8}
              fontWeight={500}
              fontFamily="'Inter', sans-serif"
              style={{ pointerEvents: "none" }}
            >
              {entity.label}
            </text>

            {/* Sub-label (role/domain) */}
            <text
              x={pos.cx}
              y={pos.cy + SUB_LABEL_OFFSET_Y}
              textAnchor="middle"
              fill="rgba(255,255,255,0.3)"
              fontSize={6.5}
              fontWeight={400}
              fontFamily="'Inter', sans-serif"
              style={{ pointerEvents: "none" }}
            >
              {entity.subLabel}
            </text>

            {/* Completion percentage */}
            {entity.completion > 0 && entity.completion < 1 && (
              <text
                x={pos.cx + NODE_RADIUS + RING_WIDTH + 8}
                y={pos.cy - 2}
                textAnchor="start"
                fill={color.ring}
                fontSize={6}
                fontWeight={600}
                fontFamily="'Inter', sans-serif"
                opacity={0.7}
                style={{ pointerEvents: "none" }}
              >
                {Math.round(entity.completion * 100)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
