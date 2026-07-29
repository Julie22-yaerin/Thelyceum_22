import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
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
import TaskOnboarding from "./pages/TaskOnboarding";
import SessionPage from "./pages/SessionPage";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import RefundPolicy from "./pages/RefundPolicy";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/onboarding"} component={TaskOnboarding} />
      <Route path={"/session"} component={SessionPage} />
      <Route path={"/canvas"} component={WorkforceCanvasPage} />
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

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <ChangelogBanner />
          <Toaster />
          <Router />
          <FloatingSocial />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
