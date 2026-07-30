/**
 * SessionPage — The Lyceum
 *
 * Wraps TaskSessionWorkspace in a full-page layout with navigation.
 * Accessible at /session after task onboarding confirmation.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/store/useSessionStore";
import TaskSessionWorkspace from "@/components/TaskSessionWorkspace";

export default function SessionPage() {
  const [location, setLocation] = useLocation();
  const currentSession = useSessionStore((s) => s.currentSession);
  const loadSession = useSessionStore((s) => s.loadSession);
  const loadServerSessions = useSessionStore((s) => s.loadServerSessions);
  const licenseKey = useSessionStore((s) => s.licenseKey);
  const hasSession = currentSession && currentSession.confirmed;
  const allSessions = useSessionStore((s) => s.sessions);

  // Ref to guard against loading the same session twice via the URL effect
  const loadedSessionIdRef = useRef<string | null>(null);

  // Load server sessions on mount if license key is available
  useEffect(() => {
    if (licenseKey) {
      loadServerSessions();
    }
  }, [licenseKey, loadServerSessions]);

  // If URL has ?session=xxx, load that session (but only once per session id)
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] || "");
    const sessionId = params.get("session");
    if (sessionId && sessionId !== loadedSessionIdRef.current) {
      loadedSessionIdRef.current = sessionId;
      loadSession(sessionId);
    }
  }, [location, loadSession]);

  // No active session — show session list with link to onboarding
  if (!hasSession) {
    return (
      <div className="min-h-screen bg-ws-subtle flex flex-col items-center justify-center p-6">
        <Sparkles className="w-8 h-8 text-teal-700 mb-3" />
        <p className="text-sm text-ws-text-soft font-medium mb-1">No active session</p>
        <p className="text-[10px] text-muted-foreground mb-6">
          {allSessions.length > 0
            ? "Click a session below to resume, or start a new one"
            : "Create a task session to get started"}
        </p>

        {/* Session history */}
        {allSessions.length > 0 && (
          <div className="w-full max-w-sm space-y-2 mb-6">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-2">Saved Sessions</p>
            {[...allSessions].reverse().map((s) => {
              const done = s.tasks.filter((t) => t.status === "completed").length;
              const total = s.tasks.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    loadSession(s.id);
                    setLocation(`/session?session=${s.id}`);
                  }}
                  className="w-full text-left bg-ws-subtle hover:bg-ws-hover border border-ws-border hover:border-teal-200 rounded-lg px-3 py-2.5 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-ws-text font-medium flex-1 truncate">{s.name}</span>
                    <span className="text-[8px] text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-ws-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: pct === 100
                            ? "linear-gradient(90deg, #0d9488, #10b981)"
                            : "linear-gradient(90deg, #0d9488, #14b8a6)",
                        }}
                      />
                    </div>
                    <span className="text-[8px] text-muted-foreground whitespace-nowrap">
                      {done}/{total}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <Button
          className="h-7 text-[9px] px-3 bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
          onClick={() => setLocation("/onboarding")}
        >
          Start Onboarding
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-ws-subtle">
      {/* Minimal header */}
      <div className="h-10 border-b border-ws-border bg-ws-bg/80 backdrop-blur-xl flex items-center px-4 shrink-0">
        <button
          onClick={() => setLocation("/canvas")}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-ws-text transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Canvas
        </button>
        <div className="flex items-center gap-1.5 ml-auto">
          <Sparkles className="w-3 h-3 text-teal-700" />
          <span className="text-[10px] text-ws-text-soft font-medium">{currentSession.name}</span>
          <span className="text-[8px] text-muted-foreground ml-1">
            {currentSession.tasks.filter((t) => t.status === "completed").length}/{currentSession.tasks.length} tasks
          </span>
        </div>
      </div>

      {/* Session workspace */}
      <div className="flex-1 overflow-hidden">
        <TaskSessionWorkspace />
      </div>
    </div>
  );
}
