import { useEffect } from "react";
import { useLocation } from "wouter";
import { Check, Loader2 } from "lucide-react";

/*
 * The Lyceum — Thank You page
 * Shown after a successful Lemon Squeezy checkout (via checkout[redirect_url]).
 * No waiting room — straight to the live beta workspace.
 */

export default function ThankYou() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => navigate("/onboarding"), 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-teal/10 flex items-center justify-center">
          <Check className="w-7 h-7 text-teal" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground mb-2">
          Thank you for your trust.
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Your pre-order is confirmed. Taking you to the live beta workspace...
        </p>

        <div className="flex items-center justify-center gap-2 mb-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Redirecting to workspace...</span>
        </div>

        <button
          onClick={() => navigate("/onboarding")}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
        >
          Enter workspace now
        </button>
      </div>
    </div>
  );
}
