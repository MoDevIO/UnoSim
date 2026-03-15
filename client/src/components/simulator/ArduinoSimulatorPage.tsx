import { useArduinoSimulatorPage } from "@/hooks/useArduinoSimulatorPage";
import { ArduinoSimulatorPageLayout } from "@/components/simulator/ArduinoSimulatorPageLayout";

export default function ArduinoSimulatorPage() {
  const state = useArduinoSimulatorPage();
  return <ArduinoSimulatorPageLayout {...state} />;
}
