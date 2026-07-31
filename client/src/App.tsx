import { useLayoutEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ChangelogBanner from "./components/ChangelogBanner";
import FloatingSocial from "./components/FloatingSocial";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import WorkforceCanvasPage from "./pages/WorkforceCanvasPage";
import ThankYou from "./pages/ThankYou";
import Waiting from "./pages/Waiting";
import Admin from "./pages/Admin";
import Notes from "./pages/Notes";
import Dashboard from "./pages/Dashboard";
import MultiAgent from "./pages/MultiAgent";
import WarRoom from "./pages/WarRoom";
import Missions from "./pages/Missions";
import Governance from "./pages/Governance";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import RefundPolicy from "./pages/RefundPolicy";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/canvas"} component={WorkforceCanvasPage} />
      <Route path={"/app"} component={Dashboard} />
      <Route path={"/missions"} component={Missions} />
      <Route path={"/agents"} component={MultiAgent} />
      <Route path={"/war-room"} component={WarRoom} />
      <Route path={"/governance"} component={Governance} />
      <Route path={"/thank-you"} component={ThankYou} />
      <Route path={"/waiting"} component={Waiting} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/notes"} component={Notes} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/refund-policy"} component={RefundPolicy} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - The workspace is designed light-first, and its whole palette is driven by
//   CSS variables in index.css (ws-* tokens + Tailwind palette chips).
//   Toggling dark just flips those variables under `.dark`.
// - The toggle is scoped to workspace routes: the landing page stays light by
//   design, so the `dark` class is applied to <html> only while on a
//   workspace route (see <DarkModeScope /> below).

/**
 * Routes that own the whole viewport.
 *
 * The war room is `h-screen overflow-hidden` so its two panes scroll
 * independently and the page itself never does. Any chrome rendered above it —
 * the changelog banner, the floating social widget — pushes it down and makes
 * the whole document scroll, which defeats the layout and hides the top bar.
 * These surfaces opt out of global chrome rather than fighting it with z-index.
 */
const FULL_BLEED_ROUTES = ["/war-room"];

/** Routes that are part of the product workspace and honour the light/dark toggle. */
const WORKSPACE_ROUTES = [
  "/canvas",
  "/app",
  "/missions",
  "/agents",
  "/governance",
  "/notes",
  "/admin",
  "/war-room",
];

/**
 * Applies the `dark` class to <html> only on workspace routes. Landing and
 * marketing pages always stay light — the workspace palette is what the
 * toggle is for. Kept in sync with theme changes and route changes.
 */
function DarkModeScope() {
  const [location] = useLocation();
  const { theme } = useTheme();

  // useLayoutEffect: apply the class before paint so a dark workspace never
  // flashes light on load or on client-side navigation into it.
  useLayoutEffect(() => {
    const isWorkspace = WORKSPACE_ROUTES.some(
      (r) => location === r || location.startsWith(`${r}/`)
    );
    const root = document.documentElement;
    if (isWorkspace && theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [location, theme]);

  return null;
}

function App() {
  const [location] = useLocation();
  const fullBleed = FULL_BLEED_ROUTES.some(
    (r) => location === r || location.startsWith(`${r}/`)
  );

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable applyToRoot={false}>
        <DarkModeScope />
        <TooltipProvider>
          {!fullBleed && <ChangelogBanner />}
          <Toaster />
          <Router />
          {!fullBleed && <FloatingSocial />}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
