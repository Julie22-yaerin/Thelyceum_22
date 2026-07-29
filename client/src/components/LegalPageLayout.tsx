import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export const LEGAL_EFFECTIVE_DATE = "July 29, 2026";
export const SUPPORT_EMAIL = "supportcenter@thelyceum.site";

export function LegalPageLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-warm-white">
      <div className="border-b border-border">
        <div className="container py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to The Lyceum
          </Link>
        </div>
      </div>

      <div className="container max-w-2xl py-12 sm:py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Effective {LEGAL_EFFECTIVE_DATE} · Questions?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal hover:text-teal-dark underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
        </p>

        <div className="prose-legal space-y-8">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-foreground mb-3">{heading}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}
