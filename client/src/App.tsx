import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import ArduinoSimulator from "@/pages/arduino-simulator";
import NotFound from "@/pages/not-found";
import React from "react";
import SettingsDialog from "@/components/features/settings-dialog";
import { isMac } from "@/lib/platform";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ArduinoSimulator} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const disableToasts =
    import.meta.env.VITE_DISABLE_TOASTS === "true" ||
    (typeof globalThis !== "undefined" &&
      (globalThis as any).__DISABLE_TOASTS === true);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Open Settings dialog with Meta/Ctrl + , (comma)
      const isSettings = (isMac ? e.metaKey : e.ctrlKey) && e.code === "Comma";
      if (isSettings) {
        e.preventDefault();
        e.stopPropagation();
        setSettingsOpen((s) => !s);
      }
    };

    // Also listen to a custom event so other parts of the app can request opening settings
    const onOpenSettings = () => setSettingsOpen(true);

    document.addEventListener("keydown", onKey, { capture: true });
    globalThis.addEventListener("open-settings", onOpenSettings as EventListener);
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
      globalThis.removeEventListener(
        "open-settings",
        onOpenSettings as EventListener,
      );
    };
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {!disableToasts && <Toaster />}
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
