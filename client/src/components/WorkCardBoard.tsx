/**
 * WorkCardBoard — The Lyceum
 *
 * Shows all work cards grouped by status (draft, pending, approved, rejected, in_progress).
 * Humans create cards → submit for approval → colleagues approve/reject → chat to negotiate.
 */

import { useState, useMemo } from "react";
import {
  X,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban,
  MessageCircle,
  ArrowRight,
  FileText,
  Users,
  Send,
  Sparkles,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { ROLE_ICONS } from "@/lib/workCollaborationTypes";
import type { WorkCard, WorkCardStatus } from "@/lib/workCollaborationTypes";

const STATUS_META: Record<WorkCardStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Draft", color: "text-gray-400 border-gray-500/30 bg-gray-500/10", icon: FileText },
  pending: { label: "Pending Review", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: Clock },
  approved: { label: "Approved", color: "text-green-400 border-green-500/30 bg-green-500/10", icon: CheckCircle2 },
  rejected: { label: "Needs Revision", color: "text-red-400 border-red-500/30 bg-red-500/10", icon: Ban },
  in_progress: { label: "In Progress", color: "text-blue-400 border-blue-500/30 bg-blue-500/10", icon: ArrowRight },
  completed: { label: "Completed", color: "text-teal-400 border-teal-500/30 bg-teal-500/10", icon: CheckCircle2 },
  archived: { label: "Archived", color: "text-gray-500 border-gray-500/30 bg-gray-500/10", icon: X },
};

// ── Create Work Card Form ────────────────────────────────────────────────────

function CreateWorkCardForm({ onClose }: { onClose: () => void }) {
  const { workRoles, createWorkCard, setShowWorkCardBoard } = useWorkforceStore();
  const { members: workspaceMembers, getCurrentCompany } = useWorkspaceStore();
  const company = getCurrentCompany();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState<string[]>([""]);
  const [deliverables, setDeliverables] = useState<string[]>([""]);
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedRole, setSelectedRole] = useState(workRoles[0]?.id || "");

  const handleAddTask = () => setTasks([...tasks, ""]);
  const handleTaskChange = (i: number, v: string) => {
    const next = [...tasks]; next[i] = v; setTasks(next);
  };
  const handleRemoveTask = (i: number) => setTasks(tasks.filter((_, idx) => idx !== i));

  const handleAddDeliverable = () => setDeliverables([...deliverables, ""]);
  const handleDeliverableChange = (i: number, v: string) => {
    const next = [...deliverables]; next[i] = v; setDeliverables(next);
  };
  const handleRemoveDeliverable = (i: number) => setDeliverables(deliverables.filter((_, idx) => idx !== i));

  const handleCreate = () => {
    if (!title.trim() || !selectedRole) return;

    const role = workRoles.find((r) => r.id === selectedRole);
    const creatorName = company?.name || "User";

    createWorkCard({
      workspaceId: "workspace-1",
      creatorId: "user-1",
      creatorName,
      creatorAvatar: "",
      roleId: selectedRole,
      roleName: role?.name || "Unknown",
      revisions: [{
        id: `rev-init`,
        number: 1,
        title: title.trim(),
        description: description.trim(),
        tasks: tasks.filter(Boolean),
        deliverables: deliverables.filter(Boolean),
        deadline,
        notes: notes.trim(),
        createdAt: Date.now(),
      }],
      activeRevisionIndex: 0,
      approvals: [],
      chat: [],
      reviewerIds: [],
      assigneeIds: [],
      pinned: false,
    });

    setShowWorkCardBoard(true);
    onClose();
  };

  const role = workRoles.find((r) => r.id === selectedRole);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
        <h4 className="text-[10px] font-medium text-white/90">New Work Card</h4>
        <button onClick={onClose} className="text-muted-foreground hover:text-white">
          <X className="w-3 h-3" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Role</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {workRoles.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRole(r.id)}
                  className={cn(
                    "px-2 py-1 rounded text-[9px] border transition-colors",
                    selectedRole === r.id
                      ? "bg-teal-500/15 text-teal-300 border-teal-500/30"
                      : "text-muted-foreground border-white/5 hover:text-white hover:border-white/10"
                  )}
                >
                  {ROLE_ICONS[r.icon] || "📋"} {r.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you working on?"
              className="h-7 text-[10px] bg-white/5 border-white/10 text-white mt-1"
            />
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work in detail..."
              className="h-16 text-[10px] bg-white/5 border-white/10 text-white mt-1 resize-none"
            />
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Tasks</label>
            <div className="space-y-1 mt-1">
              {tasks.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                  <Input
                    value={t}
                    onChange={(e) => handleTaskChange(i, e.target.value)}
                    placeholder={`Task ${i + 1}`}
                    className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1"
                  />
                  {tasks.length > 1 && (
                    <button onClick={() => handleRemoveTask(i)} className="text-muted-foreground hover:text-red-400">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={handleAddTask} className="text-[9px] text-teal-400 hover:text-teal-300">
                + Add task
              </button>
            </div>
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Deliverables</label>
            <div className="space-y-1 mt-1">
              {deliverables.map((d, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <Input
                    value={d}
                    onChange={(e) => handleDeliverableChange(i, e.target.value)}
                    placeholder={`Deliverable ${i + 1}`}
                    className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1"
                  />
                  {deliverables.length > 1 && (
                    <button onClick={() => handleRemoveDeliverable(i)} className="text-muted-foreground hover:text-red-400">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={handleAddDeliverable} className="text-[9px] text-indigo-400 hover:text-indigo-300">
                + Add deliverable
              </button>
            </div>
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Deadline</label>
            <Input
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="e.g. 2026-08-15 or 'End of sprint'"
              className="h-7 text-[10px] bg-white/5 border-white/10 text-white mt-1"
            />
          </div>

          <div>
            <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context for reviewers..."
              className="h-12 text-[10px] bg-white/5 border-white/10 text-white mt-1 resize-none"
            />
          </div>
        </div>
      </ScrollArea>

      <div className="px-3 py-2 border-t border-white/5">
        <Button
          size="sm"
          className="w-full h-7 text-[9px] bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
          onClick={handleCreate}
          disabled={!title.trim() || !selectedRole}
        >
          <Plus className="w-3 h-3 mr-1" />
          Create Work Card
        </Button>
      </div>
    </div>
  );
}

// ── Work Card Item ───────────────────────────────────────────────────────────

function WorkCardItem({
  card,
  onSelect,
}: {
  card: WorkCard;
  onSelect: (id: string) => void;
}) {
  const statusMeta = STATUS_META[card.status];
  const StatusIcon = statusMeta.icon;
  const activeRev = card.revisions[card.activeRevisionIndex] || card.revisions[0];
  const pendingApprovals = card.approvals.filter((a) => a.decision === "pending").length;
  const rejectedApprovals = card.approvals.filter((a) => a.decision === "rejected").length;

  return (
    <button
      onClick={() => onSelect(card.id)}
      className="w-full text-left bg-white/[0.02] border border-white/5 rounded-lg p-3 hover:bg-white/[0.04] hover:border-white/10 transition-all group"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{ROLE_ICONS[card.roleName.toLowerCase().replace(/\s+/g, "_")] || "📋"}</span>
          <span className="text-[9px] text-muted-foreground">{card.roleName}</span>
          {card.kind === "role_claim" && (
            <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-amber-400 border-amber-500/30 bg-amber-500/10">
              <Crown className="w-2 h-2 mr-0.5" />
              Role Claim
            </Badge>
          )}
        </div>
        <Badge variant="outline" className={cn("text-[8px] h-4 px-1.5", statusMeta.color)}>
          <StatusIcon className="w-2 h-2 mr-0.5" />
          {statusMeta.label}
        </Badge>
      </div>

      {/* Title */}
      <p className="text-[11px] font-medium text-white/90 mb-1.5 line-clamp-2">{activeRev?.title || "Untitled"}</p>

      {/* Tasks preview */}
      {activeRev?.tasks && activeRev.tasks.length > 0 && (
        <div className="flex items-center gap-1 mb-1.5">
          <div className="w-1 h-1 rounded-full bg-teal-400" />
          <span className="text-[8px] text-muted-foreground">{activeRev.tasks.length} task{activeRev.tasks.length !== 1 ? "s" : ""}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2 text-[8px] text-muted-foreground">
          <span>{card.creatorName}</span>
          {pendingApprovals > 0 && (
            <span className="text-amber-400">{pendingApprovals} pending</span>
          )}
          {rejectedApprovals > 0 && (
            <span className="text-red-400">{rejectedApprovals} rejected</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {card.chat.length > 0 && (
            <span className="flex items-center gap-0.5 text-[8px] text-muted-foreground">
              <MessageCircle className="w-2 h-2" />
              {card.chat.length}
            </span>
          )}
          {card.approvals.filter((a) => a.decision === "approved").length > 0 && (
            <CheckCircle2 className="w-2.5 h-2.5 text-green-400" />
          )}
        </div>
      </div>
    </button>
  );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export default function WorkCardBoard() {
  const {
    workRoles,
    workCards,
    showWorkCardBoard,
    showWorkCardDetail,
    setShowWorkCardBoard,
    setShowWorkCardDetail,
    initWorkRoles,
    setShowWorkflowSetup,
  } = useWorkforceStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeFilter, setActiveFilter] = useState<WorkCardStatus | "all" | "role_claim">("all");

  // Initialize roles on first mount
  if (workRoles.length === 0) {
    initWorkRoles();
  }

  const roleClaimCount = useMemo(() => workCards.filter((c) => c.kind === "role_claim").length, [workCards]);

  const filteredCards = useMemo(() => {
    const list =
      activeFilter === "all"
        ? workCards
        : activeFilter === "role_claim"
          ? workCards.filter((c) => c.kind === "role_claim")
          : workCards.filter((c) => c.status === activeFilter);
    return list.slice(0, 50);
  }, [workCards, activeFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: workCards.length };
    (Object.keys(STATUS_META) as WorkCardStatus[]).forEach((status) => {
      counts[status] = workCards.filter((c) => c.status === status).length;
    });
    return counts;
  }, [workCards]);

  if (!showWorkCardBoard) return null;
  if (showCreateForm) return <CreateWorkCardForm onClose={() => setShowCreateForm(false)} />;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-indigo-500/15 flex items-center justify-center">
              <Users className="w-3 h-3 text-indigo-400" />
            </div>
            <h4 className="text-[10px] font-medium text-white/90">Work Cards</h4>
            <Badge variant="outline" className="text-[8px] h-4 px-1 text-muted-foreground border-white/5">
              {workCards.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="w-5 h-5 text-muted-foreground hover:text-teal-400"
              onClick={() => setShowWorkflowSetup(true)}
              title="AI Workflow Generator"
            >
              <Sparkles className="w-2.5 h-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="w-5 h-5 text-muted-foreground hover:text-white"
              onClick={() => setShowCreateForm(true)}
              title="New work card"
            >
              <Plus className="w-2.5 h-2.5" />
            </Button>
            <button
              onClick={() => setShowWorkCardBoard(false)}
              className="text-muted-foreground hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Status filter chips */}
        <div className="flex gap-1 flex-wrap">
          {(["all", "draft", "pending", "approved", "rejected", "in_progress"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setActiveFilter(status)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[8px] transition-colors",
                activeFilter === status
                  ? "bg-teal-500/15 text-teal-300"
                  : "text-muted-foreground hover:text-white"
              )}
            >
              {status === "all" ? "All" : STATUS_META[status]?.label || status} ({statusCounts[status] || 0})
            </button>
          ))}
          {roleClaimCount > 0 && (
            <button
              onClick={() => setActiveFilter("role_claim")}
              className={cn(
                "px-1.5 py-0.5 rounded text-[8px] transition-colors",
                activeFilter === "role_claim"
                  ? "bg-amber-500/15 text-amber-300"
                  : "text-amber-400/70 hover:text-amber-300"
              )}
            >
              👑 Role Claims ({roleClaimCount})
            </button>
          )}
        </div>
      </div>

      {/* Card List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[10px] text-white/70 font-medium mb-1">No work cards yet</p>
              <p className="text-[8px] text-muted-foreground mb-3">
                Create a work card to share what you're working on.
              </p>
              <Button
                size="sm"
                className="h-6 text-[9px] px-2 bg-teal-500/20 text-teal-300 border border-teal-500/30"
                onClick={() => setShowCreateForm(true)}
              >
                <Plus className="w-2.5 h-2.5 mr-1" />
                New Work Card
              </Button>
            </div>
          ) : (
            filteredCards.map((card) => (
              <WorkCardItem
                key={card.id}
                card={card}
                onSelect={setShowWorkCardDetail}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
