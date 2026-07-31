import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Light/dark toggle for the workspace. Renders nothing unless the app was
 * mounted with a switchable ThemeProvider (see App.tsx). Scoped to workspace
 * routes via DarkModeScope, so on the landing page the toggle is hidden.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, switchable } = useTheme();

  if (!switchable || !toggleTheme) return null;
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 w-7 p-0 text-muted-foreground hover:text-ws-text hover:bg-ws-hover",
        className
      )}
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </Button>
  );
}
