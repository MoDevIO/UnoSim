#!/usr/bin/env node

/**
 * Load Test Summary Generator
 * 
 * Generiert eine standardisierte Zusammenfassung aus Lasttest-Metriken.
 * Liest alle metrics-*.json Dateien und erstellt summary.md.
 * 
 * Usage:
 *   node scripts/generate-load-summary.mjs test-results/load-YYYY-MM-DDTHH-MM-SSZ/
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

function readJson(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStatusIcon(testResult) {
  const successRate = testResult.successRate || 0;
  const timeoutCount = testResult.timeoutCount || 0;
  const cleanupSuccess = testResult.cleanupSuccess;
  
  if (successRate >= 98 && timeoutCount === 0 && cleanupSuccess) {
    return '✅ Bestanden';
  } else if (successRate >= 90 && cleanupSuccess) {
    return '⚠️ Mit Warnungen';
  } else {
    return '❌ Durchgefallen';
  }
}

function generateSummary(resultsDir) {
  const dirContents = readdirSync(resultsDir);
  
  // Host-Profil laden
  const hostProfile = readJson(join(resultsDir, 'host-profile.json'));
  
  // Metriken laden
  const metricsFiles = dirContents
    .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
    .sort();
  
  const metrics = metricsFiles.map(f => {
    const clientCount = parseInt(f.match(/metrics-(\d+)\.json/)[1]);
    return {
      clientCount,
      data: readJson(join(resultsDir, f))
    };
  }).filter(m => m.data !== null);
  
  // Cleanup-Report laden
  const cleanupReport = readJson(join(resultsDir, 'cleanup-report.json'));
  
  // Summary generieren
  const testId = basename(resultsDir);
  const testDate = hostProfile?.timestamp ? formatTimestamp(hostProfile.timestamp) : 'Unbekannt';
  
  let markdown = `# Load Test Summary

**Test ID:** \`${testId}\`  
**Datum:** ${testDate}  
**Hostprofil:** Siehe \`host-profile.json\`

## Host-Profil

`;

  if (hostProfile) {
    markdown += `### Hardware

- **CPU:** ${hostProfile.cpu?.model || 'Unbekannt'} (${hostProfile.cpu?.cores || '?'} Kerne)
- **RAM:** ${hostProfile.ram?.total || '?'} GB (Docker: ${hostProfile.ram?.dockerAvailable || '?'} GB)
- **OS:** ${hostProfile.os?.platform || '?'} ${hostProfile.os?.version || ''}

### Software

- **Node.js:** v${hostProfile.node?.version || '?'}
- **Docker:** ${hostProfile.docker?.desktopVersion || '?'} (Engine: ${hostProfile.docker?.engineVersion || '?'})
- **Browser:** ${hostProfile.browser?.name || '?'} ${hostProfile.browser?.version || ''}

### UnoSim-Konfiguration

- **Simulation Mode:** ${hostProfile.unosim?.simulationMode || '?'}
- **Worker Count:** ${hostProfile.unosim?.workerCount || '?'}
- **Compile Slots:** ${hostProfile.unosim?.compileMaxConcurrent || '?'}
- **Sandbox Pool:** ${hostProfile.unosim?.sandboxPoolMinRunners || '?'}–${hostProfile.unosim?.sandboxPoolMaxRunners || '?'} Runners
- **Sandbox Memory:** ${hostProfile.unosim?.sandboxMemoryMb || '?'} MB

---

`;
  } else {
    markdown += `⚠️ **Host-Profil nicht gefunden**

---

`;
  }

  markdown += `## Test-Ergebnisse

`;

  if (metrics.length === 0) {
    markdown += `⚠️ **Keine Metriken gefunden**

`;
  } else {
    markdown += `| Test | Clients | Erfolgreich | Fehlgeschlagen | Erfolgsrate | p95 Gesamtzeit | Status |
| --- | --- | --- | --- | --- | --- | --- |
`;

    for (const m of metrics) {
      const data = m.data;
      const failed = data.failed || 0;
      const successRate = data.successRate?.toFixed(1) || '0.0';
      const p95 = data.p95?.toFixed(0) || '0';
      const status = getStatusIcon(data);
      
      markdown += `| ${m.clientCount} Clients | ${m.clientCount} | ${data.successful || 0} | ${failed} | ${successRate}% | ${p95} ms | ${status} |
`;
    }

    markdown += `
`;
  }

  // Host-Metriken aus allen Tests aggregieren
  const peakCpu = Math.max(...metrics.map(m => m.data?.peakCpuUsage || 0));
  const peakMemory = Math.max(...metrics.map(m => m.data?.peakMemoryUsage || 0));
  const peakRunners = Math.max(...metrics.map(m => m.data?.peakActiveRunners || 0));
  const peakQueue = Math.max(...metrics.map(m => m.data?.peakQueueDepth || 0));

  markdown += `## Host-Metriken

- **CPU-Spitze:** ${peakCpu.toFixed(1)} %
- **RAM-Spitze:** ${(peakMemory / 1024).toFixed(1)} GB (${((peakMemory / (osTotalMemory() || 1)) * 100).toFixed(0)} %)
- **Aktive Runner (max):** ${peakRunners}
- **Queue-Tiefe (max):** ${peakQueue}

---

`;

  // Cleanup
  markdown += `## Cleanup

`;
  
  if (cleanupReport) {
    markdown += `- **Container vor/nach Test:** ${cleanupReport.containersBefore} / ${cleanupReport.containersAfter}
- **Prozesse vor/nach Test:** ${cleanupReport.processesBefore} / ${cleanupReport.processesAfter}
- **Leak erkannt:** ${cleanupReport.leakDetected ? '⚠️ Ja' : '✅ Nein'}

`;
    
    if (cleanupReport.details) {
      markdown += `**Details:** ${cleanupReport.details}

`;
    }
  } else {
    markdown += `⚠️ **Cleanup-Report nicht gefunden**

`;
  }

  // Fazit
  markdown += `## Fazit

`;
  
  const passed50 = metrics.find(m => m.clientCount === 50);
  const passed100 = metrics.find(m => m.clientCount === 100);
  const passed200 = metrics.find(m => m.clientCount === 200);
  
  const conclusions = [];
  
  if (passed50?.data?.successRate >= 98) {
    conclusions.push('✅ 50 Clients stabil bestanden');
  } else if (passed50) {
    conclusions.push('⚠️ 50 Clients mit Einschränkungen bestanden');
  }
  
  if (passed100?.data?.successRate >= 95) {
    conclusions.push('✅ 100 Clients stabil bestanden');
  } else if (passed100) {
    conclusions.push('⚠️ 100 Clients mit Einschränkungen bestanden');
  }
  
  if (passed200?.data?.successRate >= 90) {
    conclusions.push('✅ 200 Clients im Stresstest bestanden');
  } else if (passed200) {
    conclusions.push('⚠️ 200 Clients zeigen erste Stabilitätsprobleme');
  }
  
  if (conclusions.length > 0) {
    markdown += conclusions.join('  \n') + '\n\n';
  } else {
    markdown += 'Keine aussagekräftigen Tests durchgeführt.\n\n';
  }
  
  // Empfehlung
  let recommendation = 'Keine Empfehlung möglich (unzureichende Daten).';
  
  if (passed100?.data?.successRate >= 95 && (!passed200 || passed200.data.successRate < 90)) {
    recommendation = `**Empfehlung:** ${passed100.clientCount} Clients als Produktionslimit bei diesem Host-Profil dokumentieren.`;
  } else if (passed200?.data?.successRate >= 90) {
    recommendation = `**Empfehlung:** ${passed200.clientCount} Clients werden unterstützt. Für höhere Lasten Host-RAM auf ≥ 48 GB erweitern.`;
  } else if (passed50?.data?.successRate >= 98) {
    recommendation = `**Empfehlung:** Maximal ${passed50.clientCount} Clients bei diesem Host-Profil. Für höhere Lasten Docker-RAM und CPU erweitern.`;
  }
  
  markdown += `${recommendation}

---

## Artefakte

Folgende Artefakte wurden in diesem Verzeichnis generiert:

`;
  
  for (const f of dirContents.sort()) {
    markdown += `- \`${f}\`\n`;
  }

  return markdown;
}

function osTotalMemory() {
  try {
    return os.totalmem();
  } catch {
    return null;
  }
}

import os from 'node:os';

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/generate-load-summary.mjs <results-dir>');
  process.exit(1);
}

const resultsDir = args[0];

if (!existsSync(resultsDir)) {
  console.error(`Error: Directory ${resultsDir} does not exist`);
  process.exit(1);
}

try {
  const summary = generateSummary(resultsDir);
  const outputPath = join(resultsDir, 'summary.md');
  writeFileSync(outputPath, summary);
  console.log(`Summary written to ${outputPath}`);
} catch (error) {
  console.error('Error generating summary:', error.message);
  process.exit(1);
}
