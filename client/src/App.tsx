import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ChangelogBanner from "./components/ChangelogBanner";
import FloatingSocial from "./components/FloatingSocial";
import { ThemeProvider } from "./contexts/ThemeContext";
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
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

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

function App() {
  const [location] = useLocation();
  const fullBleed = FULL_BLEED_ROUTES.some(
    (r) => location === r || location.startsWith(`${r}/`)
  );

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
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
