import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import CompanySetupDialog from "./components/CompanySetupDialog";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import WorkforceCanvasPage from "./pages/WorkforceCanvasPage";
import ThankYou from "./pages/ThankYou";
import Waiting from "./pages/Waiting";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/canvas"} component={WorkforceCanvasPage} />
      <Route path={"/thank-you"} component={ThankYou} />
      <Route path={"/waiting"} component={Waiting} />
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
          <Toaster />
          <Router />
          {/* Company setup modal — shown when no company exists */}
          <CompanySetupDialog />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
