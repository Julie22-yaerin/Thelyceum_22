import { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  ArrowRight, Zap, Shield, Users, Brain, Sparkles, Play, Trash2, Plus, Crown,
} from "lucide-react";
import WaitlistModal from "@/components/WaitlistModal";
import AnimatedCounter from "@/components/AnimatedCounter";
import AIWorkflowSimulation from "@/components/AIWorkflowSimulation";
import CanvasWorkforceDemo from "@/components/CanvasWorkforceDemo";
import { LicenseKeyEntry } from "@/components/LicenseKeyEntry";

import "@/styles/hero.css";

/* ── Animation Variants ─────────────────────────────────────────────────────── */

const ease = [0.16, 1, 0.3, 1] as const;

const fadeInUp = {
  initial: { y: 24, opacity: 0 },
  whileInView: { y: 0, opacity: 1 },
  viewport: { once: true },
  transition: { duration: 0.7, ease },
};

const staggerContainer = {
  initial: {},
  whileInView: { transition: { staggerChildren: 0.1 } },
  viewport: { once: true },
};

/* ── Data ────────────────────────────────────────────────────────────────────── */

const testimonials = [
  {
    quote: "I've been in the beta since Day 1. Every morning there's something new — a feature request from yesterday is already live. It's wild watching a product evolve this fast.",
    name: "Marcus Chen",
    role: "Engineering Lead",
    company: "NexGen Robotics",
    avatar: "MC",
  },
  {
    quote: "The transparency is what got me. Instead of a black-box roadmap, I see the changelog update in real time. I suggested a workflow tweak and it shipped 48 hours later.",
    name: "Priya Kapoor",
    role: "AI Product Manager",
    company: "Synthesis AI",
    avatar: "PK",
  },
  {
    quote: "Day 3: I couldn't even get my team in. Day 4: the onboarding flow was completely revamped. That's the pace. You don't wait for updates — you wake up to them.",
    name: "James Okonkwo",
    role: "CTO",
    company: "Vivida Labs",
    avatar: "JO",
  },
  {
    quote: "We went from fragmented AI tools to a single canvas where agents talk to each other. And I watched it get better every single day. This is how software should be built.",
    name: "Elena Vasquez",
    role: "VP of Operations",
    company: "Orion Health",
    avatar: "EV",
  },
  {
    quote: "I paid $52 and got access immediately. No waiting list, no 'we'll email you'. Just straight into the workspace. The daily changelog banner is my favorite part — it's like getting a present every morning.",
    name: "Aiden Park",
    role: "Founder",
    company: "Park AI Consulting",
    avatar: "AP",
  },
];

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

/* ── 4-Dot Grid SVG ──────────────────────────────────────────────────────────── */

function GridIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <circle cx="3" cy="3" r="1.5" fill="white" />
      <circle cx="9" cy="3" r="1.5" fill="white" />
      <circle cx="3" cy="9" r="1.5" fill="white" />
      <circle cx="9" cy="9" r="1.5" fill="white" />
    </svg>
  );
}

/* ── Logo PNG ────────────────────────────────────────────────────────────────── */

function LogoImage({ className, size }: { className?: string; size?: number }) {
  return (
    <img
      src="/lyceum-logo.png"
      alt="The Lyceum"
      className={className}
      style={{ width: size || 28, height: size || 28, objectFit: "contain" }}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════════════
   Home — Landing Page
   ════════════════════════════════════════════════════════════════════════════════ */

export default function Home() {
  const [, setLocation] = useLocation();
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [licenseKeyOpen, setLicenseKeyOpen] = useState(false);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#fff", minHeight: "100vh" }}>
      {/* ── Hero Section ──────────────────────────────────────────────────────── */}
      <section className="hero">

        {/* Parallax background layers (CSS-only, fixed attachment) */}
        <div className="hero__parallax">
          <div className="hero__parallax-dots" />
          <div className="hero__parallax-orb" />
          <div className="hero__parallax-orb hero__parallax-orb--bottom" />
        </div>

        {/* Navbar */}
        <motion.nav
          className="hero__nav"
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease }}
        >
          <div className="hero__nav-left">
            {/* Logo */}
            <a href="/" className="hero__logo" style={{ textDecoration: "none" }}>
              <LogoImage className="hero__logo-icon" />
              <span className="hero__logo-text">The Lyceum</span>
            </a>

            {/* Menu button */}
            <button className="hero__menu-btn" onClick={() => setWaitlistOpen(true)}>
              <span className="hero__menu-btn-circle">
                <Plus size={12} strokeWidth={3} color="#111" />
              </span>
              <span className="hero__menu-btn-text">Menu</span>
            </button>

            {/* Tags pill */}
            <div className="hero__tags-pill">
              <span className="hero__tags-pill-label">AI Workforce</span>
              <span className="hero__tags-pill-label">Agent Collaboration</span>
            </div>
          </div>

          <div className="hero__nav-right">
            {/* Right pill */}
            <div className="hero__right-pill">
              <button className="hero__right-pill-btn" onClick={() => setLicenseKeyOpen(true)}>
                <GridIcon size={12} />
              </button>
              <span className="hero__right-pill-label">Adaptive Systems</span>
            </div>
          </div>
        </motion.nav>

        {/* Footer content pinned to bottom */}
        <motion.div
          className="hero__footer"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, delay: 0.5, ease }}
        >
          <div className="hero__footer-inner">
            <div className="hero__footer-left">
              {/* Subtitle */}
              <motion.div
                className="hero__subtitle"
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.6, ease }}
              >
                <span className="hero__subtitle-dot" />
                <span className="hero__subtitle-text">AI Workforce & Collaboration Canvas — 2026</span>
              </motion.div>

              {/* Heading */}
              <motion.h1
                className="hero__heading"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.8, ease }}
              >
                One Platform.
                <br />
                Zero Limits. <span style={{ fontWeight: 300, color: "#888" }}>Worldwide.</span>
              </motion.h1>

              {/* Buttons */}
              <motion.div
                className="hero__buttons"
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 1.0, ease }}
              >
                <button
                  className="hero__btn-primary"
                  onClick={() => setWaitlistOpen(true)}
                >
                  See Features
                  <ArrowRight style={{ width: 14, height: 14 }} />
                </button>
                <button
                  className="hero__btn-secondary"
                  onClick={() => {
                    const el = document.getElementById("metrics");
                    if (!el) return;
                    const navH = 80; // fixed navbar height
                    const top = el.getBoundingClientRect().top + window.scrollY - navH;
                    window.scrollTo({ top, behavior: "smooth" });
                  }}
                >
                  How It Works
                </button>
              </motion.div>
            </div>

            {/* Right block — tags */}
            <motion.div
              className="hero__footer-right"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.2, ease }}
            >
              <span className="hero__tag">Neuromorphic</span>
              <span className="hero__tag">AGI</span>
              <span className="hero__tag">Cybernetics</span>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── Canvas Workforce Demo (zero scroll impact) ──────────────────── */}
      <CanvasWorkforceDemo onNavigateToWorkspace={() => setLocation("/onboarding")} />

      {/* ── Below Hero: Existing Sections ─────────────────────────────────────── */}

      {/* ── Features Section ──────────────────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <motion.div {...fadeInUp}>
          <p className="landing-section__label">Built for Teams</p>
          <h2 className="landing-section__title">
            AI shouldn't work alone.
            <br />
            Neither should your team.
          </h2>
          <p className="landing-section__desc">
            The Lyceum provides the structure, oversight, and collaboration layer
            that turns scattered AI tools into an organized workforce.
          </p>
        </motion.div>

        <motion.div variants={staggerContainer} className="landing-features" style={{ marginTop: 56 }}>
          {features.map((feature, i) => (
            <motion.div key={i} variants={fadeInUp} className="landing-feature">
              <div className="landing-feature__icon">
                <feature.icon />
              </div>
              <div>
                <h3 className="landing-feature__title">{feature.title}</h3>
                <p className="landing-feature__desc">{feature.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── AI Workflow Simulation ────────────────────────────────────────────── */}
      <AIWorkflowSimulation />

      {/* ── Divider ───────────────────────────────────────────────────────────── */}
      <div className="landing-divider" />

      {/* ── Before / After Metrics ────────────────────────────────────────────── */}
      <section id="metrics" className="landing-section">
        <motion.div {...fadeInUp} style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 56px" }}>
          <p className="landing-section__label">Measured Impact</p>
          <h2 className="landing-section__title">Before The Lyceum. After.</h2>
          <p className="landing-section__desc" style={{ margin: "0 auto" }}>
            Real metrics from early adopters who moved from chaotic AI tooling
            to structured AI workforce management.
          </p>
        </motion.div>

        <div className="landing-metrics">
          {/* Before */}
          <motion.div {...fadeInUp}>
            <div className="landing-metric-card">
              <p className="landing-metric-card__label">Before — Scattered AI Tools</p>
              {metricsBefore.map((metric, i) => (
                <motion.div
                  key={i}
                  className="landing-metric-row"
                  initial={{ x: -10, opacity: 0 }}
                  whileInView={{ x: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.4, ease: "easeOut" }}
                >
                  <div className="landing-metric-value">
                    <AnimatedCounter target={metric.value} suffix={metric.suffix} />
                  </div>
                  <p className="landing-metric-label">{metric.label}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* After */}
          <motion.div {...fadeInUp}>
            <div className="landing-metric-card landing-metric-card--highlight">
              <p className="landing-metric-card__label">After — The Lyceum</p>
              {metricsAfter.map((metric, i) => (
                <motion.div
                  key={i}
                  className="landing-metric-row"
                  initial={{ x: 10, opacity: 0 }}
                  whileInView={{ x: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.4, ease: "easeOut" }}
                >
                  <div className="landing-metric-value">
                    <AnimatedCounter target={metric.value} suffix={metric.suffix} />
                  </div>
                  <p className="landing-metric-label">{metric.label}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Reduction highlights */}
        <motion.div {...fadeInUp} className="landing-reductions">
          {[
            { value: 91, suffix: "%", label: "Faster approval" },
            { value: 84, suffix: "%", label: "Less rework" },
            { value: 83, suffix: "%", label: "Fewer errors" },
            { value: 100, suffix: "%", label: "Full visibility" },
          ].map((item, i) => (
            <div key={i}>
              <div className="landing-reduction__value">
                <AnimatedCounter target={item.value} suffix={item.suffix} />
              </div>
              <p className="landing-reduction__label">{item.label}</p>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ── Divider ───────────────────────────────────────────────────────────── */}
      <div className="landing-divider" />

      {/* ── Value Pitch + Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="landing-section">
        <motion.div {...fadeInUp} style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 56px" }}>
          <p className="landing-section__label">Enter the Live Beta</p>
          <h2 className="landing-section__title">
            Immediate access. Daily evolution.
          </h2>
          <p className="landing-section__desc" style={{ margin: "0 auto" }}>
            Skip the wait. Pre-order unlocks the live beta workspace instantly —
            you'll see new features, improvements, and fixes every single day
            as we build in the open.
          </p>
        </motion.div>

        <motion.div {...fadeInUp} className="landing-pricing">
          <div className="landing-pricing__name">Live Beta Access</div>
          <div className="landing-pricing__price">
            $52
            <span className="landing-pricing__price-sub">one-time deposit</span>
          </div>

          <ul className="landing-pricing__perks">
            {[
              { icon: Zap, text: "Live beta access — the deterministic proxy and audit harness" },
              { icon: Shield, text: "Bring your own keys — swap one base URL, no SDK, no refactor" },
              { icon: Sparkles, text: "Daily improvements, with a changelog you can actually read" },
              {
                icon: Crown,
                text: "Founder Pass ($222) adds roadmap voting, governance templates (Dev / Finance / MCP), and a private support channel",
              },
            ].map((perk, i) => (
              <li key={i} className="landing-pricing__perk">
                <div className="landing-pricing__perk-icon">
                  <perk.icon />
                </div>
                <span>{perk.text}</span>
              </li>
            ))}
          </ul>

          <button
            className="hero__btn-primary"
            style={{ width: "100%", justifyContent: "center", padding: "14px 20px" }}
            onClick={() => setWaitlistOpen(true)}
          >
            Enter Live Beta — $52
            <ArrowRight style={{ width: 14, height: 14 }} />
          </button>
          <p className="landing-pricing__note">
            One-time deposit. No subscription required.
          </p>
        </motion.div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────────── */}
      <div className="landing-divider" />
      <section className="landing-section">
        <motion.div {...fadeInUp} style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 48px" }}>
          <p className="landing-section__label">Early Adopters</p>
          <h2 className="landing-section__title">
            They saw it happen. Day by day.
          </h2>
          <p className="landing-section__desc" style={{ margin: "0 auto" }}>
            Real beta users who joined early and watched the product reshape itself
            in front of them.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          className="landing-testimonials"
        >
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              variants={fadeInUp}
              className="landing-testimonial"
            >
              <div className="landing-testimonial__quote">
                &ldquo;{t.quote}&rdquo;
              </div>
              <div className="landing-testimonial__author">
                <div className="landing-testimonial__avatar">
                  {t.avatar}
                </div>
                <div>
                  <p className="landing-testimonial__name">{t.name}</p>
                  <p className="landing-testimonial__role">{t.role} · {t.company}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── Site Footer ───────────────────────────────────────────────────────── */}
      <footer className="landing-site-footer">
        <div className="landing-site-footer__inner">
          <div className="landing-site-footer__brand">
            <LogoImage size={20} />
            <span>The Lyceum — AI Workforce Management</span>
          </div>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="/terms" className="hover:text-foreground transition-colors">Terms of Service</a>
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="/refund-policy" className="hover:text-foreground transition-colors">Refund Policy</a>
          </nav>
          <p className="landing-site-footer__copy">
            &copy; {new Date().getFullYear()} The Lyceum. All rights reserved.
          </p>
        </div>
      </footer>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <WaitlistModal open={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
      <LicenseKeyEntry open={licenseKeyOpen} onClose={() => setLicenseKeyOpen(false)} />
    </div>
  );
}
