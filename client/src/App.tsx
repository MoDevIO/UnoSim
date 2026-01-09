import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ArduinoSimulator from "@/pages/arduino-simulator";
import NotFound from "@/pages/not-found";
import React from "react";
import SettingsDialog from "@/components/features/settings-dialog";

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

  React.useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");

    const onKey = (e: KeyboardEvent) => {
      // Open Settings dialog with Meta/Ctrl + , (comma)
      const isSettings = (isMac ? e.metaKey : e.ctrlKey) && e.code === "Comma";
      if (isSettings) {
        e.preventDefault();
        e.stopPropagation();
        setSettingsOpen((s) => !s);
      }
    };

    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
