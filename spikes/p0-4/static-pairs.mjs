// Spike P0.4 – static (pin, function) pairs from analyzeStaticIO for each sketch.
// Usage (repo root): npx tsx spikes/p0-4/static-pairs.mjs <src-dir> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeStaticIO } from "../../shared/io-registry-parser.ts";

const [srcDir, outFile] = process.argv.slice(2);
const result = {};
for (const name of readdirSync(srcDir).sort()) {
  const code = readFileSync(join(srcDir, name, `${name}.ino`), "utf8");
  const analysis = analyzeStaticIO(code);
  const pairs = {};
  for (const pin of analysis.pins) {
    for (const call of pin.calls) {
      const key = `${call.op}:${pin.pinId}`;
      pairs[key] ??= { lines: [], modes: [] };
      pairs[key].lines.push(call.line);
      if (call.mode) pairs[key].modes.push(call.mode);
    }
  }
  result[name] = {
    pairs,
    unresolved: analysis.unresolvedCalls.map((c) => ({ op: c.op, line: c.line, expr: c.sourceExpression })),
  };
}
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(`static pairs for ${Object.keys(result).length} sketches`);
