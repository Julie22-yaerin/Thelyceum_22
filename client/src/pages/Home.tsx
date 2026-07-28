import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Zap, Shield, Users, Brain, ChevronRight, Clock, Radio, FileCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import WaitlistModal from "@/components/WaitlistModal";
import AnimatedCounter from "@/components/AnimatedCounter";
import AIWorkflowSimulation from "@/components/AIWorkflowSimulation";
import BetaSlotCounter from "@/components/BetaSlotCounter";

/*
 * The Lyceum — Landing Page
 * Design: Blueprint Minimal
 * Palette: warm white (#fafaf8), charcoal (#1a1a1a), teal (#0d9488)
 * Typography: Space Grotesk (display) + Inter (body)
 */

const fadeInUp = {
  initial: { y: 20, opacity: 0 },
  whileInView: { y: 0, opacity: 1 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] as const },
};

const staggerContainer = {
  initial: {},
  whileInView: { transition: { staggerChildren: 0.08 } },
  viewport: { once: true, margin: "-80px" },
};

const features = [
  {
    icon: Users,
    title: "AI as Personnel",
    desc: "Your AI agents aren't tools — they're team members with roles, responsibilities, and accountability.",
  },
  {
    icon: Brain,
    title: "Agent Collaboration",
    desc: "AI agents communicate with each other and with humans to reach decisions before execution.",
  },
  {
    icon: Shield,
    title: "Audit & Oversight",
    desc: "Every AI decision is logged, reviewed, and auditable. No hallucination goes unchecked.",
  },
  {
    icon: Zap,
    title: "Organized Workflows",
    desc: "Structured processes replace chaos. Clear hierarchies, approval gates, and traceable chains.",
  },
];

const metricsBefore: { value: number; suffix: string; label: string; decimal?: boolean }[] = [
  { value: 14, suffix: "h", label: "Avg. time to approve AI outputs" },
  { value: 38, suffix: "%", label: "Decisions requiring rework" },
  { value: 72, suffix: "%", label: "Team frustration with AI errors" },
  { value: 0, suffix: "", label: "Visibility into AI decision chains" },
];

const metricsAfter = [
  { value: 1.2, suffix: "h", label: "Avg. time to approve AI outputs", decimal: true },
  { value: 6, suffix: "%", label: "Decisions requiring rework" },
  { value: 12, suffix: "%", label: "Team frustration with AI errors" },
  { value: 100, suffix: "%", label: "Visibility into AI decision chains" },
];

export default function Home() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  return (
    <div className="min-h-screen bg-warm-white">
      {/* Fixed top stack: urgency banner + nav */}
      <div className="fixed top-0 left-0 right-0 z-50">
        {/* Urgency Banner */}
        <div className="bg-[#0f0f13] text-white text-center py-2 px-4">
          <p className="text-xs sm:text-[13px] font-medium">
            Beta Batch 1 is closing —{" "}
            <button
              onClick={() => setWaitlistOpen(true)}
              className="underline underline-offset-2 decoration-teal-400 text-teal-300 hover:text-teal-200 transition-colors"
            >
              reserve your slot before the cap hits
            </button>
            .
          </p>
        </div>

        {/* Navigation */}
        <nav className="bg-warm-white/80 backdrop-blur-xl border-b border-border">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center">
            <img
              src="/lyceum-logo.png"
              alt="The Lyceum"
              className="h-6 w-auto object-contain"
            />
          </div>
          <div className="hidden sm:flex items-center gap-8">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#simulation" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Simulation
            </a>
            <a href="#metrics" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Results
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
          </div>
          <Link
            href="/canvas"
            className="hidden sm:inline-flex items-center justify-center gap-2 h-8 rounded-md px-4 text-sm font-medium bg-[#0f0f13] text-white hover:bg-[#1a1a24] transition-colors"
          >
            Launch Canvas
          </Link>
          <Button
            size="sm"
            onClick={() => setWaitlistOpen(true)}
            className="bg-teal hover:bg-teal-dark text-white text-sm px-5"
          >
            Join Waitlist
          </Button>
        </div>
        </nav>
      </div>

      {/* Hero Section */}
      <section className="pt-40 pb-20 sm:pt-48 sm:pb-32 relative overflow-hidden">
        {/* Decorative geometric elements */}
        <div className="absolute top-20 right-8 sm:right-16 w-64 h-64 sm:w-96 sm:h-96 opacity-[0.04]">
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="180" stroke="#1a1a1a" strokeWidth="1" />
            <circle cx="200" cy="200" r="140" stroke="#0d9488" strokeWidth="0.5" />
            <circle cx="200" cy="200" r="100" stroke="#1a1a1a" strokeWidth="0.5" />
            <line x1="20" y1="200" x2="380" y2="200" stroke="#1a1a1a" strokeWidth="0.5" />
            <line x1="200" y1="20" x2="200" y2="380" stroke="#1a1a1a" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="absolute bottom-10 left-8 sm:left-16 w-32 h-32 opacity-[0.03]">
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="10" width="80" height="80" stroke="#0d9488" strokeWidth="1" />
            <line x1="10" y1="10" x2="90" y2="90" stroke="#1a1a1a" strokeWidth="0.5" />
          </svg>
        </div>

        <div className="container relative z-10">
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] as const }}
            className="max-w-3xl"
          >
            <p className="text-sm font-medium text-teal uppercase tracking-widest mb-6">
              Adaptive Audit Engine — Capped Beta
            </p>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-[1.08] tracking-tight mb-6">
              Stop auditing agent output by hand.
              <br />
              <span className="text-teal">Start trusting what ships.</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl mb-4">
              Founders, COOs, and Lead Engineers lose 15+ hours a week fixing bad agent
              output and combing through logs. The Adaptive Audit Engine reviews every
              decision in real time — under 1000ms — so nothing reaches production unchecked.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl mb-10">
              That latency guarantee is a hard infrastructure limit, not a promise —
              which is why Beta access is capped to a fixed number of teams.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-10">
              <Button
                size="lg"
                onClick={() => setWaitlistOpen(true)}
                className="bg-teal hover:bg-teal-dark text-white px-8 h-12 text-base"
              >
                Reserve My Slot
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => document.getElementById("metrics")?.scrollIntoView({ behavior: "smooth" })}
                className="border-border text-foreground hover:bg-secondary h-12 text-base"
              >
                See the Numbers
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
            <BetaSlotCounter />
          </motion.div>
        </div>
      </section>

      {/* Thin divider */}
      <div className="container">
        <div className="h-px bg-border" />
      </div>

      {/* Features Section */}
      <section id="features" className="py-24 sm:py-32">
        <div className="container">
          <motion.div {...fadeInUp} className="max-w-2xl mb-16">
            <p className="text-sm font-medium text-teal uppercase tracking-widest mb-4">
              Built for Teams
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
              AI shouldn't work alone.
              <br />
              Neither should your team.
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              The Lyceum provides the structure, oversight, and collaboration layer
              that turns scattered AI tools into an organized workforce.
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-12"
          >
            {features.map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeInUp}
                className="group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-teal/8 flex items-center justify-center shrink-0 group-hover:bg-teal/12 transition-colors">
                    <feature.icon className="w-5 h-5 text-teal" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-semibold text-foreground mb-2">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* AI Workflow Simulation */}
      <AIWorkflowSimulation />

      {/* Divider */}
      <div className="container">
        <div className="h-px bg-border" />
      </div>

      {/* Before / After Metrics */}
      <section id="metrics" className="py-24 sm:py-32">
        <div className="container">
          <motion.div {...fadeInUp} className="text-center max-w-2xl mx-auto mb-16">
            <p className="text-sm font-medium text-teal uppercase tracking-widest mb-4">
              Measured Impact
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
              Before The Lyceum. After.
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Real metrics from early adopters who moved from chaotic AI tooling
              to structured AI workforce management.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Before */}
            <motion.div {...fadeInUp}>
              <div className="rounded-xl border border-border p-8 sm:p-10">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-8">
                  Before — Scattered AI Tools
                </p>
                <div className="space-y-8">
                  {metricsBefore.map((metric, i) => (
                    <motion.div
                      key={i}
                      initial={{ x: -10, opacity: 0 }}
                      whileInView={{ x: 0, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1, duration: 0.4, ease: "easeOut" as const }}
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-display text-3xl sm:text-4xl font-bold text-muted-foreground/60">
                          {metric.decimal ? (
                            <AnimatedCounter target={metric.value} suffix={metric.suffix} />
                          ) : (
                            <AnimatedCounter target={metric.value} suffix={metric.suffix} />
                          )}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{metric.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* After */}
            <motion.div {...fadeInUp}>
              <div className="rounded-xl border-2 border-teal/20 bg-teal/[0.02] p-8 sm:p-10">
                <p className="text-xs font-medium text-teal uppercase tracking-widest mb-8">
                  After — The Lyceum
                </p>
                <div className="space-y-8">
                  {metricsAfter.map((metric, i) => (
                    <motion.div
                      key={i}
                      initial={{ x: 10, opacity: 0 }}
                      whileInView={{ x: 0, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.1, duration: 0.4, ease: "easeOut" as const }}
                    >
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-display text-3xl sm:text-4xl font-bold text-teal">
                          <AnimatedCounter target={metric.value} suffix={metric.suffix} />
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{metric.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Reduction highlights */}
          <motion.div
            {...fadeInUp}
            className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6"
          >
            {[
              { value: 91, suffix: "%", label: "Faster approval" },
              { value: 84, suffix: "%", label: "Less rework" },
              { value: 83, suffix: "%", label: "Fewer errors" },
              { value: 100, suffix: "%", label: "Full visibility" },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <p className="font-display text-2xl sm:text-3xl font-bold text-teal mb-1">
                  <AnimatedCounter target={item.value} suffix={item.suffix} />
                </p>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{item.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Divider */}
      <div className="container">
        <div className="h-px bg-border" />
      </div>

      {/* Value Pitch + Deposit CTA */}
      <section id="pricing" className="py-24 sm:py-32">
        <div className="container">
          <motion.div {...fadeInUp} className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-sm font-medium text-teal uppercase tracking-widest mb-4">
              Secure Your Slot
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
              One deposit. 60+ hours back, every month.
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">
              Teams that lock in a Beta slot today get guaranteed access to a system
              built to eliminate manual log review — teams report getting back
              60+ hours of audit time per month once the Engine is live on their stack.
            </p>
          </motion.div>

          <motion.div {...fadeInUp} className="max-w-md mx-auto">
            <div className="rounded-2xl border-2 border-teal/20 bg-teal/[0.02] p-8 sm:p-10">
              <div className="flex items-baseline justify-between mb-1">
                <span className="font-display text-lg font-semibold text-foreground">
                  Priority Access Deposit
                </span>
              </div>
              <p className="font-display text-4xl font-bold text-foreground mb-6">
                $22
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  one-time
                </span>
              </p>

              <ul className="space-y-3 text-left mb-8">
                {[
                  { icon: Clock, text: "Guaranteed onboarding within 48 hours of launch" },
                  { icon: Radio, text: "Priority server routing on the Adaptive Audit Engine" },
                  { icon: FileCheck, text: "One custom audit rule, built for your workflow" },
                ].map((perk, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-teal/10 flex items-center justify-center shrink-0 mt-0.5">
                      <perk.icon className="w-3.5 h-3.5 text-teal" />
                    </div>
                    <span className="text-sm text-foreground leading-relaxed">{perk.text}</span>
                  </li>
                ))}
              </ul>

              <Button
                size="lg"
                onClick={() => setWaitlistOpen(true)}
                className="w-full bg-teal hover:bg-teal-dark text-white h-12 text-base"
              >
                Reserve My Slot — $22 Deposit
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-4 leading-relaxed">
                Deposit applied toward your plan at launch.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img
              src="/favicon.png"
              alt="The Lyceum"
              className="w-5 h-5 object-contain"
            />
            <span className="text-sm text-muted-foreground">
              The Lyceum — AI Workforce Management
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} The Lyceum. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Waitlist Modal */}
      <WaitlistModal open={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
    </div>
  );
}
