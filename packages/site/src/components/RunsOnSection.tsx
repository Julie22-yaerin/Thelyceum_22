import Marquee, { type MarqueeItem } from "./Marquee";

const INFRA: MarqueeItem[] = [
  { label: "GitHub Actions", style: { fontFamily: "'Times New Roman', serif", fontWeight: 400, letterSpacing: "0.02em", fontSize: 14 } },
  { label: "UBUNTU X64", style: { fontFamily: "'Arial Black', sans-serif", fontWeight: 900, letterSpacing: "0.08em", fontSize: 16 } },
  { label: "ARM64", style: { fontFamily: "Impact, sans-serif", fontWeight: 700, letterSpacing: "0.05em", fontSize: 18 } },
  { label: "Rust", style: { fontFamily: "Georgia, serif", fontWeight: 600, letterSpacing: "-0.02em", fontSize: 17 } },
  { label: "SQLite", style: { fontFamily: "Helvetica, sans-serif", fontWeight: 700, letterSpacing: "-0.01em", fontSize: 15 } },
  { label: "LEMON SQUEEZY", style: { fontFamily: "Verdana, sans-serif", fontWeight: 700, letterSpacing: "0.06em", fontSize: 14, textTransform: "uppercase" } },
  { label: "crates.io", style: { fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: "0.18em", fontSize: 14 } },
  { label: "PyO3", style: { fontFamily: "Palatino, serif", fontWeight: 500, letterSpacing: "0.03em", fontSize: 15 } },
];

export default function RunsOnSection() {
  return (
    <section className="bg-[#F5F5F5] px-6">
      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 items-center">
        <div className="text-black/70 text-base leading-relaxed">
          Verified on real infrastructure,
          <br />
          nightly and in public.
        </div>
        <div className="md:col-span-3 overflow-hidden">
          <Marquee
            items={INFRA}
            trackClassName="backers-track"
            itemClassName="mx-10 shrink-0 text-black/50 whitespace-nowrap"
          />
        </div>
      </div>
    </section>
  );
}
