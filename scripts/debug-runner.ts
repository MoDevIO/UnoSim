import { SandboxRunner } from "../server/services/sandbox-runner.ts";

(async () => {
  const runner = new SandboxRunner();
  console.log("initial state running=", runner.isRunning, "paused=", runner.isPaused);
  runner.runSketch({
    code: `
      void setup() {
        Serial.begin(9600);
        Serial.println("BOOTED");
        pinMode(2, INPUT);
        Serial.println("START");
      }
      void loop() {
        int val = digitalRead(2);
        Serial.print("PIN2=");
        Serial.println(val);
        delay(100);
      }
    `,
    onOutput: (line) => { console.log("[RUNNER OUT]", line); },
    onError: (err) => { console.error("[RUNNER ERR]", err); },
    onExit: (code) => { console.log("[RUNNER EXIT]", code); },
  });
  setTimeout(() => {
    console.log("[RUNNER] setting pin 2 to HIGH");
    runner.setPinValue(2, 1);
  }, 500);

  const stateInterval = setInterval(() => console.log("state poll running=", runner.isRunning, "paused=", runner.isPaused), 200);
  await new Promise((r) => setTimeout(r, 3000));
  clearInterval(stateInterval);
  console.log("state before stop running=", runner.isRunning, "paused=", runner.isPaused);
  await runner.stop();
  console.log("stopped");
})();