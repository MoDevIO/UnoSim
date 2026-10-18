// Spike P0.4 – evaluate runtime IO detection against the symbol reference and static analysis.
// Usage: node spikes/p0-4/evaluate.mjs <runtime.json> <static.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [runtimeFile, staticFile, outFile] = process.argv.slice(2);
const { results } = JSON.parse(readFileSync(runtimeFile, "utf8"));
const statics = JSON.parse(readFileSync(staticFile, "utf8"));
const OPS = ["pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite"];
const LEVELS = ["R0", "R1", "R2"];
const opOf = (k) => k.split(":")[0];

const acc = {};
for (const level of LEVELS) for (const op of OPS) acc[`${level}:${op}`] = { tp: 0, fn: 0, fp: 0, modeOk: 0, modeTotal: 0 };
const staticAcc = Object.fromEntries(OPS.map((op) => [op, { static: 0, executed: 0, confirmedR2: 0, confirmedR0: 0 }]));
const perSketch = {};
let runtimeOnlyTruth = 0, portOnlyCount = { R0: 0, R1: 0 }, sameSerial = 0, ltoSymbolSketches = 0;
const hookRatios = [], rtfBare = [], rtfObs = [];

for (const [name, r] of Object.entries(results)) {
  const truth = r.truth;
  const st = statics[name]?.pairs ?? {};
  if (r.sameSerial) sameSerial++;
  if (r.ioSymbolsLto.length) ltoSymbolSketches++;
  hookRatios.push(r.hookCostRatio); rtfBare.push(r.realTimeFactorBare); rtfObs.push(r.realTimeFactorObserved);
  portOnlyCount.R0 += r.portOnly.R0.length; portOnlyCount.R1 += r.portOnly.R1.length;
  const row = { truth: Object.keys(truth), static: Object.keys(st) };
  for (const level of LEVELS) {
    const found = r.levels[level];
    row[level] = Object.keys(found);
    for (const key of Object.keys(truth)) {
      const a = acc[`${level}:${opOf(key)}`];
      if (found[key]) {
        a.tp++;
        if (opOf(key) === "pinMode") {
          a.modeTotal++;
          const tm = [...truth[key].modes].sort().join(), fm = [...found[key].modes].sort().join();
          if (tm === fm) a.modeOk++;
        }
      } else a.fn++;
    }
    for (const key of Object.keys(found)) if (!truth[key]) acc[`${level}:${opOf(key)}`].fp++;
  }
  for (const key of Object.keys(st)) {
    const s = staticAcc[opOf(key)];
    s.static++;
    if (truth[key]) s.executed++;
    if (r.levels.R2[key]) s.confirmedR2++;
    if (r.levels.R0[key]) s.confirmedR0++;
  }
  for (const key of Object.keys(truth)) if (!st[key]) runtimeOnlyTruth++;
  row.portOnly = r.portOnly.R1;
  perSketch[name] = row;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = {
  sketches: Object.keys(results).length,
  sameSerialAsReference: sameSerial,
  sketchesWithIoSymbolsAfterLto: ltoSymbolSketches,
  accuracy: acc,
  static: staticAcc,
  truthPairsWithoutStaticEntry: runtimeOnlyTruth,
  portOnlyFindings: portOnlyCount,
  hookCostRatioMedian: median(hookRatios), hookCostRatioMax: Math.max(...hookRatios),
  realTimeFactorBareMedian: median(rtfBare), realTimeFactorObservedMedian: median(rtfObs),
};
writeFileSync(outFile, JSON.stringify({ summary, perSketch }, null, 2));
console.log(JSON.stringify(summary, null, 1));
