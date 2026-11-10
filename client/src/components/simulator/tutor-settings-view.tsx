import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TutorPanelState } from "@/hooks/use-tutor";
import { getStatusTextClass } from "@/lib/status-semantics";
import { TutorTransparencyNote } from "./tutor-text";

const FIELD = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring";
const FIELD_LABEL = "text-ui-xs font-medium text-foreground";

/**
 * Access, model and difficulty (LearningQuestions 10.8, 10.9); loaded when the learner opens it, the page's
 * start does not need it. Opening and leaving it keep the question, the draft and the history.
 */
export function TutorSettingsView({ tutor, onApply, hasQuestion = false }: {
  readonly tutor: TutorPanelState;
  readonly onApply: () => void;
  /** Whether leaving returns to an open question; the back action then says so. */
  readonly hasQuestion?: boolean;
}) {
  const serverMissing = !tutor.capabilities.canUseTutor;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4 text-left pr-[calc(1rem+var(--ui-floating-nav-inset))]" data-testid="tutor-api-key-view">
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onApply} data-testid="tutor-settings-back">
          <ArrowLeft aria-hidden="true" />
          {hasQuestion ? "Zurück zur Frage" : "Zurück"}
        </Button>
      </div>
      <h2 className="mt-4 font-semibold text-foreground">Einstellungen</h2>
      {serverMissing && (
        <output className="mt-2 text-ui-sm text-muted-foreground" aria-live="polite">Serververbindung erforderlich</output>
      )}
      <TutorTransparencyNote provider={tutor.config.provider} className="mt-2" />

      <div className="mt-4 flex w-full max-w-xl flex-col gap-4">
        <div>
          <label htmlFor="tutor-api-key" className={FIELD_LABEL}>API-Key</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="tutor-api-key"
              type="password"
              value={tutor.credential}
              onChange={(event) => tutor.setCredential(event.target.value)}
              disabled={!tutor.capabilities.canConfigureTutor}
              title={tutor.capabilities.canConfigureTutor ? undefined : "Serververbindung erforderlich"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 basis-48 rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            />
            {tutor.credential.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={tutor.clearCredential} data-testid="tutor-clear-key">
                Key löschen
              </Button>
            )}
          </div>
          <p className="mt-1 text-ui-xs text-muted-foreground">Der Key bleibt nur in diesem Browser-Tab und wird nicht gespeichert.</p>
        </div>

        <div>
          <label htmlFor="tutor-model" className={FIELD_LABEL}>Modell</label>
          <select
            id="tutor-model"
            value={tutor.selectedModel}
            onChange={(event) => tutor.setSelectedModel(event.target.value)}
            disabled={tutor.modelsLoading || serverMissing}
            title={serverMissing ? "Serververbindung erforderlich" : undefined}
            className={FIELD}
          >
            <option value="auto">Automatisch</option>
            {tutor.availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
          {tutor.lastUsedModel && (
            <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="tutor-model-in-use">
              Letzte Antwort von {tutor.lastUsedModel}
              {tutor.selectedModel === "auto" ? " (von „Automatisch“ gewählt)" : ""}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="tutor-difficulty" className={FIELD_LABEL}>Startschwierigkeit (1–100)</label>
          <input
            id="tutor-difficulty"
            type="number"
            min={1}
            max={100}
            step={1}
            value={tutor.configuredDifficulty ?? 30}
            onChange={(event) => tutor.setConfiguredDifficulty(Number(event.target.value))}
            className={FIELD}
            title="Startschwierigkeit einer Lernrunde: 1 sehr leicht, 100 sehr schwer"
          />
          <p className="mt-1 text-ui-xs text-muted-foreground" data-testid="tutor-effective-difficulty">
            Aktuelle Schwierigkeit dieser Lernrunde: {tutor.effectiveDifficulty} von 100. Der Tutor passt sie nach bewerteten Antworten an.
          </p>
        </div>

        {tutor.error && <p className={`text-ui-sm ${getStatusTextClass("error")}`} role="alert">{tutor.error}</p>}

        <Button type="button" className="w-full sm:w-auto sm:self-start" onClick={onApply} data-testid="tutor-apply-key">
          Übernehmen
        </Button>
      </div>
    </div>
  );
}
