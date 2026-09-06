#!/usr/bin/env node

/**
 * Host Profile Capture Script
 * 
 * Erfasst das aktuelle Hostprofil für reproduzierbare Lasttests.
 * Ausgabe als JSON nach stdout oder direkt in test-results/.
 * 
 * Usage:
 *   node scripts/capture-host-profile.mjs > host-profile.json
 *   node scripts/capture-host-profile.mjs --output test-results/load-test/host-profile.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getDockerInfo() {
  const dockerSettingsPath = join(os.homedir(), 'Library/Group Containers/group.com.docker/settings.json');
  const settings = existsSync(dockerSettingsPath) ? readJsonFile(dockerSettingsPath) : null;
  const dockerRamLimit = settings?.vmMemorySize ? settings.vmMemorySize / (1024 * 1024 * 1024) : null;
  const dockerCpuLimit = settings?.vcpuNumber ?? null;
  
  return {
    desktopVersion: settings?.version ?? null,
    engineVersion: null,
    ramLimit: dockerRamLimit,
    cpuLimit: dockerCpuLimit,
    storageDriver: null
  };
}

function getNodeInfo() {
  return {
    version: process.version.replace('v', ''),
    npmVersion: process.env.npm_config_user_agent?.split(' ')[0]?.replace('npm/', '') ?? null
  };
}

function getBrowserInfo() {
  const packageJson = readJsonFile(join(process.cwd(), 'node_modules/@playwright/test/package.json'));
  return {
    name: 'Chromium',
    version: packageJson?.version ?? null
  };
}

function getUnoSimConfig() {
  return {
    workerCount: Number.parseInt(process.env.WORKER_COUNT || '8', 10),
    compileMaxConcurrent: Number.parseInt(process.env.COMPILE_MAX_CONCURRENT || '8', 10),
    sandboxPoolMinRunners: Number.parseInt(process.env.SANDBOX_POOL_MIN_RUNNERS || '5', 10),
    sandboxPoolMaxRunners: Number.parseInt(process.env.SANDBOX_POOL_MAX_RUNNERS || '100', 10),
    sandboxMemoryMb: Number.parseInt(process.env.SANDBOX_MEMORY_MB || '256', 10),
    sandboxCpuLimit: Number.parseFloat(process.env.SANDBOX_CPU_LIMIT || '0.5'),
    simulationMode: process.env.UNOSIM_SIMULATION_MODE || 'docker-sandbox',
    dockerSandboxImage: process.env.DOCKER_SANDBOX_IMAGE || 'unosim-sandbox:latest'
  };
}

function getCPUInfo() {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown';
  
  // Apple Silicon Erkennung
  if (cpuModel.includes('Apple')) {
    const pCores = cpus.filter(cpu => cpu.speed > 2000).length;
    const eCores = cpus.length - pCores;
    return {
      model: cpuModel,
      cores: cpus.length,
      pCores,
      eCores,
      frequency: `${(cpus[0]?.speed / 1000).toFixed(1)} GHz`
    };
  }
  
  // Intel/AMD
  return {
    model: cpuModel,
    cores: cpus.length,
    pCores: null,
    eCores: null,
    frequency: `${(cpus[0]?.speed / 1000).toFixed(1)} GHz`
  };
}

function getRAMInfo() {
  const totalGB = os.totalmem() / (1024 * 1024 * 1024);
  
  // Docker-verfügbarer RAM (Schätzung: 75% des Gesamtspeichers als sicherer Wert)
  // Exakter Wert hängt von Docker Desktop Settings ab
  const dockerAvailableGB = totalGB * 0.75;
  
  return {
    total: Math.round(totalGB),
    dockerAvailable: Math.round(dockerAvailableGB),
    unit: 'GB'
  };
}

function getOSInfo() {
  return {
    platform: os.platform() === 'darwin' ? 'macOS' : os.platform(),
    version: os.release(),
    kernel: `Darwin ${os.release()}`
  };
}

function captureHostProfile() {
  const timestamp = new Date().toISOString();
  
  return {
    timestamp,
    cpu: getCPUInfo(),
    ram: getRAMInfo(),
    os: getOSInfo(),
    docker: getDockerInfo(),
    node: getNodeInfo(),
    browser: getBrowserInfo(),
    unosim: getUnoSimConfig()
  };
}

// Main
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;

const profile = captureHostProfile();

if (outputPath) {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(profile, null, 2));
  console.error(`Host profile written to ${outputPath}`);
} else {
  console.log(JSON.stringify(profile, null, 2));
}
