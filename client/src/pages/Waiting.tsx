import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

/*
 * The Lyceum — No more waiting room.
 * This page immediately redirects to the live beta workspace.
 * Kept as a route so old /waiting?ref=... links still work.
 */

export default function Waiting() {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate("/onboarding");
  }, [navigate]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Taking you to the live beta workspace...</span>
      </div>
    </div>
  );
}
