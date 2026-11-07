import { Button } from "@/components/ui/button";
import type { TutorPanelState } from "@/hooks/use-tutor";

/** API key, model and start difficulty; loaded when the learner opens it, the page's start does not need it. */
export function TutorKeyView({ tutor, onApply }: { readonly tutor: TutorPanelState; readonly onApply: () => void }) {
  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-auto p-4 text-left" data-testid="tutor-api-key-view">
      {!tutor.capabilities.canUseTutor && (
        <output className="mb-3 text-ui-xs text-muted-foreground" aria-live="polite">
          Server connection required
        </output>
      )}
      <div className="mx-auto w-full max-w-xl rounded-md border p-4">
        <div>
          <label htmlFor="tutor-api-key" className="text-ui-xs font-medium text-foreground">API key</label>
          <div className="mt-1 flex gap-2">
            <input
              id="tutor-api-key"
              type="password"
              value={tutor.credential}
              onChange={(event) => tutor.setCredential(event.target.value)}
              disabled={!tutor.capabilities.canConfigureTutor}
              title={tutor.capabilities.canConfigureTutor ? undefined : "Server connection required"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="mt-4">
            <label htmlFor="tutor-model" className="text-ui-xs font-medium text-foreground">Model</label>
            <select
              id="tutor-model"
              value={tutor.selectedModel}
              onChange={(event) => tutor.setSelectedModel(event.target.value)}
              disabled={tutor.modelsLoading || !tutor.capabilities.canUseTutor}
              title={tutor.capabilities.canUseTutor ? undefined : "Server connection required"}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground"
            >
              <option value="auto">Automatic</option>
              {tutor.availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
            {tutor.lastUsedModel && (
              <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="tutor-model-in-use">
                Last response from {tutor.lastUsedModel}
                {tutor.selectedModel === "auto" ? " (chosen by Automatic)" : ""}
              </p>
            )}
            <label htmlFor="tutor-difficulty" className="mt-4 block text-ui-xs font-medium text-foreground">Start difficulty (1–100)</label>
            <input
              id="tutor-difficulty"
              type="number"
              min={1}
              max={100}
              step={1}
              value={tutor.configuredDifficulty ?? 30}
              onChange={(event) => tutor.setConfiguredDifficulty(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground"
              title="Session start difficulty: 1 very easy, 100 very hard"
            />
        </div>

        <Button
          type="button"
          className="mt-5 w-full"
          onClick={onApply}
          data-testid="tutor-apply-key"
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
