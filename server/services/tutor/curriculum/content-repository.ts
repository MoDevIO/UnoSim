import dns from "node:dns/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { parse as parseYaml } from "yaml";
import { config } from "../../../config";
import {
  curriculumManifestSchema,
  curriculumTopicSchema,
  validateCurriculumManifest,
  validateCurriculumTopic,
  type CurriculumManifest,
  type CurriculumTopic,
} from "./curriculum-schema";

export interface DidacticContentSnapshot {
  readonly revision: string;
  readonly manifest: CurriculumManifest;
  readonly topics: readonly CurriculumTopic[];
  readonly stale: boolean;
}

export interface DidacticContentRepository {
  getSnapshot(): Promise<DidacticContentSnapshot | null>;
}

export interface CurriculumRepositoryOptions {
  readonly source?: string;
  readonly commit?: string;
  readonly refreshMs?: number;
  readonly timeoutMs?: number;
  readonly maxManifestBytes?: number;
  readonly maxTopicBytes?: number;
  readonly maxTotalBytes?: number;
  readonly allowedHosts?: readonly string[];
  readonly fetchText?: (url: URL, maxBytes: number) => Promise<string>;
  readonly lookup?: (hostname: string) => Promise<readonly { address: string }[]>;
}

const DEFAULT_OPTIONS: Required<Pick<
  CurriculumRepositoryOptions,
  "source" | "commit" | "refreshMs" | "timeoutMs" | "maxManifestBytes" | "maxTopicBytes" | "maxTotalBytes" | "allowedHosts"
>> = {
  source: config.tutor.curriculum.source,
  commit: config.tutor.curriculum.commit,
  refreshMs: config.tutor.curriculum.refreshMs,
  timeoutMs: config.tutor.curriculum.timeoutMs,
  maxManifestBytes: config.tutor.curriculum.maxManifestBytes,
  maxTopicBytes: config.tutor.curriculum.maxTopicBytes,
  maxTotalBytes: config.tutor.curriculum.maxTotalBytes,
  allowedHosts: config.tutor.curriculum.allowedHosts,
};

export class GitHubDidacticContentRepository implements DidacticContentRepository {
  private readonly options: typeof DEFAULT_OPTIONS & Pick<CurriculumRepositoryOptions, "fetchText" | "lookup">;
  private cached: DidacticContentSnapshot | null = null;
  private expiresAt = 0;
  private loading: Promise<DidacticContentSnapshot> | null = null;

  constructor(options: CurriculumRepositoryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async getSnapshot(): Promise<DidacticContentSnapshot | null> {
    if (!this.options.source || !this.options.commit) return null;
    if (this.cached && !this.cached.stale && this.cached.revision === this.options.commit && this.expiresAt > Date.now()) return this.cached;

    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    try {
      const snapshot = await this.loading;
      this.cached = snapshot;
      this.expiresAt = Date.now() + this.options.refreshMs;
      return snapshot;
    } catch {
      if (this.cached?.revision === this.options.commit) {
        this.cached = { ...this.cached, stale: true };
        return this.cached;
      }
      return null;
    }
  }

  private async load(): Promise<DidacticContentSnapshot> {
    const source = validateSource(this.options.source, this.options.allowedHosts);
    const commit = validateCommit(this.options.commit);
    const base = new URL(`${commit}/`, source);
    const curriculumBase = new URL("curriculum/", base);
    const fetchText = this.options.fetchText ?? ((url, maxBytes) => fetchBoundedText(url, maxBytes, this.options.timeoutMs, this.options.lookup));
    const manifestText = await fetchText(new URL("manifest.yaml", curriculumBase), this.options.maxManifestBytes);
    const manifest = parseManifest(manifestText);
    const topics: CurriculumTopic[] = [];
    let totalBytes = Buffer.byteLength(manifestText, "utf8");

    for (const entry of manifest.topics) {
      const topicUrl = new URL(entry.path.split("/").map(encodeURIComponent).join("/"), curriculumBase);
      if (topicUrl.origin !== curriculumBase.origin || !topicUrl.pathname.startsWith(curriculumBase.pathname)) throw new Error("Curriculum path changed origin or root");
      const topicText = await fetchText(topicUrl, this.options.maxTopicBytes);
      totalBytes += Buffer.byteLength(topicText, "utf8");
      if (totalBytes > this.options.maxTotalBytes) throw new Error("Curriculum exceeds total size limit");
      const digest = createHash("sha256").update(topicText, "utf8").digest("hex");
      if (digest.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`Curriculum hash mismatch: ${entry.id}`);
      topics.push(parseTopic(topicText));
    }

    return { revision: commit, manifest, topics, stale: false };
  }
}

export class StaticDidacticContentRepository implements DidacticContentRepository {
  constructor(private readonly snapshot: DidacticContentSnapshot | null) {}

  async getSnapshot(): Promise<DidacticContentSnapshot | null> {
    return this.snapshot;
  }
}

function parseManifest(source: string): CurriculumManifest {
  const parsed = curriculumManifestSchema.safeParse(parseSafeYaml(source));
  if (!parsed.success) throw new Error("Invalid curriculum manifest");
  return validateCurriculumManifest(parsed.data);
}

function parseTopic(source: string): CurriculumTopic {
  const parsed = curriculumTopicSchema.safeParse(parseSafeYaml(source));
  if (!parsed.success) throw new Error("Invalid curriculum topic");
  return validateCurriculumTopic(parsed.data);
}

function parseSafeYaml(source: string): unknown {
  // The pilot format is data-only: reject explicit YAML tags before parsing so
  // unresolved/custom tags cannot be silently coerced by the YAML library.
  if (/(^|[\s,:\[\]{}])!(?:!|<|[A-Za-z])/i.test(source)) throw new Error("YAML tags are not allowed");
  return parseYaml(source, { schema: "core", uniqueKeys: true });
}

function validateSource(value: string, allowedHosts: readonly string[]): URL {
  const url = new URL(value.endsWith("/") ? value : `${value}/`);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid curriculum source URL");
  if (url.protocol !== "https:") {
    throw new Error("Curriculum source must use HTTPS");
  }
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new Error("Curriculum source host is not allowlisted");
  if (isIP(url.hostname) !== 0) throw new Error("IP literal curriculum sources are not allowed");
  return url;
}

function validateCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/i.test(value)) throw new Error("Curriculum commit must be a full SHA");
  return value;
}

async function fetchBoundedText(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  lookup: (hostname: string) => Promise<readonly { address: string }[]> = async (hostname) => dns.lookup(hostname, { all: true }),
): Promise<string> {
  let lookupTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    await Promise.race([
      assertPublicHost(url.hostname, lookup),
      new Promise<never>((_, reject) => {
        lookupTimer = globalThis.setTimeout(() => reject(new Error("Curriculum DNS lookup timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (lookupTimer) globalThis.clearTimeout(lookupTimer);
  }
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("Curriculum redirects are not allowed");
    if (!response.ok || !response.body) throw new Error(`Curriculum source returned ${response.status}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) throw new Error("Curriculum response exceeds size limit");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Curriculum response exceeds size limit");
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
    globalThis.clearTimeout(timeout);
  }
}

async function assertPublicHost(
  hostname: string,
  lookup: (hostname: string) => Promise<readonly { address: string }[]>,
): Promise<void> {
  const addresses = await lookup(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Curriculum source resolves to a private address");
  }
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice("::ffff:".length));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export { assertPublicHost, fetchBoundedText, isPrivateAddress, parseManifest, parseTopic, validateCommit, validateSource };
