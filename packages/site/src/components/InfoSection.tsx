import { ArrowRight } from "lucide-react";
import { TerminalPanel, StatRow } from "./TerminalPanel";

export default function InfoSection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24">
      <div className="max-w-[88rem] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16 items-start">
          <div>
            <h2
              className="text-black text-4xl md:text-5xl font-medium leading-tight mb-8"
              style={{ letterSpacing: "-0.03em" }}
            >
              Meet The Lyceum.
            </h2>
            <a
              href="#evidence"
              className="inline-flex items-center gap-3 bg-black text-white text-base font-medium pl-8 pr-2 py-2 rounded-full hover:bg-gray-800 transition-colors duration-200"
            >
              See the evidence
              <span className="bg-white rounded-full p-2">
                <ArrowRight className="w-5 h-5 text-black" />
              </span>
            </a>
          </div>
          <p className="text-black/70 text-2xl md:text-3xl leading-relaxed">
            The Lyceum is a deterministic guardrail suite that sits on the hot
            path of every agent tool call — measuring, blocking, and
            deduplicating before a mistake becomes a bill.
          </p>
        </div>

        <div id="evidence" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1 — thrift: real CLI token-savings run, replaces the stock
              bank-image card from the template. */}
          <div className="lg:col-span-2 rounded-2xl bg-black p-7 min-h-80 flex flex-col justify-between">
            <div>
              <p className="text-white text-2xl font-medium leading-snug mb-1" style={{ letterSpacing: "-0.02em" }}>
                Every re-read, accounted for.
              </p>
              <p className="text-white/50 text-sm mb-5">thrift — one real agent session, not a synthetic benchmark</p>
            </div>
            <TerminalPanel title="thrift measure .">
              <StatRow label="before" value="175,565 tokens" />
              <StatRow label="after" value="79,501 tokens" />
              <StatRow label="saved" value="96,064" note="(54.7%)" emphasize accent="thrift" />
              <div className="h-2" />
              <StatRow label="lossless" value="68,128 tokens" note="dedupe + noise removal — free" />
              <StatRow label="lossy" value="27,936 tokens" note="truncation — the model sees less" />
            </TerminalPanel>
          </div>

          {/* Card 2 — redteam: real detection/block run, replaces the solid
              "always pegged" card. */}
          <div className="rounded-2xl p-7 min-h-80 flex flex-col justify-between" style={{ backgroundColor: "#2B2644" }}>
            <div>
              <p className="text-white text-2xl font-medium leading-snug mb-1" style={{ letterSpacing: "-0.02em" }}>
                Every claim,
                <br />
                challenged.
              </p>
              <p className="text-white/50 text-sm mb-5">redteam — 15-claim internal test set</p>
            </div>
            <TerminalPanel title="redteam eval">
              <StatRow label="tested" value="15" note="(12 one-sided, 3 controls)" />
              <StatRow label="detected" value="12/12" note="= 100%" emphasize accent="redteam" />
              <StatRow label="blocked" value="6/12" note="= 50%" />
              <StatRow label="precision" value="6/6" note="= 100%" emphasize accent="redteam" />
              <StatRow label="false pos." value="0/3" note="controls, 0 blocked" />
            </TerminalPanel>
          </div>

          {/* Card 3 — kept as the template's plain text card. */}
          <div className="rounded-2xl p-7 min-h-80 flex flex-col justify-between" style={{ backgroundColor: "#2B2644" }}>
            <p className="text-white text-2xl font-medium leading-snug" style={{ letterSpacing: "-0.02em" }}>
              Always on,
              <br />
              no prompting.
            </p>
            <p className="text-white/60 text-base">
              brake, redteam, and thrift run automatically on every tool call
              — the model calls them itself. No slash command, no asking.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
