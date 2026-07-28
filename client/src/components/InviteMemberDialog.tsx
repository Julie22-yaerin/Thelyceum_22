/**
 * InviteMemberDialog — The Lyceum
 *
 * Company owner/admin can invite new members by name, email, and role.
 * Each invited member gets their own personal workspace automatically.
 */

import { useState } from "react";
import {
  X,
  Mail,
  UserPlus,
  User,
  Shield,
  Users,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useWorkspaceStore,
  type MemberRole,
  type WorkspaceMember,
} from "@/store/useWorkspaceStore";

// ── Role Badge ───────────────────────────────────────────────────────────────

const ROLE_META: Record<MemberRole, { label: string; color: string; icon: React.ElementType }> = {
  owner: { label: "Owner", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: Shield },
  admin: { label: "Admin", color: "text-purple-400 border-purple-500/30 bg-purple-500/10", icon: Shield },
  member: { label: "Member", color: "text-blue-400 border-blue-500/30 bg-blue-500/10", icon: Users },
};

// ── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({
  member,
  isOwner,
  onRemove,
  onRoleChange,
}: {
  member: WorkspaceMember;
  isOwner: boolean;
  onRemove: (id: string) => void;
  onRoleChange: (id: string, role: MemberRole) => void;
}) {
  const meta = ROLE_META[member.role];
  const Icon = meta.icon;
  const initials = member.name
    .split(" ")
    .map((n) => n.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors group">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500/20 to-indigo-500/20 flex items-center justify-center shrink-0">
        <span className="text-[9px] font-medium text-white/80">{initials}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-white/90 truncate">{member.name}</span>
          {member.role === "owner" && (
            <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-amber-400 border-amber-500/30">
              Founder
            </Badge>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground truncate">{member.email}</p>
      </div>

      {/* Role selector */}
      {isOwner && member.role !== "owner" ? (
        <div className="flex items-center gap-1">
          {(["admin", "member"] as MemberRole[]).map((role) => (
            <button
              key={role}
              onClick={() => onRoleChange(member.id, role)}
              className={cn(
                "text-[8px] px-1.5 py-0.5 rounded transition-colors",
                member.role === role
                  ? ROLE_META[role].color + " font-medium"
                  : "text-muted-foreground hover:text-white"
              )}
            >
              {role}
            </button>
          ))}
          <button
            onClick={() => onRemove(member.id)}
            className="text-muted-foreground/50 hover:text-red-400 ml-1 opacity-0 group-hover:opacity-100 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <Badge variant="outline" className={cn("text-[8px] h-4 px-1.5", meta.color)}>
          <Icon className="w-2 h-2 mr-0.5" />
          {meta.label}
        </Badge>
      )}
    </div>
  );
}

// ── Main Dialog ──────────────────────────────────────────────────────────────

export default function InviteMemberDialog() {
  const {
    showInviteDialog,
    setShowInviteDialog,
    inviteMember,
    removeMember,
    updateMemberRole,
    getCompanyMembers,
    getCurrentCompany,
  } = useWorkspaceStore();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [invited, setInvited] = useState(false);

  if (!showInviteDialog) return null;

  const members = getCompanyMembers();
  const company = getCurrentCompany();
  const currentUser = members.find((m) => m.role === "owner") || members[0];

  const handleInvite = () => {
    if (!name.trim() || !email.trim()) return;
    inviteMember(name.trim(), email.trim(), role);
    setName("");
    setEmail("");
    setRole("member");
    setInvited(true);
    setTimeout(() => setInvited(false), 2500);
  };

  const handleClose = () => {
    setShowInviteDialog(false);
    setInvited(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowInviteDialog(false);
      }}
    >
      <div className="w-full max-w-md mx-4 bg-[#0f0f13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Invite Members</h3>
              <p className="text-[10px] text-muted-foreground">
                {company?.name || "Your Company"} · {members.length} member{members.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Invite Form */}
        <div className="px-5 py-4 border-b border-white/5">
          <p className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-3">
            Invite New Member
          </p>
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="h-8 text-[11px] bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 pl-7"
                />
              </div>
              <div className="relative flex-1">
                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="h-8 text-[11px] bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 pl-7"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              {(["admin", "member"] as MemberRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 h-7 text-[10px] rounded-md border transition-colors",
                    role === r
                      ? [r === "admin" ? "border-purple-500/30 bg-purple-500/10 text-purple-300" : "border-blue-500/30 bg-blue-500/10 text-blue-300"]
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-white"
                  )}
                >
                  {r === "admin" ? "Admin" : "Member"}
                </button>
              ))}
            </div>
            <Button
              className={cn(
                "w-full h-8 text-[11px]",
                name.trim() && email.trim()
                  ? "bg-indigo-500 hover:bg-indigo-600 text-white"
                  : "bg-white/5 text-muted-foreground cursor-not-allowed"
              )}
              onClick={handleInvite}
              disabled={!name.trim() || !email.trim()}
            >
              {invited ? (
                <span className="flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Invited!
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <UserPlus className="w-3 h-3" />
                  Send Invitation
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Member List */}
        <div className="px-5 py-3">
          <p className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-2">
            Team Members ({members.length})
          </p>
          <ScrollArea className="max-h-52">
            <div className="space-y-1">
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isOwner={currentUser?.role === "owner"}
                  onRemove={removeMember}
                  onRoleChange={updateMemberRole}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
