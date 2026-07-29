/**
 * WorkCardDetail — The Lyceum
 *
 * Full work card detail with:
 *   - Current revision display (tasks, deliverables, deadline)
 *   - Approval/rejection with reason + suggested changes
 *   - Inline chat for negotiation between parties
 *   - Submit new revision after rejection
 *   - Re-approval flow
 */

import { useState, useRef, useEffect } from "react";
import {
  X,
  Check,
  Ban,
  Send,
  MessageCircle,
  ArrowLeft,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  UserCheck,
  UserX,
  ChevronRight,
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

// ── Chat Bubble ──────────────────────────────────────────────────────────────

function ChatBubble({
  msg,
  isOwn,
}: {
  msg: { authorName: string; text: string; timestamp: number };
  isOwn: boolean;
}) {
  return (
    <div className={cn("flex gap-2", isOwn ? "flex-row-reverse" : "")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-2.5 py-1.5",
          isOwn
            ? "bg-teal-500/15 border border-teal-500/20"
            : "bg-white/[0.04] border border-white/5"
        )}
      >
        <p className="text-[8px] text-muted-foreground mb-0.5">{isOwn ? "You" : msg.authorName}</p>
        <p className="text-[10px] text-white/80 leading-relaxed">{msg.text}</p>
        <p className="text-[7px] text-muted-foreground mt-0.5 text-right">
          {new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WorkCardDetail() {
  const {
    workCards,
    showWorkCardDetail,
    setShowWorkCardDetail,
    approveCard,
    rejectCard,
    addNegotiationMessage,
    addRevision,
    updateWorkCardStatus,
  } = useWorkforceStore();

  const { members: workspaceMembers } = useWorkspaceStore();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");

  // Edit state for revision
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTasks, setEditTasks] = useState<string[]>([]);
  const [editDeliverables, setEditDeliverables] = useState<string[]>([]);
  const [editDeadline, setEditDeadline] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Rejection reason state
  const [rejectReason, setRejectReason] = useState("");
  const [rejectChanges, setRejectChanges] = useState<string[]>([""]);
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Approve state
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const card = workCards.find((c) => c.id === showWorkCardDetail);
  const activeRev = card?.revisions[card?.activeRevisionIndex || 0];

  // Current user info
  const currentUser = {
    id: "member-owner",
    name: "You",
    avatar: "",
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [card?.chat.length]);

  if (!card || !activeRev) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0a0e]">
        <p className="text-[10px] text-muted-foreground">Card not found</p>
      </div>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSendMessage = () => {
    if (!message.trim()) return;
    addNegotiationMessage(card.id, {
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorAvatar: currentUser.avatar,
      text: message.trim(),
    });
    setMessage("");
  };

  const handleApprove = () => {
    approveCard(card.id, currentUser.id, currentUser.name, currentUser.avatar);
    setShowApproveConfirm(false);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    rejectCard(
      card.id,
      currentUser.id,
      currentUser.name,
      currentUser.avatar,
      rejectReason.trim(),
      rejectChanges.filter(Boolean)
    );
    setShowRejectForm(false);
    setRejectReason("");
    setRejectChanges([""]);
  };

  const handleStartEdit = () => {
    setEditTitle(activeRev.title);
    setEditDescription(activeRev.description);
    setEditTasks([...activeRev.tasks]);
    setEditDeliverables([...activeRev.deliverables]);
    setEditDeadline(activeRev.deadline);
    setEditNotes(activeRev.notes);
    setEditing(true);
  };

  const handleSubmitRevision = () => {
    addRevision(card.id, {
      title: editTitle,
      description: editDescription,
      tasks: editTasks.filter(Boolean),
      deliverables: editDeliverables.filter(Boolean),
      deadline: editDeadline,
      notes: editNotes,
    });
    setEditing(false);
    updateWorkCardStatus(card.id, "pending");
  };

  const isReviewer = card.reviewerIds.includes(currentUser.id);
  const pendingApproval = card.approvals.find(
    (a) => a.reviewerId === currentUser.id && a.decision === "pending"
  );

  // Status color mapping for the header
  const statusColors: Record<WorkCardStatus, string> = {
    draft: "text-gray-400",
    pending: "text-amber-400",
    approved: "text-green-400",
    rejected: "text-red-400",
    in_progress: "text-blue-400",
    completed: "text-teal-400",
    archived: "text-gray-500",
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowWorkCardDetail(null)}
              className="text-muted-foreground hover:text-white"
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
            <span className="text-sm">
              {card.kind === "role_claim" ? "👑" : ROLE_ICONS[card.roleName.toLowerCase().replace(/\s+/g, "_")] || "📋"}
            </span>
            <h4 className="text-[10px] font-medium text-white/90 truncate">{activeRev.title}</h4>
          </div>
          <Badge variant="outline" className={cn("text-[8px] h-4 px-1.5", statusColors[card.status])}>
            {card.status.replace("_", " ")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-[8px] text-muted-foreground">
          <span>By {card.creatorName}</span>
          <span>·</span>
          <span>{card.kind === "role_claim" ? `Claiming ${card.roleName}` : card.roleName}</span>
          {card.revisions.length > 1 && (
            <>
              <span>·</span>
              <span>Rev {activeRev.number}</span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {editing ? (
            /* ── Edit Form ── */
            <div className="space-y-2">
              <div>
                <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Title</label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  className="h-7 text-[10px] bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Description</label>
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                  className="h-16 text-[10px] bg-white/5 border-white/10 text-white mt-1 resize-none" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Tasks</label>
                {editTasks.map((t, i) => (
                  <div key={i} className="flex items-center gap-1 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                    <Input value={t} onChange={(e) => {
                      const next = [...editTasks]; next[i] = e.target.value; setEditTasks(next);
                    }} className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1" />
                  </div>
                ))}
                <button onClick={() => setEditTasks([...editTasks, ""])}
                  className="text-[9px] text-teal-400 hover:text-teal-300 mt-1">+ Add task</button>
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Deliverables</label>
                {editDeliverables.map((d, i) => (
                  <div key={i} className="flex items-center gap-1 mt-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                    <Input value={d} onChange={(e) => {
                      const next = [...editDeliverables]; next[i] = e.target.value; setEditDeliverables(next);
                    }} className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1" />
                  </div>
                ))}
                <button onClick={() => setEditDeliverables([...editDeliverables, ""])}
                  className="text-[9px] text-indigo-400 hover:text-indigo-300 mt-1">+ Add deliverable</button>
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground uppercase tracking-wider">Deadline</label>
                <Input value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)}
                  className="h-7 text-[10px] bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" className="h-7 text-[9px] px-3 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
                  onClick={handleSubmitRevision}>
                  <Send className="w-2.5 h-2.5 mr-1" /> Submit Update
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[9px] text-muted-foreground hover:text-white"
                  onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Revision Content ── */}
              <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-lg px-3 py-2">
                <p className="text-[8px] text-indigo-400 uppercase tracking-wider mb-1">
                  {card.kind === "role_claim" ? `${card.creatorName}'s title` : `Revision ${activeRev.number}`}
                </p>
                {activeRev.description && (
                  <p className="text-[10px] text-white/70 leading-relaxed mb-2">{activeRev.description}</p>
                )}
              </div>

              {/* Tasks */}
              {activeRev.tasks.length > 0 && (
                <div>
                  <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">Tasks</p>
                  <div className="space-y-1">
                    {activeRev.tasks.map((t, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-0.5 shrink-0" />
                        <span className="text-[10px] text-white/70">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deliverables */}
              {activeRev.deliverables.length > 0 && (
                <div>
                  <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">Deliverables</p>
                  <div className="space-y-1">
                    {activeRev.deliverables.map((d, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-0.5 shrink-0" />
                        <span className="text-[10px] text-white/70">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deadline + Notes */}
              {activeRev.deadline && (
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <Clock className="w-2.5 h-2.5" />
                  <span>Deadline: {activeRev.deadline}</span>
                </div>
              )}

              {activeRev.notes && (
                <div className="bg-white/[0.03] rounded px-2 py-1.5">
                  <p className="text-[8px] text-muted-foreground mb-0.5">Notes</p>
                  <p className="text-[9px] text-white/60">{activeRev.notes}</p>
                </div>
              )}

              {/* ── Approval Status ── */}
              {card.approvals.length > 0 && (
                <div>
                  <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">Approvals</p>
                  <div className="space-y-1">
                    {card.approvals.map((a) => (
                      <div key={a.reviewerId} className="flex items-center gap-2 text-[9px] text-white/70 bg-white/[0.02] rounded px-2 py-1.5">
                        {a.decision === "approved" ? (
                          <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                        ) : a.decision === "rejected" ? (
                          <Ban className="w-3 h-3 text-red-400 shrink-0" />
                        ) : (
                          <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                        <span className="flex-1">{a.reviewerName}</span>
                        <span className="text-muted-foreground">{a.decision}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Approval Actions (for reviewers) ── */}
              {isReviewer && pendingApproval && card.status !== "approved" && (
                <div className="border border-white/5 rounded-lg p-3 space-y-2">
                  <p className="text-[9px] text-white/70 font-medium">
                    {card.kind === "role_claim"
                      ? `Approve ${card.creatorName} as head of ${card.roleName}?`
                      : "Your Review"}
                  </p>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-[9px] px-3 bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 flex-1"
                      onClick={() => setShowApproveConfirm(true)}>
                      <Check className="w-2.5 h-2.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[9px] text-red-400 hover:text-red-300 border border-red-500/20 flex-1"
                      onClick={() => setShowRejectForm(true)}>
                      <Ban className="w-2.5 h-2.5 mr-1" /> Reject
                    </Button>
                  </div>
                  {showApproveConfirm && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1.5">
                      <p className="text-[9px] text-green-300 mb-1">Confirm approval?</p>
                      <div className="flex gap-1">
                        <Button size="sm" className="h-6 text-[8px] px-2 bg-green-500/20 text-green-300" onClick={handleApprove}>
                          Yes, Approve
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[8px] text-muted-foreground"
                          onClick={() => setShowApproveConfirm(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {showRejectForm && (
                    <div className="space-y-1.5">
                      <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Why are you rejecting this?"
                        className="h-14 text-[9px] bg-white/5 border-white/10 text-white resize-none" />
                      <div>
                        <p className="text-[8px] text-muted-foreground mb-0.5">Suggested changes</p>
                        {rejectChanges.map((c, i) => (
                          <div key={i} className="flex items-center gap-1 mt-0.5">
                            <Input value={c} onChange={(e) => {
                              const next = [...rejectChanges]; next[i] = e.target.value; setRejectChanges(next);
                            }} placeholder="Change suggestion" className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1" />
                          </div>
                        ))}
                        <button onClick={() => setRejectChanges([...rejectChanges, ""])}
                          className="text-[8px] text-amber-400 hover:text-amber-300 mt-0.5">+ Add suggestion</button>
                      </div>
                      <Button size="sm" className="h-6 text-[8px] px-2 bg-red-500/20 text-red-300 border border-red-500/30"
                        onClick={handleReject} disabled={!rejectReason.trim()}>
                        <Ban className="w-2 h-2 mr-1" /> Submit Rejection
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Edit Button (when rejected) ── */}
              {card.status === "rejected" && card.creatorId === currentUser.id && (
                <Button size="sm" className="w-full h-7 text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30"
                  onClick={handleStartEdit}>
                  <Plus className="w-2.5 h-2.5 mr-1" /> Update & Resubmit
                </Button>
              )}
            </>
          )}

          <Separator className="bg-white/5" />

          {/* ── Chat Section ── */}
          <div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-2">
              Discussion ({card.chat.length})
            </p>
            <div className="space-y-2 mb-3">
              {card.chat.length === 0 ? (
                <p className="text-[9px] text-muted-foreground text-center py-4">
                  No discussion yet. Start a conversation to negotiate changes.
                </p>
              ) : (
                card.chat.map((msg) => (
                  <ChatBubble key={msg.id} msg={msg} isOwn={msg.authorId === currentUser.id} />
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-1.5">
              <Input value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="h-7 text-[9px] bg-white/5 border-white/10 text-white flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} />
              <Button size="sm" className="h-7 w-7 p-0 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
                onClick={handleSendMessage} disabled={!message.trim()}>
                <Send className="w-2.5 h-2.5" />
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
