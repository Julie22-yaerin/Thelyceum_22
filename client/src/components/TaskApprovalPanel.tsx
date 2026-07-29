/**
 * TaskApprovalPanel — Human Approval UI for Failed AI Task Retries
 *
 * Shows a notification panel when AI task execution fails and needs human
 * approval to retry. Displays the error context clearly and concisely, with
 * Retry / Dismiss buttons.
 *
 * Also shows recently failed tasks that have exhausted their max attempts.
 */

import { useState } from "react";
import { useSessionStore, type SelectedTask } from "@/store/useSessionStore";
import { AlertTriangle, RefreshCw, X, AlertCircle, ChevronDown } from "lucide-react";

interface ApprovalTask extends SelectedTask {
  approvalRequest: NonNullable<SelectedTask["approvalRequest"]>;
}

export default function TaskApprovalPanel() {
  const currentSession = useSessionStore((s) => s.currentSession);
  const approveRetry = useSessionStore((s) => s.approveRetry);
  const rejectRetry = useSessionStore((s) => s.rejectRetry);
  const setActiveTask = useSessionStore((s) => s.setActiveTask);

  // Find tasks needing approval or permanently failed
  const pendingApprovals: ApprovalTask[] =
    currentSession?.tasks.filter(
      (t): t is ApprovalTask =>
        t.status === "awaiting_approval" &&
        t.approvalRequest?.status === "pending"
    ) ?? [];

  const permanentlyFailed =
    currentSession?.tasks.filter((t) => t.status === "failed") ?? [];

  if (pendingApprovals.length === 0 && permanentlyFailed.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
      }}
    >
      {/* Section: Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <AlertTriangle
              style={{ width: 14, height: 14, color: "#f59e0b", flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 10,
                fontWeight: 600,
                color: "#f59e0b",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {pendingApprovals.length} task{pendingApprovals.length > 1 ? "s" : ""} need approval
            </span>
          </div>

          {pendingApprovals.map((task) => (
            <ApprovalCard
              key={task.id}
              task={task}
              onRetry={() => approveRetry(task.id)}
              onReject={() => rejectRetry(task.id)}
              onNavigate={() => setActiveTask(task.id)}
            />
          ))}
        </div>
      )}

      {/* Section: Permanently failed */}
      {permanentlyFailed.length > 0 && (
        <div>
          {pendingApprovals.length > 0 && (
            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,0.06)",
                margin: "4px 0 8px",
              }}
            />
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <AlertCircle
              style={{ width: 14, height: 14, color: "#ef4444", flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 10,
                fontWeight: 600,
                color: "#ef4444",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Failed — max attempts reached
            </span>
          </div>

          {permanentlyFailed.map((task) => (
            <FailedCard key={task.id} task={task} onNavigate={() => setActiveTask(task.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ApprovalCard({
  task,
  onRetry,
  onReject,
  onNavigate,
}: {
  task: ApprovalTask;
  onRetry: () => void;
  onReject: () => void;
  onNavigate: () => void;
}) {
  return (
    <div
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.2)",
        borderRadius: 10,
        padding: 0,
        marginBottom: 6,
        overflow: "hidden",
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 2, background: "#f59e0b", opacity: 0.5 }} />

      <div style={{ padding: "10px 12px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.9)",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.title}
            </span>
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 8,
                color: "rgba(255,255,255,0.35)",
              }}
            >
              Attempt {task.approvalRequest.failedAttemptNumber} of {useSessionStore.getState().maxAttempts}
            </span>
          </div>
        </div>

        {/* Error context */}
        <div
          style={{
            background: "rgba(0,0,0,0.2)",
            borderRadius: 6,
            padding: "6px 8px",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 9,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.5,
              display: "block",
            }}
          >
            {task.approvalRequest.errorContext}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onRetry}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 10px",
              borderRadius: 6,
              border: "none",
              background: "#f59e0b",
              color: "#111",
              fontSize: 9,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: "pointer",
              transition: "opacity 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget).style.opacity = "0.85"; }}
            onMouseLeave={(e) => { (e.currentTarget).style.opacity = "1"; }}
          >
            <RefreshCw style={{ width: 10, height: 10 }} />
            Retry
          </button>
          <button
            onClick={onReject}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(255,255,255,0.5)",
              fontSize: 9,
              fontWeight: 500,
              fontFamily: "'Inter', sans-serif",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget).style.borderColor = "rgba(255,255,255,0.2)"; }}
            onMouseLeave={(e) => { (e.currentTarget).style.borderColor = "rgba(255,255,255,0.1)"; }}
          >
            <X style={{ width: 10, height: 10 }} />
            Dismiss
          </button>
          <button
            onClick={onNavigate}
            style={{
              marginLeft: "auto",
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              color: "rgba(255,255,255,0.35)",
              fontSize: 8,
              fontFamily: "'Inter', sans-serif",
              cursor: "pointer",
            }}
          >
            View Task
          </button>
        </div>
      </div>
    </div>
  );
}

function FailedCard({
  task,
  onNavigate,
}: {
  task: SelectedTask;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "rgba(239,68,68,0.06)",
        border: "1px solid rgba(239,68,68,0.15)",
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.7)",
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.title}
          </span>
        </div>
        <ChevronDown
          style={{
            width: 12,
            height: 12,
            color: "rgba(255,255,255,0.3)",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        />
      </div>

      {expanded && task.error && (
        <div
          style={{
            marginTop: 8,
            background: "rgba(0,0,0,0.2)",
            borderRadius: 6,
            padding: "6px 8px",
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 9,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.5,
              display: "block",
            }}
          >
            {task.error}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <span
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 8,
            color: "#ef4444",
            fontWeight: 500,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(239,68,68,0.15)",
          }}
        >
          Max attempts exceeded
        </span>
        <button
          onClick={onNavigate}
          style={{
            marginLeft: "auto",
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "transparent",
            color: "rgba(255,255,255,0.35)",
            fontSize: 8,
            fontFamily: "'Inter', sans-serif",
            cursor: "pointer",
          }}
        >
          View Task
        </button>
      </div>
    </div>
  );
}
