import os from "node:os";

interface NetworkAddress { address: string; family: string | number; internal: boolean; }
export interface StartupAccess { backendUrl: string; networkUrls: string[]; }

interface StartupConfiguration {
  serverMode: "local" | "docker";
  trustMode: string;
  nodeEnv: string;
  simulationMaxConcurrent: number;
  admissionMax: number;
  queueTimeoutMs: number;
  sandboxStartMaxConcurrent: number;
  sandboxStartSlotTimeoutMs: number;
  compileMaxConcurrent: number;
  rateLimitDisabled: boolean;
  listenHost: string;
  port: number;
  sandboxMemoryMB: number;
  sandboxCpuLimit: string;
  fqbn: string;
  interfaces?: NodeJS.Dict<NetworkAddress[]>;
}

export interface StartupConfigurationEntry { label: string; value: string; }
const STARTUP_LABEL_WIDTH = 22;
const STARTUP_VALUE_WIDTH = 27;

export function formatStartupLine(label: string, value: string): string {
  const labelWithColon = label ? `${label}:` : "";
  return `│  ${labelWithColon.padEnd(STARTUP_LABEL_WIDTH)}${value.padEnd(STARTUP_VALUE_WIDTH)}│`;
}
function isIpv4(address: NetworkAddress): boolean { return address.family === "IPv4" || address.family === 4; }
function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}
export function getLocalIpv4Addresses(interfaces: NodeJS.Dict<NetworkAddress[]> = os.networkInterfaces() as NodeJS.Dict<NetworkAddress[]>): string[] {
  return Array.from(new Set(Object.values(interfaces).flatMap((entries) => entries ?? []).filter((entry) => isIpv4(entry) && !entry.internal && isPrivateIpv4(entry.address)).map((entry) => entry.address)));
}
export function getStartupAccess(listenHost: string, port: number, interfaces?: NodeJS.Dict<NetworkAddress[]>): StartupAccess {
  const backendUrl = `http://127.0.0.1:${port}`;
  const networkUrls = listenHost === "0.0.0.0" ? getLocalIpv4Addresses(interfaces).map((address) => `http://${address}:${port}`) : [];
  return { backendUrl, networkUrls };
}

export function getStartupConfigurationEntries(startup: StartupConfiguration): StartupConfigurationEntry[] {
  const access = getStartupAccess(startup.listenHost, startup.port, startup.interfaces);
  const entries: StartupConfigurationEntry[] = [
    { label: "Server Mode", value: startup.serverMode },
    { label: "Trust Mode", value: startup.trustMode },
    { label: "NODE_ENV", value: startup.nodeEnv },
    { label: "Simulation capacity", value: "" },
    { label: "Concurrent max", value: String(startup.simulationMaxConcurrent) },
    { label: "Admission max", value: String(startup.admissionMax) },
    { label: "Queue timeout", value: `${Math.round(startup.queueTimeoutMs / 1000)} s` },
    { label: "Sandbox startup", value: "" },
    { label: "Concurrent max", value: String(startup.sandboxStartMaxConcurrent) },
    { label: "Slot timeout", value: `${Math.round(startup.sandboxStartSlotTimeoutMs / 1000)} s` },
    { label: "Compilation", value: "" },
    { label: "Concurrent max", value: String(startup.compileMaxConcurrent) },
  ];
  entries.push(
    { label: "Rate Limit Disabled", value: String(startup.rateLimitDisabled) },
    { label: "Listen Host", value: startup.listenHost },
    { label: "Port", value: String(startup.port) },
    { label: "Backend URL", value: access.backendUrl },
    ...access.networkUrls.map((url, index) => ({ label: index === 0 ? "Network URL" : "", value: url })),
  );
  if (startup.serverMode === "docker") {
    entries.push(
      { label: "Sandbox Memory MB", value: String(startup.sandboxMemoryMB) },
      { label: "Sandbox CPU Limit", value: String(startup.sandboxCpuLimit) },
    );
  }
  entries.push({ label: "FQBN", value: startup.fqbn });
  return entries;
}
