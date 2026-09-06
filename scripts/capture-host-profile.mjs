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

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

/**
 * Execute shell command safely with limited output
 * @param command - Command to execute (validated against allowlist)
 * @param args - Arguments (validated to prevent injection)
 */
function execSafe(command, args = []) {
  // Allowlist validation for security
  const allowedCommands = ['uname', 'sysctl', 'node', 'docker', 'sw_vers', 'free', 'cat'];
  if (!allowedCommands.includes(command)) {
    throw new Error(`Command not allowed: ${command}`);
  }
  
  // Validate args to prevent injection
  const safeArgs = args.filter(arg => /^[a-zA-Z0-9._/-]+$/.test(arg));
  
  try {
    return execSync(`${command} ${safeArgs.join(' ')}`, { 
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024, // 1MB buffer limit
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function parseDockerMemory(memStr) {
  if (!memStr) return null;
  const match = memStr.match(/([\d.]+)([A-Za-z]+)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'gb': return value;
    case 'mb': return value / 1024;
    case 'kb': return value / (1024 * 1024);
    case 'b': return value / (1024 * 1024 * 1024);
    default: return null;
  }
}

function getDockerInfo() {
  const dockerVersion = execSafe('docker', ['--version']);
  const dockerInfoRaw = execSafe('docker', ['info', '--format', '{{.ServerVersion}}']);
  
  // Docker Desktop RAM-Limit ermitteln
  let dockerRamLimit = null;
  let dockerCpuLimit = null;
  
  try {
    // Versuche, Docker Desktop Settings zu lesen (macOS)
    const dockerSettingsPath = `${os.homedir()}/Library/Group Containers/group.com.docker/settings.json`;
    if (existsSync(dockerSettingsPath)) {
      const settings = JSON.parse(execSafe('cat', [dockerSettingsPath]));
      if (settings.vmMemorySize) {
        dockerRamLimit = settings.vmMemorySize / (1024 * 1024 * 1024); // Bytes to GB
      }
      if (settings.vcpuNumber) {
        dockerCpuLimit = settings.vcpuNumber;
      }
    }
  } catch {
    // Fallback: docker stats (nur wenn Container läuft)
    const info = execSafe('docker', ['info']);
    if (info) {
      const memMatch = info.match(/Total Memory:\s*([\d.]+)\s*([A-Za-z]+)/);
      if (memMatch) {
        dockerRamLimit = parseDockerMemory(`${memMatch[1]}${memMatch[2]}`);
      }
    }
  }
  
  return {
    desktopVersion: dockerVersion ? dockerVersion.replace('Docker version ', '').split(' ')[0] : null,
    engineVersion: dockerInfoRaw,
    ramLimit: dockerRamLimit,
    cpuLimit: dockerCpuLimit,
    storageDriver: execSafe('docker', ['info', '--format', '{{.Driver}}'])
  };
}

function getNodeInfo() {
  return {
    version: process.version.replace('v', ''),
    npmVersion: execSafe('npm', ['--version'])
  };
}

function getBrowserInfo() {
  // Playwright Chromium Version ermitteln
  try {
    const playwrightInfo = execSafe('npx', ['playwright', '--version']);
    const versionMatch = playwrightInfo?.match(/(\d+\.\d+\.\d+)/);
    return {
      name: 'Chromium',
      version: versionMatch ? versionMatch[1] : null
    };
  } catch {
    return { name: 'Unknown', version: null };
  }
}

function getUnoSimConfig() {
  return {
    workerCount: parseInt(process.env.WORKER_COUNT || '8'),
    compileMaxConcurrent: parseInt(process.env.COMPILE_MAX_CONCURRENT || '8'),
    sandboxPoolMinRunners: parseInt(process.env.SANDBOX_POOL_MIN_RUNNERS || '5'),
    sandboxPoolMaxRunners: parseInt(process.env.SANDBOX_POOL_MAX_RUNNERS || '100'),
    sandboxMemoryMb: parseInt(process.env.SANDBOX_MEMORY_MB || '256'),
    sandboxCpuLimit: parseFloat(process.env.SANDBOX_CPU_LIMIT || '0.5'),
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
  const dir = join(outputPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(profile, null, 2));
  console.error(`Host profile written to ${outputPath}`);
} else {
  console.log(JSON.stringify(profile, null, 2));
}
