import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, ArrowLeft, Crown, Zap, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * The Lyceum — Pre-order Modal
 * Design: Blueprint Minimal — warm white, charcoal, teal accent
 * Multi-step form: Email → Team Size → AI Count → Challenges → Budget → Pick a tier
 *
 * Pre-order is mandatory — there is no "just join, pay later" path. The
 * final step requires picking VIP or Basic and completing Lemon Squeezy
 * checkout; there's no free/no-payment exit.
 *   VIP ($122)  — earliest access + VIP privileges
 *   Basic ($22) — early access
 */

const LEMON_LINKS = {
  VIP: "https://lyceum.lemonsqueezy.com/checkout/buy/99e3c4fe-8893-4947-b318-f9b68f2432f8?embed=1",
  BASIC: "https://lyceum.lemonsqueezy.com/checkout/buy/1af94135-de0b-4aab-be65-cd460325624b?embed=1",
} as const;

const steps = [
  { id: 0, label: "Email" },
  { id: 1, label: "Team" },
  { id: 2, label: "AI Agents" },
  { id: 3, label: "Challenges" },
  { id: 4, label: "Budget" },
];

interface FormData {
  email: string;
  name: string;
  organization: string;
  teamSize: string;
  aiCount: string;
  challenges: string;
  budget: string;
}

export default function WaitlistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    email: "",
    name: "",
    organization: "",
    teamSize: "",
    aiCount: "",
    challenges: "",
    budget: "",
  });
  const [pickingTier, setPickingTier] = useState(false);
  const lemonScriptLoaded = useRef(false);
  // Unique ref per checkout attempt — the Lemon Squeezy webhook (server/index.ts)
  // stores paid status under this key so the /thank-you → /waiting flow can look it up.
  const [checkoutRef] = useState(() => crypto.randomUUID());

  const buildCheckoutUrl = (base: string) => {
    const url = new URL(base);
    url.searchParams.set("checkout[custom][ref]", checkoutRef);
    if (formData.email) url.searchParams.set("checkout[email]", formData.email);
    if (formData.name) {
      url.searchParams.set("checkout[name]", formData.name);
      url.searchParams.set("checkout[custom][name]", formData.name);
    }
    if (formData.organization) {
      url.searchParams.set("checkout[custom][organization]", formData.organization);
    }
    url.searchParams.set(
      "checkout[redirect_url]",
      `${window.location.origin}/thank-you?ref=${checkoutRef}`
    );
    return url.toString();
  };

  // Load Lemon Squeezy embed script once
  useEffect(() => {
    if (lemonScriptLoaded.current) return;
    const existing = document.querySelector('script[src="https://assets.lemonsqueezy.com/lemon.js"]');
    if (existing) {
      lemonScriptLoaded.current = true;
      return;
    }
    const script = document.createElement("script");
    script.src = "https://assets.lemonsqueezy.com/lemon.js";
    script.defer = true;
    document.head.appendChild(script);
    lemonScriptLoaded.current = true;
  }, []);

  const updateField = (key: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const next = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  const prev = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSubmit = () => {
    setPickingTier(true);
  };

  const reset = () => {
    setCurrentStep(0);
    setFormData({
      email: "",
      name: "",
      organization: "",
      teamSize: "",
      aiCount: "",
      challenges: "",
      budget: "",
    });
    setPickingTier(false);
    onClose();
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return (
          formData.email.length > 3 &&
          formData.email.includes("@") &&
          formData.name.trim().length > 0
        );
      case 1: return formData.teamSize.length > 0;
      case 2: return formData.aiCount.length > 0;
      case 3: return formData.challenges.length > 0;
      case 4: return formData.budget.length > 0;
      default: return true;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" onClick={onClose} />

          {/* Modal */}
          <motion.div
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                {steps.map((s) => (
                  <div
                    key={s.id}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      s.id === currentStep
                        ? "w-8 bg-teal"
                        : s.id < currentStep
                        ? "w-4 bg-teal/40"
                        : "w-4 bg-border"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={reset}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-8 min-h-[280px]">
              <AnimatePresence mode="wait">
                {!pickingTier ? (
                  <motion.div
                    key={currentStep}
                    initial={{ x: 30, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -30, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {renderStep(currentStep, formData, updateField)}
                  </motion.div>
                ) : (
                  <motion.div
                    key="tier-picker"
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className="text-center"
                  >
                    {/* Header */}
                    <div className="pb-6 pt-4">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-teal/10 flex items-center justify-center">
                        <Crown className="w-7 h-7 text-teal" />
                      </div>
                      <h3 className="font-display text-xl font-semibold text-foreground mb-1.5">
                        Reserve your spot
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                        A pre-order deposit is required to lock in your beta slot — pick a tier to continue.
                      </p>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                        Pre-order Pricing
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    {/* Pricing Tiers */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      {/* VIP Tier */}
                      <div className="relative rounded-xl border-2 border-amber-200/60 bg-amber-50/50 p-4 text-left group hover:border-amber-300 transition-colors">
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                          <span className="text-[8px] font-semibold uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            Best Value
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1 mt-1">
                          <Crown className="w-4 h-4 text-amber-500" />
                          <span className="font-display font-semibold text-sm text-foreground">VIP</span>
                        </div>
                        <p className="text-2xl font-display font-bold text-foreground mb-1">
                          $122
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">
                          Earliest access + VIP privileges
                        </p>
                        <a
                          href={buildCheckoutUrl(LEMON_LINKS.VIP)}
                          className="lemonsqueezy-button inline-flex items-center justify-center w-full h-8 rounded-lg text-[11px] font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                        >
                          <ArrowUpRight className="w-3 h-3 mr-1" />
                          Pre-order VIP
                        </a>
                      </div>

                      {/* Basic Tier */}
                      <div className="rounded-xl border border-border bg-white p-4 text-left group hover:border-teal/30 transition-colors">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Zap className="w-4 h-4 text-teal" />
                          <span className="font-display font-semibold text-sm text-foreground">Basic</span>
                        </div>
                        <p className="text-2xl font-display font-bold text-foreground mb-1">
                          $22
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">
                          Early access
                        </p>
                        <a
                          href={buildCheckoutUrl(LEMON_LINKS.BASIC)}
                          className="lemonsqueezy-button inline-flex items-center justify-center w-full h-8 rounded-lg text-[11px] font-medium bg-teal hover:bg-teal-dark text-white transition-colors"
                        >
                          <ArrowUpRight className="w-3 h-3 mr-1" />
                          Pre-order Basic
                        </a>
                      </div>
                    </div>

                    <p className="text-[9px] text-muted-foreground leading-relaxed max-w-sm mx-auto">
                      Secure checkout via Lemon Squeezy. A pre-order deposit is required to reserve your beta slot.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 flex items-center justify-between">
              {currentStep > 0 && !pickingTier ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prev}
                  className="border-border text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              ) : (
                <div />
              )}

              {!pickingTier && currentStep < steps.length - 1 && (
                <Button
                  size="sm"
                  onClick={next}
                  disabled={!canProceed()}
                  className="bg-teal hover:bg-teal-dark text-white"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              )}

              {!pickingTier && currentStep === steps.length - 1 && (
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!canProceed()}
                  className="bg-teal hover:bg-teal-dark text-white"
                >
                  Continue to Pre-order
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function renderStep(
  step: number,
  data: FormData,
  updateField: (key: keyof FormData, value: string) => void
) {
  const labelClass = "block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2";
  const inputClass =
    "w-full px-0 py-3 bg-transparent border-0 border-b border-border text-foreground text-lg font-display focus:outline-none focus:border-teal transition-colors placeholder:text-muted-foreground/50";

  switch (step) {
    case 0:
      return (
        <div className="space-y-6">
          <div>
            <label className={labelClass}>Business Email</label>
            <input
              type="email"
              value={data.email}
              onChange={(e) => updateField("email", e.target.value)}
              placeholder="you@company.com"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass}>What should we call you?</label>
            <input
              type="text"
              value={data.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="e.g. Alex Chen"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Organization</label>
            <input
              type="text"
              value={data.organization}
              onChange={(e) => updateField("organization", e.target.value)}
              placeholder="e.g. Acme Inc. (optional)"
              className={inputClass}
            />
          </div>
        </div>
      );
    case 1:
      return (
        <div>
          <label className={labelClass}>How many people on your team?</label>
          <input
            type="text"
            value={data.teamSize}
            onChange={(e) => updateField("teamSize", e.target.value)}
            placeholder="e.g. 12"
            className={inputClass}
            autoFocus
          />
        </div>
      );
    case 2:
      return (
        <div>
          <label className={labelClass}>How many AI agents do you currently use?</label>
          <input
            type="text"
            value={data.aiCount}
            onChange={(e) => updateField("aiCount", e.target.value)}
            placeholder="e.g. 3"
            className={inputClass}
            autoFocus
          />
        </div>
      );
    case 3:
      return (
        <div>
          <label className={labelClass}>What's your biggest challenge?</label>
          <textarea
            value={data.challenges}
            onChange={(e) => updateField("challenges", e.target.value)}
            placeholder="AI hallucinations, coordination issues, no oversight..."
            className={`${inputClass} resize-none min-h-[100px]`}
            autoFocus
          />
        </div>
      );
    case 4:
      return (
        <div>
          <label className={labelClass}>What's your budget for AI workforce management?</label>
          <select
            value={data.budget}
            onChange={(e) => updateField("budget", e.target.value)}
            className="w-full px-0 py-3 bg-transparent border-0 border-b border-border text-foreground text-lg font-display focus:outline-none focus:border-teal transition-colors appearance-none"
            autoFocus
          >
            <option value="" disabled className="text-muted-foreground">
              Select a range
            </option>
            <option value="under-500">Under $500/mo</option>
            <option value="500-2000">$500 – $2,000/mo</option>
            <option value="2000-5000">$2,000 – $5,000/mo</option>
            <option value="5000+">$5,000+/mo</option>
          </select>
        </div>
      );
    default:
      return null;
  }
}
