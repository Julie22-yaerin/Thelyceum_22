import { ArrowRight } from "lucide-react";
import UseCaseVisual from "./UseCaseVisual";

export default function UseCasesSection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24">
      <div className="max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div className="md:pr-12 md:pt-2">
          <p className="text-black/60 text-sm mb-2">The Lyceum in Practice</p>
          <h2
            className="text-5xl md:text-6xl font-medium leading-none mb-6"
            style={{ letterSpacing: "-0.04em" }}
          >
            Where it runs
          </h2>
          <p className="text-black/60 text-base leading-relaxed max-w-sm">
            The Lyceum runs wherever your agents do — pre-commit hooks, CI
            pipelines, and long-running fleets that need a mechanical stop,
            not a suggestion.
          </p>
        </div>

        <div className="relative rounded-3xl overflow-hidden min-h-[720px]">
          <UseCaseVisual />
          <div className="relative z-10 p-10 md:p-12">
            <h3
              className="text-4xl md:text-5xl font-medium leading-tight mb-5"
              style={{ letterSpacing: "-0.03em" }}
            >
              Hooks
            </h3>
            <p className="text-black/70 text-base max-w-md mb-8">
              Wire brake and redteam into a Claude Code hook and a risky
              Write or Edit call exits 1 before it lands. In our own 15-claim
              test set, 6 of 12 flagged calls were blocked outright — zero
              false blocks on the 3 control claims.
            </p>
            <a href="#" className="group inline-flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-white/80 backdrop-blur flex items-center justify-center group-hover:bg-white transition-colors">
                <ArrowRight className="w-4 h-4 text-black" />
              </span>
              <span className="text-black font-medium">See the hook config</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
