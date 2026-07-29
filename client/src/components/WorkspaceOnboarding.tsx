/**
 * WorkspaceOnboarding — The Lyceum
 *
 * First-login flow for entering a workspace. Two modes, same wizard:
 *
 *   "founder" — triggered by showCompanySetup (no company yet). Steps:
 *     Welcome → Company + your name → Your title → Your responsibilities → Launch.
 *     Solo, so there's no one to approve them — they become head of every
 *     responsibility they pick immediately.
 *
 *   "member" — triggered by pendingOnboardingMemberId, set right after an
 *     existing member invites someone (this is a single-browser demo, so
 *     "inviting" hands the wizard straight to the new person). Steps:
 *     Welcome → Your name confirmed → Your title → Your responsibilities →
 *     Submit for approval. Each claimed responsibility becomes a
 *     "role_claim" work card that existing teammates review — approve it
 *     and the claimant becomes head of that department, reject it and a
 *     chat thread opens for discussion (see WorkCardDetail), after which
 *     they can update their profile and resubmit.
 */

import { useState } from "react";
import {
  Building2,
  User,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Briefcase,
  Check,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, RANDOM_ADJECTIVES, RANDOM_NOUNS } from "@/store/useWorkspaceStore";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { BUILT_IN_ROLES, ROLE_ICONS, ROLE_DESCRIPTIONS } from "@/lib/workCollaborationTypes";
import type { WorkRole } from "@/lib/workCollaborationTypes";

type Step = "welcome" | "identity" | "title" | "responsibilities" | "review";

const STEP_ORDER: Step[] = ["welcome", "identity", "title", "responsibilities", "review"];

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function WorkspaceOnboarding() {
  const {
    showCompanySetup,
    pendingOnboardingMemberId,
    createCompany,
    completeMemberOnboarding,
    setShowCompanySetup,
    setPendingOnboardingMemberId,
    members,
  } = useWorkspaceStore();

  const { workRoles, initWorkRoles, addCustomRole, setResponsibility, createWorkCard, submitForApproval } =
    useWorkforceStore();

  const mode: "founder" | "member" | null = showCompanySetup
    ? "founder"
    : pendingOnboardingMemberId
      ? "member"
      : null;

  const [step, setStep] = useState<Step>("welcome");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [customRoleName, setCustomRoleName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!mode) return null;

  const invitedMember = mode === "member" ? members.find((m) => m.id === pendingOnboardingMemberId) : undefined;
  const otherMembers = mode === "member" ? members.filter((m) => m.id !== pendingOnboardingMemberId) : [];
  const displayName = mode === "member" ? invitedMember?.name ?? "" : name;

  const roles: WorkRole[] = workRoles.length > 0 ? workRoles : BUILT_IN_ROLES.map((r) => ({
    id: `role-${r}`,
    name: titleCase(r),
    builtIn: true,
    icon: r,
    description: ROLE_DESCRIPTIONS[r] || "",
    managesDomain: null,
    managedAgentIds: [],
  }));

  const stepIndex = STEP_ORDER.indexOf(step);

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  };
  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  };

  const canProceed = () => {
    switch (step) {
      case "welcome":
        return true;
      case "identity":
        return mode === "founder" ? companyName.trim().length > 0 && name.trim().length > 0 : true;
      case "title":
        return title.trim().length > 0;
      case "responsibilities":
        return selectedRoleIds.length > 0;
      default:
        return true;
    }
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
  };

  const addCustom = () => {
    const trimmed = customRoleName.trim();
    if (!trimmed) return;
    const id = `role-custom-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (!roles.some((r) => r.id === id)) {
      addCustomRole({
        id,
        name: trimmed,
        builtIn: false,
        icon: "briefcase",
        description: "Custom responsibility",
        managesDomain: null,
        managedAgentIds: [],
      });
    }
    setSelectedRoleIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCustomRoleName("");
    setAddingCustom(false);
  };

  const handleSubmit = () => {
    setSubmitting(true);

    if (workRoles.length === 0) initWorkRoles();

    setTimeout(() => {
      if (mode === "founder") {
        const memberId = createCompany(companyName.trim(), name.trim());
        for (const roleId of selectedRoleIds) {
          const role = roles.find((r) => r.id === roleId);
          if (!role) continue;
          setResponsibility(memberId, name.trim(), "", role.id, role.name, true);
        }
        completeMemberOnboarding(memberId, title.trim(), selectedRoleIds);
        setShowCompanySetup(false);
      } else if (invitedMember) {
        const reviewerIds = otherMembers.map((m) => m.id);
        for (const roleId of selectedRoleIds) {
          const role = roles.find((r) => r.id === roleId);
          if (!role) continue;
          createWorkCard({
            workspaceId: invitedMember.companyId,
            creatorId: invitedMember.id,
            creatorName: invitedMember.name,
            creatorAvatar: "",
            roleId: role.id,
            roleName: role.name,
            kind: "role_claim",
            revisions: [
              {
                id: "rev-init",
                number: 1,
                title: `${invitedMember.name} wants to head ${role.name}`,
                description: title.trim(),
                tasks: [],
                deliverables: [],
                deadline: "",
                notes: "",
                createdAt: Date.now(),
              },
            ],
            activeRevisionIndex: 0,
            approvals: [],
            chat: [],
            reviewerIds: [],
            assigneeIds: [invitedMember.id],
            pinned: false,
          });
          // createWorkCard prepends — the card we just made is at index 0.
          const newCardId = useWorkforceStore.getState().workCards[0]?.id;
          if (newCardId) submitForApproval(newCardId, reviewerIds);
        }
        completeMemberOnboarding(invitedMember.id, title.trim(), selectedRoleIds);
        setPendingOnboardingMemberId(null);
      }

      setSubmitting(false);
      setStep("welcome");
      setCompanyName("");
      setName("");
      setTitle("");
      setSelectedRoleIds([]);
    }, 500);
  };

  const isSolo = mode === "founder" || otherMembers.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[#0f0f13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Progress dots */}
        {step !== "welcome" && (
          <div className="flex items-center gap-1.5 px-8 pt-6">
            {STEP_ORDER.slice(1).map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1 rounded-full transition-all duration-300 flex-1",
                  i + 1 === stepIndex ? "bg-teal-400" : i + 1 < stepIndex ? "bg-teal-400/40" : "bg-white/10"
                )}
              />
            ))}
          </div>
        )}

        <div className="p-8">
          {step === "welcome" && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-5">
                <Building2 className="w-7 h-7 text-teal-400" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                {mode === "founder" ? "Welcome to The Lyceum" : `Welcome, ${invitedMember?.name}`}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-sm mx-auto">
                {mode === "founder"
                  ? "You're the first user. Let's set up your company and your profile so you can start building your AI workforce."
                  : "You've been invited to join the team. Let's set up your profile so the rest of the team knows what you're covering."}
              </p>
              <div className="space-y-3 text-left mb-8">
                {[
                  mode === "founder" ? "Create your company profile" : "Confirm your profile",
                  "Pick a title and the responsibilities you're covering",
                  isSolo
                    ? "You're the only one here — no approval needed"
                    : "Your teammates review and approve your role",
                ].map((text, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-white/70">
                    <div className="w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center shrink-0">
                      <Sparkles className="w-3 h-3 text-teal-400" />
                    </div>
                    {text}
                  </div>
                ))}
              </div>
              <Button className="w-full h-10 bg-teal-500 hover:bg-teal-600 text-white" onClick={goNext}>
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {step === "identity" && (
            <div>
              <h3 className="text-base font-semibold text-white mb-1">
                {mode === "founder" ? "Create your company" : "Your name tag"}
              </h3>
              <p className="text-[11px] text-muted-foreground mb-5">
                {mode === "founder" ? "This is what your team will see." : "Confirm how your name appears to the team."}
              </p>

              <div className="space-y-4">
                {mode === "founder" && (
                  <div>
                    <label className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-1.5 block">
                      Company Name
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="e.g. Acme Corp"
                        autoFocus
                        className="h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 text-[10px] text-muted-foreground hover:text-white shrink-0"
                        onClick={() => {
                          const adj = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
                          const noun = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
                          setCompanyName(`${adj} ${noun}`);
                        }}
                      >
                        🎲 Random
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-1.5 block">
                    Your Name Tag
                  </label>
                  {mode === "member" ? (
                    <div className="flex items-center gap-2 h-9 px-3 rounded-md bg-white/5 border border-white/10 text-white text-xs">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      {invitedMember?.name}
                    </div>
                  ) : (
                    <div className="relative">
                      <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Alex Chen"
                        className="h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 pl-8"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === "title" && (
            <div>
              <h3 className="text-base font-semibold text-white mb-1">Your title</h3>
              <p className="text-[11px] text-muted-foreground mb-5">
                A short headline for {displayName || "you"} — how the team should think of your role.
              </p>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Growth Lead, Founding Engineer"
                autoFocus
                className="h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
              />
            </div>
          )}

          {step === "responsibilities" && (
            <div>
              <h3 className="text-base font-semibold text-white mb-1">Your responsibilities</h3>
              <p className="text-[11px] text-muted-foreground mb-4">
                Pick every department you'll cover. {isSolo ? "You'll be head of each right away." : "Your team reviews these before you're confirmed as head."}
              </p>

              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                {roles.map((role) => {
                  const selected = selectedRoleIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      onClick={() => toggleRole(role.id)}
                      className={cn(
                        "text-left px-2.5 py-2 rounded-lg border transition-colors",
                        selected
                          ? "bg-teal-500/15 border-teal-500/40"
                          : "bg-white/[0.03] border-white/10 hover:border-white/20"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-sm">{ROLE_ICONS[role.icon] || "💼"}</span>
                        <span className={cn("text-[11px] font-medium", selected ? "text-teal-300" : "text-white/80")}>
                          {role.name}
                        </span>
                        {selected && <Check className="w-3 h-3 text-teal-400 ml-auto" />}
                      </div>
                      <p className="text-[9px] text-muted-foreground line-clamp-2">{role.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                {addingCustom ? (
                  <div className="flex gap-1.5">
                    <Input
                      value={customRoleName}
                      onChange={(e) => setCustomRoleName(e.target.value)}
                      placeholder="Custom responsibility name"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && addCustom()}
                      className="h-8 text-[11px] bg-white/5 border-white/10 text-white flex-1"
                    />
                    <Button size="sm" className="h-8 text-[10px] bg-teal-500/20 text-teal-300 border border-teal-500/30" onClick={addCustom}>
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setAddingCustom(false)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingCustom(true)}
                    className="flex items-center gap-1.5 text-[11px] text-teal-400 hover:text-teal-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add a custom role
                  </button>
                )}
              </div>
            </div>
          )}

          {step === "review" && (
            <div>
              <div className="w-10 h-10 rounded-lg bg-teal-500/15 flex items-center justify-center mb-4">
                <Briefcase className="w-5 h-5 text-teal-400" />
              </div>
              <h3 className="text-base font-semibold text-white mb-1">Review your profile</h3>
              <p className="text-[11px] text-muted-foreground mb-4">
                {isSolo
                  ? "No one else needs to approve this — you're the only one here."
                  : `${otherMembers.length} teammate${otherMembers.length !== 1 ? "s" : ""} will review before you're confirmed as head.`}
              </p>

              <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-teal-500/20 flex items-center justify-center text-[10px] font-bold text-teal-300">
                    {displayName.charAt(0) || "?"}
                  </div>
                  <div>
                    <p className="text-xs text-white/90 font-medium">{displayName || "You"}</p>
                    <p className="text-[9px] text-muted-foreground">{title || "No title set"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedRoleIds.map((id) => {
                    const role = roles.find((r) => r.id === id);
                    if (!role) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20"
                      >
                        {ROLE_ICONS[role.icon] || "💼"} {role.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Footer nav */}
          {step !== "welcome" && (
            <div className="flex gap-2 mt-6">
              <Button variant="ghost" className="h-9 text-xs text-muted-foreground hover:text-white flex-1" onClick={goBack}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Back
              </Button>
              {step === "review" ? (
                <Button
                  className={cn(
                    "h-9 text-xs flex-1",
                    "bg-teal-500 hover:bg-teal-600 text-white"
                  )}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      {isSolo ? "Launching…" : "Submitting…"}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      {isSolo ? "Launch Lyceum" : "Submit for Approval"}
                    </span>
                  )}
                </Button>
              ) : (
                <Button
                  className={cn(
                    "h-9 text-xs flex-1",
                    canProceed() ? "bg-teal-500 hover:bg-teal-600 text-white" : "bg-white/5 text-muted-foreground cursor-not-allowed"
                  )}
                  onClick={goNext}
                  disabled={!canProceed()}
                >
                  Continue
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
