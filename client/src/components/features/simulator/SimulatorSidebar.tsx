import { PinMonitor } from "@/components/features/pin-monitor";
import { ArduinoBoard } from "@/components/features/arduino-board";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CompilationOutput } from "@/components/features/compilation-output";
import { ParserOutput } from "@/components/features/parser-output";
import { ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { X } from "lucide-react";
import { useSimulationStore } from "@/hooks/use-simulation-store";
import { useSimulationUi } from "@/hooks/use-simulation-ui";



export type OutputApi = {
  cliOutput: string;
  handleClearCompilationOutput: () => void;
  isSuccessState: boolean;
  isModified: boolean;
  parserMessages: any[];
  ioRegistry: any[];
  parserMessagesContainerRef: React.RefObject<HTMLDivElement>;
  activeOutputTab: "compiler" | "messages" | "registry" | "debug";
  setActiveOutputTab: (v: any) => void;
  showCompilationOutput: boolean;
  setShowCompilationOutput: (v: boolean) => void;
  setParserPanelDismissed: (v: boolean) => void;
  outputPanelRef: any;
  outputTabsHeaderRef: React.RefObject<HTMLDivElement>;
  outputPanelMinPercent: number;
  compilationPanelSize: number;
  setCompilationPanelSize: (n: number) => void;
  outputPanelManuallyResizedRef: React.MutableRefObject<boolean>;
  openOutputPanel: (tab: any) => void;
  toast: (args: any) => void;
  setParserPanelDismissedLocal?: (v: boolean) => void;
};

export default function SimulatorSidebar({
  pinMonitorVisible = true,
  onReset,
  onPinToggle,
  analogPins = [],
  onAnalogChange,
  isMobile = false,
  // optional props — prefer page-provided values but fall back to context
  simulationStatus: propSimulationStatus,
  txActivity: propTxActivity,
  rxActivity: propRxActivity,
}: Partial<{
  pinMonitorVisible: boolean;
  onReset: () => void;
  onPinToggle: (pin: number, newValue: number) => void;
  analogPins: number[];
  onAnalogChange: (pin: number, newValue: number) => void;
  isMobile?: boolean;
  simulationStatus?: string;
  txActivity?: number;
  rxActivity?: number;
}>) {
  const { pinStates, batchStats } = useSimulationStore();
  const ui = useSimulationUi();
  const simulationStatus = (propSimulationStatus as any) ?? ui.simulationStatus;
  const txActivity = (propTxActivity as any) ?? ui.txActivity;
  const rxActivity = (propRxActivity as any) ?? ui.rxActivity;
  const isRunning = simulationStatus === "running";

  return (
    <div className={isMobile ? "h-full w-full" : "h-full w-full flex flex-col gap-3 p-2"}>
      {pinMonitorVisible && (
        <div>
          <PinMonitor pinStates={pinStates} batchStats={batchStats} />
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ArduinoBoard
          pinStates={pinStates}
          isSimulationRunning={isRunning}
          simulationStatus={simulationStatus}
          txActive={txActivity}
          rxActive={rxActivity}
          onReset={onReset}
          onPinToggle={onPinToggle as any}
          analogPins={analogPins}
          onAnalogChange={onAnalogChange as any}
        />
      </div>
    </div>
  );
}

export function SimulatorOutput({ outputApi }: { outputApi: OutputApi }) {
  const {
    cliOutput,
    handleClearCompilationOutput,
    isSuccessState,
    isModified,
    parserMessages,
    ioRegistry,
    parserMessagesContainerRef,
    activeOutputTab,
    setActiveOutputTab,
    setParserPanelDismissed,
    outputPanelRef,
    outputTabsHeaderRef,
    outputPanelMinPercent,
    compilationPanelSize,
    setCompilationPanelSize,
    outputPanelManuallyResizedRef,
    openOutputPanel,
    setShowCompilationOutput,
  } = outputApi;

  return (
    <>
      <ResizableHandle
        withHandle
        data-testid="vertical-resizer-output"
      />
      <ResizablePanel
        ref={outputPanelRef}
        defaultSize={Math.max(compilationPanelSize, outputPanelMinPercent)}
        minSize={outputPanelMinPercent}
        id="output-under-editor"
      >
        <Tabs
          value={activeOutputTab}
          onValueChange={(v) => setActiveOutputTab(v as any)}
          className="h-full flex flex-col"
        >
          <div
            ref={outputTabsHeaderRef}
            data-testid="output-tabs-header"
            className="flex items-center justify-start px-2 h-[var(--ui-header-height)] bg-muted border-b"
          >
            <TabsList className="h-auto flex gap-1 bg-transparent items-center">
              <TabsTrigger
                value="compiler"
                onDoubleClick={() => openOutputPanel("compiler")}
                className={"h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center"}
              >
                <span>Compiler</span>
              </TabsTrigger>
              <TabsTrigger
                value="messages"
                onDoubleClick={() => openOutputPanel("messages")}
                className={"h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center"}
              >
                <span>Messages</span>
              </TabsTrigger>
              <TabsTrigger
                value="registry"
                onDoubleClick={() => openOutputPanel("registry")}
                className={"h-[var(--ui-button-height)] px-2 text-ui-xs data-[state=active]:bg-background rounded-sm py-0 leading-none flex items-center"}
              >
                <span>I/O Registry</span>
              </TabsTrigger>

            </TabsList>
            <div className="flex-1" />
            <div className="flex items-center px-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const currentSize = outputPanelRef.current?.getSize?.() ?? 0;
                  const isMinimized = currentSize <= outputPanelMinPercent + 1;
                  if (isMinimized) {
                    setShowCompilationOutput(false);
                    setParserPanelDismissed(true);
                    outputPanelManuallyResizedRef.current = false;
                  } else {
                    setCompilationPanelSize(3);
                    outputPanelManuallyResizedRef.current = false;
                    if (outputPanelRef.current?.resize) {
                      outputPanelRef.current.resize(outputPanelMinPercent);
                    }
                  }
                }}
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <TabsContent value="compiler" className="flex-1 overflow-hidden m-0">
            <CompilationOutput output={cliOutput} onClear={handleClearCompilationOutput} isSuccess={isSuccessState} showSuccessMessage={isSuccessState && !isModified} hideHeader={true} />
          </TabsContent>

          <TabsContent value="messages" className="flex-1 overflow-hidden m-0">
            <ParserOutput messages={parserMessages} ioRegistry={ioRegistry} messagesContainerRef={parserMessagesContainerRef} onClear={() => setParserPanelDismissed(true)} hideHeader={true} />
          </TabsContent>

          <TabsContent value="registry" className="flex-1 overflow-hidden m-0">
            <ParserOutput messages={[]} ioRegistry={ioRegistry} onClear={() => {}} hideHeader={true} defaultTab="registry" />
          </TabsContent>


        </Tabs>
      </ResizablePanel>
    </>
  );
}

