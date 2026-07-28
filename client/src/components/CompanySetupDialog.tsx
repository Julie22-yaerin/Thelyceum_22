/**
 * CompanySetupDialog — The Lyceum
 *
 * First-time setup shown to the founding user.
 * They create a company name and their profile, which bootstraps:
 *   - The Company entity
 *   - The founder as Owner member
 *   - A personal Workspace with default folders
 */

import { useState } from "react";
import {
  Building2,
  User,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspaceStore, RANDOM_ADJECTIVES, RANDOM_NOUNS } from "@/store/useWorkspaceStore";

export default function CompanySetupDialog() {
  const { showCompanySetup, createCompany, setShowCompanySetup } = useWorkspaceStore();
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [step, setStep] = useState<"intro" | "setup">("intro");
  const [loading, setLoading] = useState(false);

  if (!showCompanySetup) return null;

  const generateRandomName = () => {
    const adj = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
    const noun = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
    setCompanyName(`${adj} ${noun}`);
  };

  const handleCreate = () => {
    if (!companyName.trim() || !ownerName.trim()) return;
    setLoading(true);
    // Simulate creation delay
    setTimeout(() => {
      createCompany(companyName.trim(), ownerName.trim());
      setLoading(false);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4">
        {step === "intro" ? (
          /* ── Welcome / Intro Screen ── */
          <div className="bg-[#0f0f13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-5">
                <Building2 className="w-7 h-7 text-teal-400" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Welcome to The Lyceum
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-sm mx-auto">
                You're the first user. Let's set up your company workspace
                so you can start building your AI workforce.
              </p>
              <div className="space-y-3 text-left mb-8">
                {[
                  "Create your company profile",
                  "Get your personal workspace with folders",
                  "Invite team members to collaborate",
                ].map((text, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-white/70">
                    <div className="w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center shrink-0">
                      <Sparkles className="w-3 h-3 text-teal-400" />
                    </div>
                    {text}
                  </div>
                ))}
              </div>
              <Button
                className="w-full h-10 bg-teal-500 hover:bg-teal-600 text-white"
                onClick={() => setStep("setup")}
              >
                Get Started
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : (
          /* ── Company Setup Form ── */
          <div className="bg-[#0f0f13] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-teal-500/15 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-teal-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Create Your Company</h2>
                  <p className="text-[11px] text-muted-foreground">Set up your Lyceum workspace</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Company Name */}
                <div>
                  <label className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-1.5 block">
                    Company Name
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. Acme Corp"
                      className="h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-[10px] text-muted-foreground hover:text-white shrink-0"
                      onClick={generateRandomName}
                    >
                      🎲 Random
                    </Button>
                  </div>
                </div>

                {/* Founder Name */}
                <div>
                  <label className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-1.5 block">
                    Your Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g. Alex Chen"
                      className="h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 pl-8"
                    />
                  </div>
                </div>

                {/* Preview */}
                {(companyName || ownerName) && (
                  <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Preview</p>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-teal-500/20 flex items-center justify-center text-[10px] font-bold text-teal-300">
                        {companyName.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="text-xs text-white/80 font-medium">
                          {companyName || "Your Company"}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          Owner: {ownerName || "You"} · 1 workspace
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <Button
                  variant="ghost"
                  className="h-9 text-xs text-muted-foreground hover:text-white flex-1"
                  onClick={() => setStep("intro")}
                >
                  Back
                </Button>
                <Button
                  className={cn(
                    "h-9 text-xs flex-1",
                    companyName.trim() && ownerName.trim()
                      ? "bg-teal-500 hover:bg-teal-600 text-white"
                      : "bg-white/5 text-muted-foreground cursor-not-allowed"
                  )}
                  onClick={handleCreate}
                  disabled={!companyName.trim() || !ownerName.trim() || loading}
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Launch Lyceum
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
