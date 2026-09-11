import { useSyncExternalStore } from "react";

export const EXTERNAL_EXAMPLES_STORAGE_KEY = "unoExternalExamplesSelection";
export const EXTERNAL_EXAMPLES_CHANGE_EVENT = "externalExamplesSelectionChange";

export interface ExternalExamplesSelection {
  schemaVersion: 1;
  repository: string;
  ref: string;
}

export interface ExternalExamplesSource {
  selection: "default" | "browser-override";
  mode: "builtin" | "repository-ref";
  repository: string | null;
  ref: string | null;
  revision: string | null;
  status: "builtin" | "remote" | "cache";
  stale: boolean;
}

export interface ExternalExampleCatalogItem {
  id: string;
  title: string;
  category: string;
  description?: string;
  main: string;
  source: "builtin" | "external";
  files: Array<{ name: string; path: string }>;
}

export interface ExternalExamplesCatalog {
  schemaVersion: 1;
  source: ExternalExamplesSource;
  examples: ExternalExampleCatalogItem[];
}

export interface ExternalExamplesValidationResponse {
  schemaVersion: 1;
  valid: true;
  source: ExternalExamplesSource & {
    mode: "repository-ref";
    repository: string;
    ref: string;
    revision: string;
  };
}

export type ExternalExamplesErrorCode =
  | "INVALID_SELECTION"
  | "INVALID_REF"
  | "INVALID_REVISION"
  | "INVALID_SNAPSHOT"
  | "SOURCE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "LOAD_CAPACITY_EXCEEDED";

export class ExternalExamplesError extends Error {
  constructor(
    readonly code: ExternalExamplesErrorCode | "NETWORK" | "UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "ExternalExamplesError";
  }
}

interface ExternalExamplesState {
  override: ExternalExamplesSelection | null;
  catalog: ExternalExamplesCatalog | null;
}

const listeners = new Set<() => void>();
let state: ExternalExamplesState = {
  override: readStoredSelection(),
  catalog: null,
};
let requestGeneration = 0;
let activeController: AbortController | undefined;

export function useExternalExamples() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function getExternalExamplesState(): ExternalExamplesState {
  return state;
}

export function readStoredSelection(): ExternalExamplesSelection | null {
  try {
    const raw = globalThis.localStorage.getItem(EXTERNAL_EXAMPLES_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeRepositoryInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("://"))
    return canonicalRepository(trimmed.replace(/\.git\/?$/i, ""));
  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    return canonicalRepository(
      `${segments[0]}/${segments[1]!.replace(/\.git$/i, "")}`,
    );
  } catch {
    return null;
  }
}

export function normalizeSelection(
  repository: string,
  ref: string,
): ExternalExamplesSelection {
  const normalizedRepository = normalizeRepositoryInput(repository);
  if (!normalizedRepository)
    throw new ExternalExamplesError(
      "INVALID_SELECTION",
      "Enter a valid public GitHub repository.",
    );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref)) {
    throw new ExternalExamplesError(
      "INVALID_REF",
      "Enter a valid ref (1–128 safe characters, without '/').",
    );
  }
  return { schemaVersion: 1, repository: normalizedRepository, ref };
}

export async function validateExternalExamplesSelection(
  selection: ExternalExamplesSelection,
  signal?: AbortSignal,
): Promise<ExternalExamplesValidationResponse["source"]> {
  const response = await fetch("/api/examples/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      selection: { repository: selection.repository, ref: selection.ref },
    }),
    signal,
  });
  if (!response.ok) throw await parseApiError(response);
  const payload = await parseJson(response);
  if (!payload || payload.valid !== true || !isExternalSource(payload.source)) {
    throw new ExternalExamplesError(
      "UNKNOWN",
      "The server returned an invalid validation response.",
    );
  }
  return payload.source;
}

export async function refreshExternalExamplesCatalog(
  signal?: AbortSignal,
): Promise<ExternalExamplesCatalog> {
  const generation = ++requestGeneration;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else
      signal.addEventListener("abort", () => controller.abort(signal.reason), {
        once: true,
      });
  }
  const selection = state.override;
  const query = selection
    ? `?repository=${encodeURIComponent(selection.repository)}&ref=${encodeURIComponent(selection.ref)}`
    : "";
  try {
    const response = await fetch(`/api/examples${query}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw await parseApiError(response);
    const payload = await parseJson(response);
    if (!isCatalog(payload))
      throw new ExternalExamplesError(
        "UNKNOWN",
        "The server returned an invalid examples catalog.",
      );
    if (generation === requestGeneration) {
      state = { ...state, catalog: payload };
      emit();
    }
    return payload;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw toExternalExamplesError(error);
  } finally {
    if (activeController === controller) activeController = undefined;
  }
}

export function setExternalExamplesOverride(
  selection: ExternalExamplesSelection | null,
): void {
  if (selection) {
    try {
      globalThis.localStorage.setItem(
        EXTERNAL_EXAMPLES_STORAGE_KEY,
        JSON.stringify(selection),
      );
    } catch {}
  } else {
    try {
      globalThis.localStorage.removeItem(EXTERNAL_EXAMPLES_STORAGE_KEY);
    } catch {}
  }
  state = { ...state, override: selection };
  requestGeneration++;
  activeController?.abort();
  emit();
  try {
    globalThis.dispatchEvent(new CustomEvent(EXTERNAL_EXAMPLES_CHANGE_EVENT));
  } catch {}
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): ExternalExamplesState {
  return state;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function canonicalRepository(value: string): string | null {
  const candidate = value.toLowerCase();
  const [owner, repository] = candidate.split("/");
  if (
    !owner ||
    !repository ||
    owner.length > 39 ||
    repository.length > 100 ||
    candidate.length > 140
  )
    return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(owner) || owner.includes("--"))
    return null;
  if (
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(repository) ||
    repository === "." ||
    repository === ".."
  )
    return null;
  return `${owner}/${repository}`;
}

function isSelection(value: unknown): value is ExternalExamplesSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    candidate.schemaVersion === 1 &&
    typeof candidate.repository === "string" &&
    typeof candidate.ref === "string" &&
    normalizeRepositoryInput(candidate.repository) === candidate.repository &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate.ref)
  );
}

function isExternalSource(
  value: unknown,
): value is ExternalExamplesValidationResponse["source"] {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).mode === "repository-ref" &&
    typeof (value as Record<string, unknown>).repository === "string" &&
    typeof (value as Record<string, unknown>).ref === "string" &&
    typeof (value as Record<string, unknown>).revision === "string",
  );
}

function isCatalog(value: unknown): value is ExternalExamplesCatalog {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    isSource(candidate.source) &&
    Array.isArray(candidate.examples)
  );
}

function isSource(value: unknown): value is ExternalExamplesSource {
  return Boolean(
    value &&
    typeof value === "object" &&
    ["default", "browser-override"].includes(
      String((value as Record<string, unknown>).selection),
    ) &&
    ["builtin", "repository-ref"].includes(
      String((value as Record<string, unknown>).mode),
    ) &&
    typeof (value as Record<string, unknown>).stale === "boolean",
  );
}

async function parseJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new ExternalExamplesError(
      "UNKNOWN",
      "The server returned invalid JSON.",
    );
  }
}

async function parseApiError(
  response: Response,
): Promise<ExternalExamplesError> {
  const payload = (await parseJson(response).catch(() => undefined)) as
    | { error?: { code?: string } }
    | undefined;
  const code = payload?.error?.code;
  if (
    code === "INVALID_SELECTION" ||
    code === "INVALID_REF" ||
    code === "INVALID_REVISION" ||
    code === "INVALID_SNAPSHOT" ||
    code === "SOURCE_UNAVAILABLE" ||
    code === "RATE_LIMITED" ||
    code === "LOAD_CAPACITY_EXCEEDED"
  ) {
    return new ExternalExamplesError(code, userMessageFor(code));
  }
  return new ExternalExamplesError(
    response.status >= 500 ? "NETWORK" : "UNKNOWN",
    userMessageFor(code),
  );
}

function toExternalExamplesError(error: unknown): ExternalExamplesError {
  if (error instanceof ExternalExamplesError) return error;
  return new ExternalExamplesError(
    "NETWORK",
    "The examples service is currently unavailable.",
  );
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}

function userMessageFor(code: string | undefined): string {
  switch (code) {
    case "INVALID_SELECTION":
      return "The repository selection is invalid.";
    case "INVALID_REF":
      return "The ref is invalid.";
    case "SOURCE_UNAVAILABLE":
      return "The selected public repository is currently unavailable.";
    case "RATE_LIMITED":
      return "Too many requests. Please try again shortly.";
    case "LOAD_CAPACITY_EXCEEDED":
      return "The examples service is busy. Please try again shortly.";
    case "INVALID_SNAPSHOT":
      return "The selected examples snapshot is invalid.";
    default:
      return "Could not load the examples right now.";
  }
}
