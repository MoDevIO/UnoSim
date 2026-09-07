import dns from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../../config";
import {
  examplesManifestSchema,
  type ExampleRecord,
  validateManifestReferences,
} from "./examples-schema";

type CachedRemoteSnapshot = {
  expiresAt: number;
  examples: ExampleRecord[];
};

export class HttpProvider {
  private cached: CachedRemoteSnapshot | null = null;
  private loading: Promise<ExampleRecord[]> | null = null;

  async getExamples(): Promise<{ examples: ExampleRecord[]; status: "remote" | "cache"; stale: boolean } | null> {
    if (!config.examples.source || !config.examples.ref) return null;

    if (this.cached && this.cached.expiresAt > Date.now()) {
      return { examples: this.cached.examples, status: "cache", stale: false };
    }

    if (!this.loading) {
      this.loading = this.loadRemote().finally(() => {
        this.loading = null;
      });
    }

    try {
      const examples = await this.loading;
      this.cached = { examples, expiresAt: Date.now() + config.examples.refreshMs };
      return { examples, status: "remote", stale: false };
    } catch {
      if (this.cached) {
        this.cached.expiresAt = Date.now() + config.examples.refreshMs;
        return { examples: this.cached.examples, status: "cache", stale: true };
      }
      return null;
    }
  }

  private async loadRemote(): Promise<ExampleRecord[]> {
    const source = validateSourceUrl(config.examples.source);
    const ref = validateRef(config.examples.ref);
    const base = new URL(`${encodeURIComponent(ref)}/`, source);
    const manifestUrl = new URL("manifest.json", base);
    const manifestText = await fetchText(manifestUrl, config.examples.maxManifestBytes);
    const parsed = examplesManifestSchema.safeParse(JSON.parse(manifestText) as unknown);
    if (!parsed.success) throw new Error("Invalid external examples manifest");
    const manifest = parsed.data;
    validateManifestReferences(manifest);
    if (manifest.ref && manifest.ref !== ref) throw new Error("External manifest ref does not match configured ref");
    const fileCount = manifest.examples.reduce((total, example) => total + example.files.length, 0);
    if (fileCount > config.examples.maxFiles) throw new Error("External examples exceed file count limit");

    const examples = await Promise.all(manifest.examples.map(async (example) => {
      const files = await Promise.all(example.files.map(async (file) => {
        const fileUrl = new URL(file.path.split("/").map(encodeURIComponent).join("/"), base);
        if (fileUrl.origin !== base.origin) throw new Error("Example path changed origin");
        const content = await fetchText(fileUrl, config.examples.maxFileBytes);
        return { ...file, content };
      }));
      return { ...example, files, source: "external" as const };
    }));

    const totalBytes = examples.reduce(
      (total, example) => total + example.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0),
      0,
    );
    if (totalBytes > config.examples.maxTotalBytes) throw new Error("External examples exceed total size limit");
    return examples;
  }
}

function validateSourceUrl(value: string): URL {
  const url = new URL(value.endsWith("/") ? value : `${value}/`);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid examples source URL");
  if (url.protocol !== "https:" && !(config.examples.allowHttp && config.nodeEnv !== "production")) {
    throw new Error("External examples source must use HTTPS");
  }
  if (!config.examples.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("External examples source host is not allowlisted");
  }
  if (isIP(url.hostname) !== 0) throw new Error("IP literal examples sources are not allowed");
  return url;
}

function validateRef(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Invalid external examples ref");
  if (config.nodeEnv === "production" && value === "main") throw new Error("Floating refs are not allowed in production");
  return value;
}

async function fetchText(url: URL, maxBytes: number): Promise<string> {
  await assertPublicHost(url.hostname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.examples.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
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
