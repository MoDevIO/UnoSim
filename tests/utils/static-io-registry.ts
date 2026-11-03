import type { IOPinRecord } from "@shared/schema";
import { parseStaticIORegistryProject, type StaticIOOptions } from "@shared/io-registry-parser";

/**
 * The registry of a single sketch through the project parser the page uses,
 * without the project-only file locations.
 */
export function parseStaticIORegistry(code: string, options: StaticIOOptions = {}): IOPinRecord[] {
  return parseStaticIORegistryProject({ entryFile: "main.ino", files: { "main.ino": code } }, options).map(
    ({ pinModeLocations: _pm, digitalReadLocations: _dr, digitalWriteLocations: _dw, analogReadLocations: _ar, analogWriteLocations: _aw, ...record }) => record,
  );
}
