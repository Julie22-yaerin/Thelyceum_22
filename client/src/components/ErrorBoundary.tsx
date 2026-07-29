import { Component, ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state;

      return (
        <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#07070a]">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a12] via-[#07070a] to-[#0a0a12]" />

          {/* Radial glow */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.04]"
            style={{
              background:
                "radial-gradient(circle, rgba(200,60,60,1) 0%, transparent 70%)",
            }}
          />

          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Floating particles */}
          {Array.from({ length: 15 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                width: Math.random() * 3 + 1,
                height: Math.random() * 3 + 1,
                opacity: Math.random() * 0.15 + 0.05,
                background: "rgba(255,100,100,0.3)",
              }}
              animate={{
                opacity: [0.05, 0.15, 0.05],
                y: [0, -20, 0],
              }}
              transition={{
                duration: Math.random() * 4 + 3,
                delay: Math.random() * 3,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center px-6 max-w-lg">
            {/* Error icon */}
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="relative mb-8"
            >
              {/* Glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full blur-[40px]"
                style={{
                  background:
                    "radial-gradient(circle, rgba(200,60,60,0.2) 0%, transparent 70%)",
                }}
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={28} className="text-red-400" />
              </div>
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.3,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="text-xl font-semibold text-white/90 mb-3 text-center"
            >
              An Unexpected Error Occurred
            </motion.h2>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.5,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="text-[13px] text-white/35 font-light text-center mb-8 leading-relaxed"
            >
              Something went wrong on our end. The error details are below —
              they may help diagnose the issue.
            </motion.p>

            {/* Error stack */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.7,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="w-full mb-8"
            >
              <div
                className="p-4 rounded-xl overflow-auto max-h-[200px] text-xs font-mono leading-relaxed"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.3)",
                }}
              >
                {error?.stack || error?.message || "Unknown error"}
              </div>
            </motion.div>

            {/* Reload button */}
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.9,
                ease: [0.16, 1, 0.3, 1],
              }}
              onClick={() => window.location.reload()}
              className="group relative flex items-center gap-2.5 px-6 py-3 rounded-full text-[13px] font-medium tracking-wide overflow-hidden transition-all duration-300"
              style={{
                background: "rgba(200,60,60,1)",
                color: "#fff",
              }}
            >
              <span
                className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(200,60,60,1) 0%, rgba(220,80,80,1) 100%)",
                }}
              />
              <RotateCcw className="relative z-10 w-3.5 h-3.5" />
              <span className="relative z-10">Reload Page</span>
            </motion.button>

            {/* Bottom badge */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 1.2 }}
              className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2"
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "rgba(200,60,60,0.5)" }}
              />
              <span className="text-[10px] text-white/15 tracking-widest uppercase">
                Runtime Error — Please Reload
              </span>
            </motion.div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
