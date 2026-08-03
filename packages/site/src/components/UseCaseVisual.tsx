const HOOK_LINES = [
  "PreToolUse  tool=Write  file=src/billing.ts",
  "redteam   claim=\"safe under concurrent writes\"  evidence=none",
  "redteam   verdict=CHALLENGE",
  "brake     action=Write  risk=destructive_diff",
  "brake     verdict=BLOCK  exit=1",
  "hook      chặn Write/Edit — call never reaches disk",
  "PreToolUse  tool=Edit  file=infra/deploy.yml",
  "brake     action=Edit  risk=none  verdict=PASS",
];

export default function UseCaseVisual() {
  const lines = [...HOOK_LINES, ...HOOK_LINES];
  return (
    <div className="absolute inset-0 w-full h-full bg-[#101110] overflow-hidden">
      <div className="term-scroll-track flex flex-col">
        {lines.map((line, i) => {
          const isBlock = line.includes("BLOCK") || line.includes("chặn");
          const isPass = line.includes("PASS");
          return (
            <div
              key={i}
              className="px-10 py-3 border-b border-white/5 font-mono text-[12.5px] whitespace-nowrap"
            >
              <span
                className={
                  isBlock
                    ? "text-[#e2665a] font-semibold"
                    : isPass
                      ? "text-[#6fbf8b] font-semibold"
                      : "text-white/45"
                }
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 bg-[rgba(245,245,245,0.9)]" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[rgba(245,245,245,0.15)] via-transparent to-[rgba(245,245,245,0.5)]" />
    </div>
  );
}
