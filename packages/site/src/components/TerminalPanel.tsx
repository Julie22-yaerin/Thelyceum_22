import type { ReactNode } from "react";

type TerminalPanelProps = {
  title: string;
  children: ReactNode;
  className?: string;
};

export function TerminalPanel({ title, children, className = "" }: TerminalPanelProps) {
  return (
    <div className={`rounded-xl bg-[#101110] overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-white/10">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="ml-2 text-[10px] tracking-wide text-white/40">{title}</span>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

type StatRowProps = {
  label: string;
  value: string;
  note?: string;
  emphasize?: boolean;
  accent?: "brake" | "redteam" | "thrift" | "none";
};

const accentColor: Record<NonNullable<StatRowProps["accent"]>, string> = {
  brake: "text-[#e2665a]",
  redteam: "text-[#a897f0]",
  thrift: "text-[#d9a441]",
  none: "text-white",
};

export function StatRow({ label, value, note, emphasize, accent = "none" }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[12.5px] font-mono">
      <span className="text-white/45 shrink-0">{label}</span>
      <span className="flex-1 border-b border-dotted border-white/10 mb-1" />
      <span
        className={`shrink-0 [font-variant-numeric:tabular-nums] ${
          emphasize ? `font-semibold ${accentColor[accent]}` : "text-white/80"
        }`}
      >
        {value}
        {note ? <span className="text-white/35 font-normal"> {note}</span> : null}
      </span>
    </div>
  );
}
