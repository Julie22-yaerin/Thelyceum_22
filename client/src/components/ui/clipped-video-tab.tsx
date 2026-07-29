"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  BrainCircuit,
  Bot,
  Database,
  CheckCircle2,
  LoaderCircle,
  Circle,
  Cpu,
  Lock,
  Zap,
  Brain,
  Mic,
} from "lucide-react";

const items = [
  {
    icon: Zap,
    label: "Data Annotation",
    title: "Data Annotation",
    description:
      "Multimodal workflows for image, video, and 3D annotation with high-accuracy quality control.",

    video: "https://res.cloudinary.com/dy4bqxt8p/video/upload/v1779622196/new107_qhrklf.mp4",

    card: {
      heading: "Data Transcription",
      badge: "Live",
      goal:
        "Deploy multimodal pipelines across multiple international regions.",

      tasks: [
        {
          title: "Regional onboarding",
          meta: "Completed in 4.2s",
          status: "completed",
        },
        {
          title: "Deploy collection teams",
          meta: "Completed in 8.1s",
          status: "completed",
        },
        {
          title: "Scale infrastructure",
          meta: "In progress... 18s",
          status: "progress",
        },
        {
          title: "Validate datasets",
          meta: "Pending",
          status: "pending",
        },
      ],
    },
  },

  {
    icon: Lock,
    label: "Data Collection",
    title: "Data Collection",
    description:
      "High-speed multimodal data collection pipelines to capture and structure real-world datasets.",

    video: "https://res.cloudinary.com/dy4bqxt8p/video/upload/v1779621768/new105_meaomd.mp4",

    card: {
      heading: "Data Collection",
      badge: "Data-Ready",
      goal:
        "Prepare large-scale datasets for training multimodal reasoning systems.",

      tasks: [
        {
          title: "Process raw data",
          meta: "Completed in 3.1s",
          status: "completed",
        },
        {
          title: "Generate annotations",
          meta: "Completed in 5.4s",
          status: "completed",
        },
        {
          title: "Train reasoning model",
          meta: "In progress... 24s",
          status: "progress",
        },
        {
          title: "Run evaluation tests",
          meta: "Pending",
          status: "pending",
        },
      ],
    },
  },

  {
    icon: Mic,
    label: "Audio and Speech",
    title: "Audio and Speech",
    description:
      "Automation-first AI systems with human validation and scalable workflows.",

    video: "https://res.cloudinary.com/dy4bqxt8p/video/upload/v1779622220/new108_k1a47m.mp4",

    card: {
      heading: "Audio Transcription",
      badge: "Auto-generated",
      goal:
        "Build a REST API endpoint for user authentication with JWT tokens.",

      tasks: [
        {
          title: "Gather requirements",
          meta: "Completed in 2.3s",
          status: "completed",
        },
        {
          title: "Research solutions",
          meta: "Completed in 5.1s",
          status: "completed",
        },
        {
          title: "Implement solution",
          meta: "In progress... 12s",
          status: "progress",
        },
        {
          title: "Test and validate",
          meta: "Pending",
          status: "pending",
        },
      ],
    },
  },

  {
    icon: Database,
    label: "Explainable AI",
    title: "Data Engine",
    description:
      "Transparent AI models with interpretable predictions and decision-making insights.",

    video: "https://res.cloudinary.com/dy4bqxt8p/video/upload/v1779622271/02_u2efg7.mp4",

    card: {
      heading: "Pipeline Engine",
      badge: "Optimized",
      goal:
        "Process and validate multimodal datasets for enterprise deployment.",

      tasks: [
        {
          title: "Upload raw datasets",
          meta: "Completed in 1.9s",
          status: "completed",
        },
        {
          title: "Run QA workflows",
          meta: "Completed in 6.7s",
          status: "completed",
        },
        {
          title: "Generate metadata",
          meta: "In progress... 16s",
          status: "progress",
        },
        {
          title: "Export training package",
          meta: "Pending",
          status: "pending",
        },
      ],
    },
  },
];

export default function ClippedVideoTab()  {
  const [activeTab, setActiveTab] = useState(0);

  const activeItem = items[activeTab];

  return (
    <section className="bg-[#f5f5f3] py-20 overflow-hidden">

      {/* TOP */}
      <div className="max-w-7xl mx-auto px-6">

        <div className="grid md:grid-cols-2 gap-14 items-start mb-10">

          {/* LEFT */}
          <div>
            <h2 className="text-[46px] leading-[50px] tracking-tight font-bold text-[#131313] max-w-2xl">
              Our Platforms
            </h2>
          </div>

          {/* RIGHT */}
          <div>
            <p className="text-[18px] leading-[32px] text-[#666] max-w-lg">
              AI-powered platforms for enterprise workforce collaboration — designed for <span className="font-medium text-black">The Lyceum</span>.
            </p>
          </div>

        </div>

      </div>

      {/* IMAGE AREA */}
      <div className="max-w-7xl mx-auto px-6 relative">

        {/* FLOATING TABS */}
        <div className="absolute left-2 bottom-16 z-20">

          <div className="bg-white rounded-[28px] shadow-xl border border-[#e8e8e8] p-3 w-[240px]">

            <div className="flex flex-col gap-2">

              {items.map((tab, index) => {
                const Icon = tab.icon;

                return (
                  <button
                    key={index}
                    onClick={() => setActiveTab(index)}
                    className={`
                      group flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-300 border
                      ${
                        activeTab === index
                          ? "bg-[#f4fbf7] border-[#266347]"
                          : "border-transparent hover:border-[#266347] hover:bg-[#f8fffb]"
                      }
                    `}
                  >
                    <Icon
                      className={`
                        w-5 h-5 transition-colors duration-300
                        ${
                          activeTab === index
                            ? "text-[#266347]"
                            : "text-[#131313] group-hover:text-[#266347]"
                        }
                      `}
                    />

                    <span
                      className={`
                        text-[15px] font-medium transition-colors duration-300
                        ${
                          activeTab === index
                            ? "text-[#266347]"
                            : "text-[#131313] group-hover:text-[#266347]"
                        }
                      `}
                    >
                      {tab.label}
                    </span>
                  </button>
                );
              })}

            </div>

          </div>

        </div>

        {/* VIDEO CONTAINER */}
        <div
          className="relative overflow-hidden h-[690px]"
          style={{
            clipPath:
              "polygon(0 0, 92% 0, 100% 12%, 100% 100%, 30% 100%, 22% 88%, 0 88%)",
            borderRadius: "34px",
          }}
        >

          {/* VIDEO */}
          <AnimatePresence mode="wait">

            <motion.video
              key={activeItem.video}
              src={activeItem.video}
              autoPlay
              muted
              loop
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="absolute inset-0 w-full h-full object-cover"
            />

          </AnimatePresence>

          {/* OVERLAY */}
          <div className="absolute inset-0 bg-black/10" />

          {/* CENTER CARD */}
          <div className="absolute inset-0 flex items-center justify-center">

            <AnimatePresence mode="wait">

              <motion.div
                key={activeItem.card.heading}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 14 }}
                transition={{ duration: 0.35 }}
                className="w-[320px] rounded-[26px] border border-white/30 bg-white/80 backdrop-blur-xl shadow-2xl p-5"
              >

                {/* HEADER */}
                <div className="flex items-center justify-between">

                  <h3 className="text-[18px] font-semibold text-[#131313]">
                    {activeItem.card.heading}
                  </h3>

                  <span className="text-[11px] bg-[#eef8f2] text-[#266347] px-2 py-1 rounded-md">
                    {activeItem.card.badge}
                  </span>

                </div>

                {/* GOAL */}
                <div className="mt-4 border border-[#e7e7e7] rounded-xl p-3">

                  <p className="text-[11px] text-[#777]">
                    Goal
                  </p>

                  <p className="text-[13px] leading-[20px] mt-1 text-[#131313]">
                    {activeItem.card.goal}
                  </p>

                </div>

                {/* TASKS */}
                <div className="mt-4 flex flex-col gap-3">

                  {activeItem.card.tasks.map((task, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2"
                    >

                      {/* ICON */}
                      <div className="mt-[2px]">

                        {task.status === "completed" && (
                          <CheckCircle2 className="w-4 h-4 text-[#266347]" />
                        )}

                        {task.status === "progress" && (
                          <LoaderCircle className="w-4 h-4 text-[#266347]" />
                        )}

                        {task.status === "pending" && (
                          <Circle className="w-4 h-4 text-[#bdbdbd]" />
                        )}

                      </div>

                      {/* CONTENT */}
                      <div>

                        <p
                          className={`
                            text-[13px]
                            ${
                              task.status === "completed"
                                ? "line-through text-[#666]"
                                : task.status === "progress"
                                ? "text-[#266347] font-medium"
                                : "text-[#999]"
                            }
                          `}
                        >
                          {task.title}
                        </p>

                        <p className="text-[11px] text-[#999]">
                          {task.meta}
                        </p>

                      </div>

                    </div>
                  ))}

                </div>

                {/* FOOTER */}
                <div className="flex items-center justify-between mt-5 text-[11px] text-[#888]">

                  <span>2/5 tasks complete</span>

                  <span>Est. 45s remaining</span>

                </div>

              </motion.div>

            </AnimatePresence>

          </div>

        </div>

      </div>

    </section>
  );
}
