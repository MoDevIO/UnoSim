export const CAPACITY_PROFILES = {
  BASELINE: {
    minRunners: 5,
    maxRunners: 5,
    admissionMax: 25,
    description: "Historical validated test baseline (5 warm, 5 max, 25 admissions)",
  },
  R20: {
    minRunners: 5,
    maxRunners: 20,
    admissionMax: 100,
    description: "Test-only staging candidate (5 warm, 20 max, 100 admissions)",
  },
  R40: {
    minRunners: 5,
    maxRunners: 40,
    admissionMax: 100,
    description: "Test-only staging candidate (5 warm, 40 max, 100 admissions)",
  },
  R60: {
    minRunners: 10,
    maxRunners: 60,
    admissionMax: 100,
    description: "Test-only staging candidate (10 warm, 60 max, 100 admissions)",
  },
  R80: {
    minRunners: 10,
    maxRunners: 80,
    admissionMax: 100,
    description: "Test-only staging candidate (10 warm, 80 max, 100 admissions)",
  },
  R80_BURST: {
    minRunners: 10,
    maxRunners: 80,
    admissionMax: 180,
    description: "Test-only burst candidate (10 warm, 80 max, 180 admissions)",
  },
} as const;

export type CapacityProfileKey = keyof typeof CAPACITY_PROFILES;
export type CapacityProfile = (typeof CAPACITY_PROFILES)[CapacityProfileKey];

export interface CapacityRuntimeSnapshot {
  serverMode?: string;
  sandboxRunners?: { min?: number; max?: number };
  admissionControl?: { max?: number };
}

export function getCapacityProfile(profileKey: string): CapacityProfile {
  if (!Object.hasOwn(CAPACITY_PROFILES, profileKey)) {
    throw new Error(`Unknown capacity profile: ${profileKey}`);
  }
  return CAPACITY_PROFILES[profileKey as CapacityProfileKey];
}

export function assertCapacityRuntimeMatches(
  profile: CapacityProfile,
  actual: CapacityRuntimeSnapshot,
): void {
  const mismatches: string[] = [];
  if (actual.serverMode !== "docker") {
    mismatches.push(`serverMode expected docker, actual ${actual.serverMode}`);
  }
  if (actual.sandboxRunners?.min !== profile.minRunners) {
    mismatches.push(
      `minRunners expected ${profile.minRunners}, actual ${actual.sandboxRunners?.min}`,
    );
  }
  if (actual.sandboxRunners?.max !== profile.maxRunners) {
    mismatches.push(
      `maxRunners expected ${profile.maxRunners}, actual ${actual.sandboxRunners?.max}`,
    );
  }
  if (actual.admissionControl?.max !== profile.admissionMax) {
    mismatches.push(
      `admissionMax expected ${profile.admissionMax}, actual ${actual.admissionControl?.max}`,
    );
  }

  if (mismatches.length > 0) {
    throw new Error(`Capacity profile runtime mismatch: ${mismatches.join("; ")}`);
  }
}
