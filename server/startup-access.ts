import os from "node:os";

interface NetworkAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export interface StartupAccess {
  localUrl: string;
  networkUrls: string[];
}

const STARTUP_LABEL_WIDTH = 22;
const STARTUP_VALUE_WIDTH = 27;

export function formatStartupLine(label: string, value: string): string {
  const labelWithColon = label ? `${label}:` : "";
  return `│  ${labelWithColon.padEnd(STARTUP_LABEL_WIDTH)}${value.padEnd(STARTUP_VALUE_WIDTH)}│`;
}

function isIpv4(address: NetworkAddress): boolean {
  return address.family === "IPv4" || address.family === 4;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function getLocalIpv4Addresses(
  interfaces: NodeJS.Dict<NetworkAddress[]> = os.networkInterfaces() as NodeJS.Dict<NetworkAddress[]>,
): string[] {
  return Array.from(
    new Set(
      Object.values(interfaces)
        .flatMap((entries) => entries ?? [])
        .filter((entry) => isIpv4(entry) && !entry.internal && isPrivateIpv4(entry.address))
        .map((entry) => entry.address),
    ),
  );
}

export function getStartupAccess(
  listenHost: string,
  port: number,
  interfaces?: NodeJS.Dict<NetworkAddress[]>,
): StartupAccess {
  const localUrl = `http://127.0.0.1:${port}`;
  const networkUrls = listenHost === "0.0.0.0"
    ? getLocalIpv4Addresses(interfaces).map((address) => `http://${address}:${port}`)
    : [];

  return { localUrl, networkUrls };
}
