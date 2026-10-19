# Spike P0.3 – browser performance

> Not product code. Measures how fast the emulation core runs in a Web Worker
> on real devices (plan P0.3). Instructions for the person doing the
> measurement: `docs/proposals/human-tests.md`, part 1.

```sh
npm run spike:p03        # builds spikes/p0-3/dist and serves it on port 8765
```

Open `http://<this computer's address>:8765/` in the browser under test,
press **Run**, wait about 45 seconds, press **Copy result** and paste the JSON
into the issue or report.

What the page measures per sketch (10 s of wall-clock run time each):

| Column | Meaning |
|---|---|
| peak speed | simulated time per wall time when the worker does nothing else (2 s unpaced run) – the real-time factor the device could reach at most |
| real-time factor | simulated time per wall time while running in real time (what a student sees); 1.00 = the sketch runs as fast as a real Uno |
| UI lag p95 / max | how late a 16 ms timer on the page thread fires while the worker runs, in ms – a measure of how responsive the page stays |

Criterion of the plan: at least 1.2 for IT05.5 on the weakest device. The decisive value is the **peak speed**: a device that is fast enough shows a real-time factor of 1.00, because the worker then waits for the wall clock; the real-time factor tells whether the device keeps up in real time at all.
