import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowLeft, Home } from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────

const GLITCH_INTERVAL_MIN = 4000;
const GLITCH_INTERVAL_MAX = 12000;
const PARTICLE_COUNT = 30;
const FLOATING_SHAPES = 6;

// ── Particle helpers ─────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speedX: number;
  speedY: number;
  delay: number;
}

function generateParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    opacity: Math.random() * 0.4 + 0.1,
    speedX: (Math.random() - 0.5) * 0.3,
    speedY: (Math.random() - 0.5) * 0.3,
    delay: Math.random() * 5,
  }));
}

// ── Component ────────────────────────────────────────────────────────────────

export default function NotFound() {
  const [, setLocation] = useLocation();
  const [glitchActive, setGlitchActive] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const glitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particlesRef = useRef(generateParticles());

  // ── Glitch effect ────────────────────────────────────────────────────────

  const triggerGlitch = useCallback(() => {
    setGlitchActive(true);
    setTimeout(() => setGlitchActive(false), 250);

    const nextDelay =
      Math.random() * (GLITCH_INTERVAL_MAX - GLITCH_INTERVAL_MIN) +
      GLITCH_INTERVAL_MIN;
    glitchTimerRef.current = setTimeout(triggerGlitch, nextDelay);
  }, []);

  useEffect(() => {
    const initialDelay =
      Math.random() * (GLITCH_INTERVAL_MAX - GLITCH_INTERVAL_MIN) +
      GLITCH_INTERVAL_MIN;
    glitchTimerRef.current = setTimeout(triggerGlitch, initialDelay);
    return () => {
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
    };
  }, [triggerGlitch]);

  // ── Mouse parallax ───────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      setMousePos({ x, y });
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => container.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // ── Particle animation tick ──────────────────────────────────────────────

  const [, forceRender] = useState(0);
  useEffect(() => {
    let frame: number;
    const tick = () => {
      particlesRef.current = particlesRef.current.map((p) => ({
        ...p,
        x: p.x + p.speedX,
        y: p.y + p.speedY,
        ...(p.x > 100 && { x: 0 }),
        ...(p.x < 0 && { x: 100 }),
        ...(p.y > 100 && { y: 0 }),
        ...(p.y < 0 && { y: 100 }),
      }));
      forceRender((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ── Floating shapes config ───────────────────────────────────────────────

  const shapes = Array.from({ length: FLOATING_SHAPES }, (_, i) => ({
    id: i,
    type: (["circle", "square", "diamond"] as const)[i % 3],
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 40 + 20,
    floatY: Math.random() * 20 + 10,
    floatDuration: Math.random() * 6 + 4,
    floatDelay: Math.random() * 3,
    opacity: Math.random() * 0.08 + 0.03,
  }));

  // ── Glitch clip paths ────────────────────────────────────────────────────

  const glitchClip1 = "polygon(0 0, 100% 0, 100% 45%, 0 55%)";
  const glitchClip2 = "polygon(0 55%, 100% 45%, 100% 100%, 0 100%)";
  const glitchOffset1 = `${(Math.random() - 0.5) * 12}px`;
  const glitchOffset2 = `${(Math.random() - 0.5) * 12}px`;

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#07070a]"
    >
      {/* ── Gradient background ──────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12] via-[#07070a] to-[#0a0a12]" />

      {/* ── Radial glow ──────────────────────────────────────────────────── */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.04]"
        style={{
          background:
            "radial-gradient(circle, rgba(38,99,71,1) 0%, transparent 70%)",
        }}
      />

      {/* ── Particles ────────────────────────────────────────────────────── */}
      {particlesRef.current.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            background: "rgba(255,255,255,0.4)",
            boxShadow: "0 0 4px rgba(38,99,71,0.3)",
          }}
          animate={{
            opacity: [p.opacity * 0.5, p.opacity, p.opacity * 0.5],
          }}
          transition={{
            duration: 3,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* ── Floating decorative shapes ──────────────────────────────────── */}
      {shapes.map((s) => (
        <motion.div
          key={s.id}
          className="absolute border border-white/10"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            borderRadius: s.type === "circle" ? "50%" : s.type === "square" ? "4px" : "2px",
            transform: s.type === "diamond" ? "rotate(45deg)" : "none",
            opacity: s.opacity,
          }}
          animate={{
            y: [0, -s.floatY, 0],
            opacity: [s.opacity * 0.5, s.opacity, s.opacity * 0.5],
            rotate: s.type === "diamond" ? [45, 60, 45] : [0, 5, 0],
          }}
          transition={{
            duration: s.floatDuration,
            delay: s.floatDelay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* ── Grid pattern overlay ─────────────────────────────────────────── */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-6">
        {/* ── Animated 404 text ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            duration: 1.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative select-none"
          style={{
            transform: `translate(${mousePos.x * 15}px, ${mousePos.y * 15}px)`,
          }}
        >
          {/* Glow behind */}
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[200px] rounded-full blur-[80px]"
            style={{
              background:
                "radial-gradient(ellipse, rgba(38,99,71,0.15) 0%, transparent 70%)",
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* 404 text with float */}
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="relative"
          >
            {/* Main 404 */}
            <h1
              className={`text-[clamp(6rem,20vw,14rem)] font-bold leading-none tracking-[-0.04em] font-display ${
                glitchActive ? "opacity-0" : "opacity-100"
              }`}
              style={{
                background:
                  "linear-gradient(135deg, #e8e8ea 0%, #ffffff 40%, #a0a0b0 70%, #ffffff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 4px 20px rgba(38,99,71,0.15))",
              }}
            >
              404
            </h1>

            {/* Glitch layer 1 */}
            {glitchActive && (
              <span
                className="absolute inset-0 text-[clamp(6rem,20vw,14rem)] font-bold leading-none tracking-[-0.04em] font-display pointer-events-none"
                style={{
                  clipPath: glitchClip1,
                  left: glitchOffset1,
                  color: "rgba(38, 99, 71, 0.7)",
                }}
                aria-hidden
              >
                404
              </span>
            )}

            {/* Glitch layer 2 */}
            {glitchActive && (
              <span
                className="absolute inset-0 text-[clamp(6rem,20vw,14rem)] font-bold leading-none tracking-[-0.04em] font-display pointer-events-none"
                style={{
                  clipPath: glitchClip2,
                  left: glitchOffset2,
                  color: "rgba(200, 60, 60, 0.5)",
                }}
                aria-hidden
              >
                404
              </span>
            )}
          </motion.div>
        </motion.div>

        {/* ── Decorative line ────────────────────────────────────────────── */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-[60px] h-[1.5px] mt-8 origin-center"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(38,99,71,0.6), transparent)",
          }}
        />

        {/* ── Error message ──────────────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.8,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-6 text-[15px] text-white/40 font-light tracking-wide text-center max-w-md leading-relaxed"
        >
          This page has drifted beyond the known universe.
          <br />
          <span className="text-white/25 text-[13px]">
            The link may be broken, or the page may have been moved into the
            void.
          </span>
        </motion.p>

        {/* ── Action buttons ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 1.0,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-10 flex flex-col sm:flex-row items-center gap-4"
        >
          <button
            onClick={() => setLocation("/")}
            className="group relative flex items-center gap-2.5 px-6 py-3 rounded-full text-[13px] font-medium tracking-wide overflow-hidden transition-all duration-300"
            style={{
              background: "rgba(38,99,71,1)",
              color: "#fff",
            }}
          >
            <span
              className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  "linear-gradient(135deg, rgba(38,99,71,1) 0%, rgba(50,130,90,1) 100%)",
              }}
            />
            <Home className="relative z-10 w-3.5 h-3.5" />
            <span className="relative z-10">Return Home</span>
          </button>

          <button
            onClick={() => window.history.back()}
            className="group flex items-center gap-2.5 px-6 py-3 rounded-full text-[13px] font-medium tracking-wide transition-all duration-300"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.6)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
              e.currentTarget.style.color = "rgba(255,255,255,0.85)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Go Back
          </button>
        </motion.div>

        {/* ── Status code badge ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.4 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2"
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "rgba(38,99,71,0.5)" }}
          />
          <span className="text-[10px] text-white/15 tracking-widest uppercase">
            Error 404 — Page Not Found
          </span>
        </motion.div>
      </div>
    </div>
  );
}
