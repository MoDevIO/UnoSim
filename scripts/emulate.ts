// Headless run of a compiled sketch for maintainers: `npm run emulate -- <sketch.hex> --ms 3000`.
// Replaces the prototype script of the proposal (appendix A); the logic lives in the package.
import { readFileSync } from "node:fs";
import { runCli } from "@unosim/avr-emulator";

process.exitCode = runCli(process.argv.slice(2), {
  readText: (path) => readFileSync(path, "utf8"),
  readBytes: (path) => new Uint8Array(readFileSync(path)),
  write: (text) => process.stdout.write(text),
});
