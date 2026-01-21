import { SandboxRunner } from "./dist/services/sandbox-runner.js";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const code = readFileSync("./public/examples/03-projects/io-test.ino", "utf8");
const runner = new SandboxRunner();

console.log("Starting sketch execution with io-test.ino...\n");

await runner.runSketch(
  code,
  (line) => {}, // onOutput - ignorieren für diesen Test
  (err) => console.error("Error:", err),
  (exitCode) => {
    console.log("Sketch finished with exit code:", exitCode);
  },
  (err) => console.error("Compile error:", err),
  () => console.log("✓ Compilation successful"),
  undefined, // onPinState
  2, // timeout 2 seconds
  (registry) => {
    // Dies wird aufgerufen wenn Registry empfangen wird
    console.log("\n✓ I/O Registry received in callback");
    console.log("  Total pins:", registry.length);
    console.log("  Defined pins:", registry.filter((p) => p.defined).length);
    console.log(
      "  Pins with operations:",
      registry.filter((p) => p.usedAt && p.usedAt.length > 0).length,
    );
  },
);

// Warte etwas und prüfe dann die JSON-Datei
setTimeout(() => {
  try {
    const newestFile = execSync(
      "ls -t temp/io-registry-*.json 2>/dev/null | head -1",
    )
      .toString()
      .trim();
    if (newestFile) {
      console.log("\n✓ Registry file created:", newestFile);
      const content = readFileSync(newestFile, "utf8");
      const registry = JSON.parse(content);

      console.log("\n=== File Content Summary ===");
      console.log("Total pins in file:", registry.length);
      console.log(
        "Defined pins:",
        registry
          .filter((p) => p.defined)
          .map((p) => p.pin)
          .join(", "),
      );

      // Zeige Details der definierten Pins
      console.log("\n=== Pin Details ===");
      registry
        .filter((p) => p.defined)
        .forEach((pin) => {
          const ops = pin.usedAt
            ? pin.usedAt.map((u) => u.operation).join(", ")
            : "none";
          console.log(
            `  Pin ${pin.pin}: defined at line ${pin.definedAt?.line || 0}, operations: ${ops}`,
          );
        });
    } else {
      console.log("\n✗ No registry file found in temp/");
    }
  } catch (err) {
    console.error("Error reading file:", err.message);
  }
  process.exit(0);
}, 3000);
