export const CAPACITY_PROFILES = {
  BASELINE: {
    simulationMaxConcurrent: 5,
    sandboxStartMaxConcurrent: 5,
    admissionMax: 25,
    description: "Historical validated test baseline (5 simulation / 5 startup / 25 admissions)",
  },
  R20: {
    simulationMaxConcurrent: 20,
    sandboxStartMaxConcurrent: 20,
    admissionMax: 100,
    description: "Test-only staging candidate (20 simulation / 20 startup / 100 admissions)",
  },
  R40: {
    simulationMaxConcurrent: 40,
    sandboxStartMaxConcurrent: 40,
    admissionMax: 100,
    description: "Test-only staging candidate (40 simulation / 40 startup / 100 admissions)",
  },
  R60: {
    simulationMaxConcurrent: 60,
    sandboxStartMaxConcurrent: 60,
    admissionMax: 100,
    description: "Test-only staging candidate (60 simulation / 60 startup / 100 admissions)",
  },
  R80: {
    simulationMaxConcurrent: 80,
    sandboxStartMaxConcurrent: 80,
    admissionMax: 100,
    description: "Test-only staging candidate (80 simulation / 80 startup / 100 admissions)",
  },
  R80_BURST: {
    simulationMaxConcurrent: 80,
    sandboxStartMaxConcurrent: 80,
    admissionMax: 180,
    description: "Test-only burst candidate (80 simulation / 80 startup / 180 admissions)",
  },
} as const;

export type CapacityProfileKey = keyof typeof CAPACITY_PROFILES;
export type CapacityProfile = (typeof CAPACITY_PROFILES)[CapacityProfileKey];

export interface CapacityRuntimeSnapshot {
  serverMode?: string;
  capacity?: {
    simulation?: { maxConcurrent?: number; active?: number };
    sandboxStart?: { maxConcurrent?: number; active?: number; waiting?: number };
    admission?: { max?: number; current?: number };
    queue?: { waiting?: number; timeoutMs?: number };
    compile?: { maxConcurrent?: number; active?: number };
  };
}

export function getCapacityProfile(profileKey: string): CapacityProfile {
  if (!Object.hasOwn(CAPACITY_PROFILES, profileKey)) throw new Error(`Unknown capacity profile: ${profileKey}`);
  return CAPACITY_PROFILES[profileKey as CapacityProfileKey];
}

export function assertCapacityRuntimeMatches(profile: CapacityProfile, actual: CapacityRuntimeSnapshot): void {
  const mismatches: string[] = [];
  const simulation = actual.capacity?.simulation?.maxConcurrent;
  const sandboxStart = actual.capacity?.sandboxStart?.maxConcurrent;
  const admission = actual.capacity?.admission?.max;
  if (actual.serverMode !== "docker") mismatches.push(`serverMode expected docker, actual ${actual.serverMode}`);
  if (simulation !== profile.simulationMaxConcurrent) mismatches.push(`simulationMaxConcurrent expected ${profile.simulationMaxConcurrent}, actual ${simulation}`);
  if (sandboxStart !== profile.sandboxStartMaxConcurrent) mismatches.push(`sandboxStartMaxConcurrent expected ${profile.sandboxStartMaxConcurrent}, actual ${sandboxStart}`);
  if (admission !== profile.admissionMax) mismatches.push(`admissionMax expected ${profile.admissionMax}, actual ${admission}`);
  if (sandboxStart !== undefined && sandboxStart < profile.simulationMaxConcurrent) mismatches.push(`sandboxStartMaxConcurrent must be >= simulationMaxConcurrent (${sandboxStart} < ${profile.simulationMaxConcurrent})`);
  if (mismatches.length > 0) throw new Error(`Capacity profile runtime mismatch: ${mismatches.join("; ")}`);
}
