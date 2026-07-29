/**
 * ResponsibilityPanel — The Lyceum
 *
 * Shows which humans manage which AI departments/roles.
 * Each department (Marketing, Coding, Sales, etc.) can be assigned
 * to specific human members, who then manage the AI agents in that domain.
 */

import { useState } from "react";
import {
  X,
  Users,
  Bot,
  Shield,
  Check,
  Plus,
  Trash2,
  Star,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { ROLE_ICONS, ROLE_DESCRIPTIONS, ROLE_DOMAIN_MAP } from "@/lib/workCollaborationTypes";
import { DOMAINS } from "@/lib/modelConfig";

const DOMAIN_LABELS: Record<string, string> = {
  LAW: "Legal AI (Claude Sonnet 5)",
  FINANCE: "Finance AI (GPT-4o)",
  TECH: "Tech AI (Gemini 2.5 Flash)",
};

// ── Role Card ────────────────────────────────────────────────────────────────

function RoleCard({
  roleId,
  roleName,
  icon,
  description,
  managedDomain,
  assignedMembers,
  onAssign,
  onRemove,
}: {
  roleId: string;
  roleName: string;
  icon: string;
  description: string;
  managedDomain: string | null;
  assignedMembers: { memberId: string; memberName: string; isPrimary: boolean }[];
  onAssign: () => void;
  onRemove: (memberId: string) => void;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-[10px] font-medium text-white/90">{roleName}</p>
            <p className="text-[7px] text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-teal-400"
          onClick={onAssign}
        >
          <Plus className="w-2.5 h-2.5" />
        </Button>
      </div>

      {managedDomain && (
        <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-cyan-400 border-cyan-500/20 bg-cyan-500/5 mb-2">
          <Bot className="w-2 h-2 mr-0.5" />
          Manages: {DOMAIN_LABELS[managedDomain] || managedDomain}
        </Badge>
      )}

      {assignedMembers.length > 0 && (
        <div className="space-y-1">
          <p className="text-[7px] text-muted-foreground uppercase tracking-wider">Assigned</p>
          {assignedMembers.map((m) => (
            <div key={m.memberId} className="flex items-center justify-between text-[9px] text-white/70 bg-white/[0.02] rounded px-2 py-1">
              <div className="flex items-center gap-1.5">
                {m.isPrimary && <Star className="w-2.5 h-2.5 text-amber-400" />}
                <span>{m.memberName}</span>
                {m.isPrimary && <span className="text-[7px] text-amber-400">(Primary)</span>}
              </div>
              <button onClick={() => onRemove(m.memberId)}
                className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {assignedMembers.length === 0 && (
        <p className="text-[8px] text-muted-foreground italic">No one assigned yet</p>
      )}
    </div>
  );
}

// ── Assign Member Dialog ─────────────────────────────────────────────────────

function AssignMemberDialog({
  roleId,
  roleName,
  members,
  currentAssignments,
  onAssign,
  onClose,
}: {
  roleId: string;
  roleName: string;
  members: { id: string; name: string }[];
  currentAssignments: { memberId: string; isPrimary: boolean }[];
  onAssign: (memberId: string, isPrimary: boolean) => void;
  onClose: () => void;
}) {
  const [selectedMember, setSelectedMember] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  const availableMembers = members.filter(
    (m) => !currentAssignments.some((a) => a.memberId === m.id)
  );

  return (
    <div className="space-y-2">
      <p className="text-[9px] text-white/70">Assign to: {roleName}</p>
      <div className="flex flex-wrap gap-1">
        {availableMembers.length === 0 ? (
          <p className="text-[8px] text-muted-foreground">All members already assigned</p>
        ) : (
          availableMembers.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMember(m.id)}
              className={cn(
                "px-2 py-1 rounded text-[9px] border transition-colors",
                selectedMember === m.id
                  ? "bg-teal-500/15 text-teal-300 border-teal-500/30"
                  : "text-muted-foreground border-white/5 hover:text-white"
              )}
            >
              {m.name}
            </button>
          ))
        )}
      </div>
      {selectedMember && (
        <label className="flex items-center gap-1.5 text-[9px] text-white/70 cursor-pointer">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)}
            className="w-3 h-3 rounded border-white/20 bg-white/5" />
          Set as primary (lead)
        </label>
      )}
      <div className="flex gap-1">
        <Button size="sm" className="h-6 text-[8px] px-2 bg-teal-500/20 text-teal-300 border border-teal-500/30"
          onClick={() => { if (selectedMember) { onAssign(selectedMember, isPrimary); onClose(); } }}
          disabled={!selectedMember}>
          <Check className="w-2 h-2 mr-0.5" /> Assign
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[8px] text-muted-foreground hover:text-white"
          onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function ResponsibilityPanel() {
  const {
    workRoles,
    responsibilities,
    showResponsibilityPanel,
    setShowResponsibilityPanel,
    setResponsibility,
    removeResponsibility,
  } = useWorkforceStore();

  const { members: workspaceMembers } = useWorkspaceStore();

  const [assigningRole, setAssigningRole] = useState<string | null>(null);

  const members = workspaceMembers.map((m: any) => ({ id: m.id, name: m.name }));

  // Merge workspace members with mock users if workspace is empty
  const allMembers = members.length > 0 ? members : [
    { id: "user-1", name: "Alex Chen" },
    { id: "user-2", name: "Sarah Kim" },
    { id: "user-3", name: "Marcus Johnson" },
  ];

  if (!showResponsibilityPanel) return null;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0e]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-amber-500/15 flex items-center justify-center">
              <Briefcase className="w-3 h-3 text-amber-400" />
            </div>
            <h4 className="text-[10px] font-medium text-white/90">Role Responsibilities</h4>
          </div>
          <button onClick={() => setShowResponsibilityPanel(false)}
            className="text-muted-foreground hover:text-white">
            <X className="w-3 h-3" />
          </button>
        </div>
        <p className="text-[8px] text-muted-foreground">Assign humans to manage AI departments</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {workRoles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Briefcase className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[10px] text-white/70 font-medium mb-1">No roles configured</p>
              <p className="text-[8px] text-muted-foreground">Create work cards to initialize role definitions.</p>
            </div>
          ) : (
            workRoles.map((role) => {
              const assignedMembers = responsibilities
                .filter((r) => r.roleId === role.id)
                .map((r) => ({ memberId: r.memberId, memberName: r.memberName, isPrimary: r.isPrimary }));

              return (
                <div key={role.id}>
                  <RoleCard
                    roleId={role.id}
                    roleName={role.name}
                    icon={ROLE_ICONS[role.icon] || "📋"}
                    description={role.description}
                    managedDomain={ROLE_DOMAIN_MAP[role.icon] || null}
                    assignedMembers={assignedMembers}
                    onAssign={() => setAssigningRole(role.id)}
                    onRemove={(memberId) => removeResponsibility(memberId, role.id)}
                  />
                  {assigningRole === role.id && (
                    <div className="mt-1 p-2 bg-white/[0.03] border border-white/5 rounded-lg">
                      <AssignMemberDialog
                        roleId={role.id}
                        roleName={role.name}
                        members={allMembers}
                        currentAssignments={assignedMembers}
                        onAssign={(memberId, isPrimary) => {
                          const m = allMembers.find((x) => x.id === memberId);
                          if (m) {
                            setResponsibility(memberId, m.name, "", role.id, role.name, isPrimary);
                          }
                        }}
                        onClose={() => setAssigningRole(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
