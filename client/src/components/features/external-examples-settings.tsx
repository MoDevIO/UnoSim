import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ExternalExamplesError,
  normalizeSelection,
  refreshExternalExamplesCatalog,
  setExternalExamplesOverride,
  useExternalExamples,
  validateExternalExamplesSelection,
} from "@/lib/external-examples";

export function ExternalExamplesSettings({
  open = true,
}: {
  readonly open?: boolean;
}) {
  const { override, catalog } = useExternalExamples();
  const [repository, setRepository] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [message, setMessage] = React.useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [validatedRevision, setValidatedRevision] = React.useState<
    string | null
  >(null);
  const [busy, setBusy] = React.useState<"validate" | "apply" | "reset" | null>(
    null,
  );
  const operation = React.useRef(0);
  const controller = React.useRef<AbortController | undefined>();

  React.useEffect(() => {
    if (open && !catalog && !override)
      void refreshExternalExamplesCatalog().catch(() => undefined);
  }, [catalog, open, override]);

  React.useEffect(() => {
    if (!catalog && !override) return;
    if (override) {
      setRepository(override.repository);
      setRef(override.ref);
    } else if (catalog?.source.selection === "default") {
      setRepository(catalog.source.repository ?? "");
      setRef(catalog.source.ref ?? "");
    }
  }, [catalog, override]);

  React.useEffect(() => () => controller.current?.abort(), []);

  const source = catalog?.source;
  const selectionStatus = override ? "Browser override" : "Default";

  const validateDraft = async (): Promise<ReturnType<
    typeof normalizeSelection
  > | null> => {
    const currentOperation = ++operation.current;
    try {
      const selection = normalizeSelection(repository, ref);
      controller.current?.abort();
      const nextController = new AbortController();
      controller.current = nextController;
      setBusy("validate");
      setMessage(null);
      const validated = await validateExternalExamplesSelection(
        selection,
        nextController.signal,
      );
      if (currentOperation === operation.current) {
        setValidatedRevision(validated.revision);
        setMessage({
          kind: "success",
          text: "Repository and ref are valid and the snapshot is ready.",
        });
      }
      return currentOperation === operation.current ? selection : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return null;
      if (currentOperation === operation.current) {
        setMessage({
          kind: "error",
          text:
            error instanceof ExternalExamplesError
              ? error.message
              : "Could not validate the selection.",
        });
      }
      return null;
    } finally {
      if (currentOperation === operation.current) setBusy(null);
    }
  };

  const apply = async () => {
    const selection = await validateDraft();
    if (!selection) return;
    const currentOperation = ++operation.current;
    setBusy("apply");
    try {
      setExternalExamplesOverride(selection);
      await refreshExternalExamplesCatalog();
      if (currentOperation === operation.current)
        setMessage({
          kind: "success",
          text: "External Examples override applied.",
        });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage({
          kind: "error",
          text:
            error instanceof ExternalExamplesError
              ? error.message
              : "Could not reload examples.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    ++operation.current;
    controller.current?.abort();
    setBusy("reset");
    setMessage(null);
    setExternalExamplesOverride(null);
    try {
      await refreshExternalExamplesCatalog();
      setMessage({ kind: "success", text: "Using the server default again." });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage({
          kind: "error",
          text:
            error instanceof ExternalExamplesError
              ? error.message
              : "Could not reload the default examples.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="rounded border p-3 bg-muted"
      aria-label="External Examples settings"
    >
      <div className="font-medium">External Examples</div>
      <div className="text-ui-xs text-muted-foreground mb-3">
        Select a public GitHub repository and ref for this browser only. No
        credentials are needed.
      </div>
      <div className="grid gap-2">
        <label className="text-ui-sm" htmlFor="external-examples-repository">
          Repository
        </label>
        <Input
          id="external-examples-repository"
          value={repository}
          onChange={(event) => {
            setRepository(event.target.value);
            setValidatedRevision(null);
          }}
          placeholder="owner/repository or GitHub URL"
          disabled={busy !== null}
        />
        <label className="text-ui-sm" htmlFor="external-examples-ref">
          Ref
        </label>
        <Input
          id="external-examples-ref"
          value={ref}
          onChange={(event) => {
            setRef(event.target.value);
            setValidatedRevision(null);
          }}
          placeholder="main"
          disabled={busy !== null}
        />
      </div>
      <div className="mt-3 text-ui-xs text-muted-foreground space-y-1">
        <div>
          Using:{" "}
          <span className="font-medium text-foreground">{selectionStatus}</span>
        </div>
        {(source?.revision ?? validatedRevision) && (
          <div>
            Active revision:{" "}
            <code className="break-all">
              {source?.revision ?? validatedRevision}
            </code>
          </div>
        )}
        {source?.stale && (
          <div className="text-status-warning">
            The last known good snapshot is currently active (stale).
          </div>
        )}
      </div>
      {message && (
        <output
          aria-live="polite"
          className={`mt-3 text-ui-sm ${message.kind === "error" ? "text-destructive" : "text-status-success"}`}
        >
          {message.text}
        </output>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void validateDraft()}
          disabled={busy !== null}
        >
          Validate
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void apply()}
          disabled={busy !== null || !repository || !ref}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void reset()}
          disabled={busy !== null || !override}
        >
          Reset to default
        </Button>
      </div>
    </section>
  );
}
