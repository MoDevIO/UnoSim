#!/usr/bin/env node

/**
 * Load Test Summary Generator (Bereinigt)
 * 
 * Generiert eine standardisierte Zusammenfassung aus Lasttest-Metriken.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';

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
  const cleanupSuccess = testResult.cleanupSuccess !== false;
  
  if (successRate >= 98 && timeoutCount === 0 && cleanupSuccess) {
    return '✅ Bestanden';
  } else if (successRate >= 90 && cleanupSuccess) {
    return '⚠️ Mit Warnungen';
  }
  return '❌ Durchgefallen';
}

function generateHostProfileSection(hostProfile) {
  let md = `### Hardware\n\n`;
  md += `- **CPU:** ${hostProfile.cpu?.model || 'Unbekannt'} (${hostProfile.cpu?.cores || '?'} Kerne)\n`;
  md += `- **RAM:** ${hostProfile.ram?.total || '?'} GB (Docker: ${hostProfile.ram?.dockerAvailable || '?'} GB)\n`;
  md += `- **OS:** ${hostProfile.os?.platform || '?'} ${hostProfile.os?.version || ''}\n\n`;
  
  md += `### Software\n\n`;
  md += `- **Node.js:** v${hostProfile.node?.version || '?'}\n`;
  md += `- **Docker:** ${hostProfile.docker?.desktopVersion || '?'} (Engine: ${hostProfile.docker?.engineVersion || '?'})\n`;
  md += `- **Browser:** ${hostProfile.browser?.name || '?'} ${hostProfile.browser?.version || ''}\n\n`;
  
  md += `### UnoSim-Konfiguration\n\n`;
  md += `- **Simulation Mode:** ${hostProfile.unosim?.simulationMode || '?'}\n`;
  md += `- **Worker Count:** ${hostProfile.unosim?.workerCount || '?'}\n`;
  md += `- **Compile Slots:** ${hostProfile.unosim?.compileMaxConcurrent || '?'}\n`;
  md += `- **Sandbox Pool:** ${hostProfile.unosim?.sandboxPoolMinRunners || '?'}–${hostProfile.unosim?.sandboxPoolMaxRunners || '?'} Runners\n`;
  md += `- **Sandbox Memory:** ${hostProfile.unosim?.sandboxMemoryMb || '?'} MB\n\n---\n\n`;
  
  return md;
}

function generateTestResultsTable(metrics) {
  let md = `| Test | Clients | Erfolgreich | Fehlgeschlagen | Erfolgsrate | p95 Gesamtzeit | Status |\n`;
  md += `| --- | --- | --- | --- | --- | --- | --- |\n`;
  
  for (const m of metrics) {
    const data = m.data;
    const failed = data.failed || 0;
    const successRate = data.successRate?.toFixed(1) || '0.0';
    const p95 = data.p95?.toFixed(0) || '0';
    const status = getStatusIcon(data);
    
    md += `| ${m.clientCount} Clients | ${m.clientCount} | ${data.successful || 0} | ${failed} | ${successRate}% | ${p95} ms | ${status} |\n`;
  }
  
  return md + '\n';
}

function generateConclusion(metrics) {
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
    return conclusions.join('  \n') + '\n\n';
  }
  return 'Keine aussagekräftigen Tests durchgeführt.\n\n';
}

function generateRecommendation(metrics) {
  const passed50 = metrics.find(m => m.clientCount === 50);
  const passed100 = metrics.find(m => m.clientCount === 100);
  const passed200 = metrics.find(m => m.clientCount === 200);
  
  if (passed100?.data?.successRate >= 95 && (!passed200 || passed200.data.successRate < 90)) {
    return `**Empfehlung:** ${passed100.clientCount} Clients als Produktionslimit bei diesem Host-Profil dokumentieren.\n\n---\n\n`;
  } else if (passed200?.data?.successRate >= 90) {
    return `**Empfehlung:** ${passed200.clientCount} Clients werden unterstützt. Für höhere Lasten Host-RAM auf ≥ 48 GB erweitern.\n\n---\n\n`;
  } else if (passed50?.data?.successRate >= 98) {
    return `**Empfehlung:** Maximal ${passed50.clientCount} Clients bei diesem Host-Profil. Für höhere Lasten Docker-RAM und CPU erweitern.\n\n---\n\n`;
  }
  
  return 'Keine Empfehlung möglich (unzureichende Daten).\n\n---\n\n';
}

function generateArtifactsList(testId, dirContents) {
  let md = `## Artefakte\n\nFolgende Artefakte wurden in diesem Verzeichnis generiert:\n\n`;
  
  const sortedContents = dirContents.toSorted((a, b) => a.localeCompare(b));
  for (const f of sortedContents) {
    md += `- \`${f}\`\n`;
  }
  
  return md;
}

function generateSummary(resultsDir) {
  const dirContents = readdirSync(resultsDir);
  const hostProfile = readJson(join(resultsDir, 'host-profile.json'));
  
  const metricsFiles = dirContents
    .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
    .toSorted((a, b) => a.localeCompare(b));
  
  const metrics = metricsFiles
    .map(f => {
      const match = f.match(/metrics-(\d+)\.json/);
      const clientCount = match ? Number.parseInt(match[1]) : 0;
      return { clientCount, data: readJson(join(resultsDir, f)) };
    })
    .filter(m => m.data !== null && m.clientCount > 0);
  
  const cleanupReport = readJson(join(resultsDir, 'cleanup-report.json'));
  const testId = basename(resultsDir);
  const testDate = hostProfile?.timestamp ? formatTimestamp(hostProfile.timestamp) : 'Unbekannt';
  
  let markdown = `# Load Test Summary\n\n**Test ID:** \`${testId}\`  \n**Datum:** ${testDate}  \n**Hostprofil:** Siehe \`host-profile.json\`\n\n## Host-Profil\n\n`;
  
  if (hostProfile) {
    markdown += generateHostProfileSection(hostProfile);
  } else {
    markdown += `⚠️ **Host-Profil nicht gefunden**\n\n---\n\n`;
  }
  
  markdown += `## Test-Ergebnisse\n\n`;
  
  if (metrics.length === 0) {
    markdown += `⚠️ **Keine Metriken gefunden**\n\n`;
  } else {
    markdown += generateTestResultsTable(metrics);
  }
  
  const peakCpu = Math.max(...metrics.map(m => m.data?.peakCpuUsage || 0));
  const peakMemory = Math.max(...metrics.map(m => m.data?.peakMemoryUsage || 0));
  const peakRunners = Math.max(...metrics.map(m => m.data?.peakActiveRunners || 0));
  const peakQueue = Math.max(...metrics.map(m => m.data?.peakQueueDepth || 0));
  const osTotal = os.totalmem();
  
  markdown += `## Host-Metriken\n\n`;
  markdown += `- **CPU-Spitze:** ${peakCpu.toFixed(1)} %\n`;
  markdown += `- **RAM-Spitze:** ${(peakMemory / 1024).toFixed(1)} GB (${((peakMemory / osTotal) * 100).toFixed(0)} %)\n`;
  markdown += `- **Aktive Runner (max):** ${peakRunners}\n`;
  markdown += `- **Queue-Tiefe (max):** ${peakQueue}\n\n---\n\n`;
  
  markdown += `## Cleanup\n\n`;
  
  if (cleanupReport) {
    markdown += `- **Container vor/nach Test:** ${cleanupReport.containersBefore} / ${cleanupReport.containersAfter}\n`;
    markdown += `- **Prozesse vor/nach Test:** ${cleanupReport.processesBefore} / ${cleanupReport.processesAfter}\n`;
    markdown += `- **Leak erkannt:** ${cleanupReport.leakDetected ? '⚠️ Ja' : '✅ Nein'}\n\n`;
    if (cleanupReport.details) {
      markdown += `**Details:** ${cleanupReport.details}\n\n`;
    }
  } else {
    markdown += `⚠️ **Cleanup-Report nicht gefunden**\n\n`;
  }
  
  markdown += `## Fazit\n\n`;
  markdown += generateConclusion(metrics);
  markdown += generateRecommendation(metrics);
  markdown += generateArtifactsList(testId, dirContents);
  
  return markdown;
}

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
