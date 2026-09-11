import dns from "node:dns/promises";
import { isIP } from "node:net";
import type { FullCommitSha, RepositorySlug } from "@shared/examples";
import { config } from "../../config";
import { ExamplesError } from "./examples-error";
import { ExamplesLoadController, mapWithConcurrency } from "./examples-load-controller";
import {
  examplesManifestSchema,
  type ExampleRecord,
  validateManifestReferences,
} from "./examples-schema";
import { toGithubRawRepositoryBase } from "./source-selection";

export interface LoadedRevisionSnapshot {
  examples: ExampleRecord[];
  contentBytes: number;
}

export interface TextFetcher {
  fetchText(url: URL, maxBytes: number, signal?: AbortSignal): Promise<string>;
}

export class SecureExamplesFetcher implements TextFetcher {
  constructor(private readonly controller?: ExamplesLoadController) {}

  fetchText(url: URL, maxBytes: number, signal?: AbortSignal): Promise<string> {
    const operation = () => fetchText(url, maxBytes, signal);
    return this.controller ? this.controller.runOutbound(operation, signal) : operation();
  }
}

export class RevisionProvider {
  constructor(
    private readonly fetcher: TextFetcher,
    private readonly maxFileFetchConcurrency = config.examples.maxFileFetchConcurrency,
  ) {}

  async load(
    repository: RepositorySlug,
    revision: FullCommitSha,
    signal?: AbortSignal,
  ): Promise<LoadedRevisionSnapshot> {
    const base = new URL(`${revision}/`, toGithubRawRepositoryBase(repository));
    const manifestText = await this.fetcher.fetchText(
      new URL("manifest.json", base),
      config.examples.maxManifestBytes,
      signal,
    );
    let decoded: unknown;
    try { decoded = JSON.parse(manifestText) as unknown; }
    catch { throw new ExamplesError("INVALID_SNAPSHOT", "External examples manifest is invalid"); }
    const parsed = examplesManifestSchema.safeParse(decoded);
    if (!parsed.success) throw new ExamplesError("INVALID_SNAPSHOT", "External examples manifest is invalid");
    const manifest = parsed.data;
    try { validateManifestReferences(manifest); }
    catch { throw new ExamplesError("INVALID_SNAPSHOT", "External examples snapshot is invalid"); }

    const filesToLoad = manifest.examples.flatMap((example, exampleIndex) =>
      example.files.map((file) => ({ exampleIndex, file })),
    );
    if (filesToLoad.length > config.examples.maxFiles) {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples exceed the file count limit");
    }
    const loaded = await mapWithConcurrency(filesToLoad, this.maxFileFetchConcurrency, async ({ file }) => ({
      ...file,
      content: await this.fetcher.fetchText(
        new URL(file.path.split("/").map(encodeURIComponent).join("/"), base),
        config.examples.maxFileBytes,
        signal,
      ),
    }));
    const examples = manifest.examples.map((example, exampleIndex) => ({
      ...example,
      files: filesToLoad
        .map((item, index) => ({ item, file: loaded[index]! }))
        .filter(({ item }) => item.exampleIndex === exampleIndex)
        .map(({ file }) => file),
      source: "external" as const,
    }));
    const contentBytes = examples.reduce(
      (total, example) => total + example.files.reduce(
        (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
        0,
      ),
      0,
    );
    if (contentBytes > config.examples.maxTotalBytes) {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples exceed the total size limit");
    }
    return { examples, contentBytes };
  }
}

export function validateSourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid examples source URL");
  if (url.protocol !== "https:") throw new Error("External examples source must use HTTPS");
  if (isIP(url.hostname) !== 0) throw new Error("IP literal examples sources are not allowed");
  if (!config.examples.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("External examples source host is not allowlisted");
  }
  return url;
}

async function fetchText(url: URL, maxBytes: number, requestSignal?: AbortSignal): Promise<string> {
  const validated = validateSourceUrl(url.toString());
  await assertPublicHost(validated.hostname);
  const controller = new AbortController();
  const abort = () => controller.abort(requestSignal?.reason);
  requestSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.examples.timeoutMs);
  try {
    const response = await fetch(validated, { signal: controller.signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("Redirects are not allowed for examples");
    if (!response.ok) throw new Error(`Examples source returned ${response.status}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) throw new Error("Examples response exceeds size limit");
    if (!response.body) throw new Error("Examples response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Examples response exceeds size limit");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abort);
  }
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Examples source resolves to a private or reserved address");
  }
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice("::ffff:".length));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}
