const target = process.env.BACKEND_HEALTH_URL || "http://127.0.0.1:3000/api/health";
const timeoutMs = Number(process.env.BACKEND_WAIT_TIMEOUT_MS || 30000);
const intervalMs = Number(process.env.BACKEND_WAIT_INTERVAL_MS || 200);

const start = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isReady() {
  try {
    const res = await fetch(target, { method: "GET", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

while (true) {
  if (await isReady()) {
    console.log(`[wait-for-backend] Backend ready at ${target}`);
    process.exit(0);
  }

  if (Date.now() - start >= timeoutMs) {
    console.error(`[wait-for-backend] Timeout after ${timeoutMs}ms waiting for ${target}`);
    process.exit(1);
  }

  await sleep(intervalMs);
}
