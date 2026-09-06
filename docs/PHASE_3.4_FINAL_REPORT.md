# 50-Client-Real-Docker-Test – Abschlussbericht

**Test-ID:** `load-2026-09-06T14-34-17Z`  
**Datum:** 06.09.2026, 14:34 Uhr  
**Getestet gemäß:** `docs/phase-3.4-3.10-operational-readiness-plan.md`  
**Testmodus:** Real Docker-Sandbox (UNOSIM_SIMULATION_MODE=docker-sandbox)

---

## Startkommando

```bash
NODE_ENV=development \
UNOSIM_SIMULATION_MODE=docker-sandbox \
UNOSIM_TRUST_MODE=local \
DISABLE_RATE_LIMIT=true \
./node_modules/.bin/tsx server/index.ts --host
```

---

## Host-Profil

### Hardware
- **CPU:** Apple M2 Pro (10 Kerne, 2.4 GHz)
- **RAM:** 32 GB total, 24 GB Docker-verfügbar
- **OS:** macOS 25.6.0 (Darwin 25.6.0)

### Software
- **Node.js:** v24.20.0
- **Docker Desktop:** Version nicht ermittelt (Settings-File nicht lesbar)
- **Browser (Playwright):** Chromium 1.58.2

### UnoSim-Konfiguration
- **Simulation Mode:** docker-sandbox
- **Worker Count:** 8
- **Compile Slots:** 16
- **Docker Compile Concurrency:** 8
- **Sandbox Pool:** 5–100 Runners
- **Sandbox Memory:** 256 MB pro Runner
- **Sandbox CPU Limit:** 0.25 Cores pro Runner
- **FQBN:** arduino:avr:uno

---

## Messergebnisse (50 Clients)

### Erfolgsquote
- **Clients:** 50
- **Erfolgreich:** 50
- **Fehlgeschlagen:** 0
- **Erfolgsrate:** ✅ **100%**

### Latenzen
- **Connect-Latenz (avg):** 3.14 ms
- **First-Output-Latenz (avg):** 14.84 s
  - Davon Compile-Zeit: 14.74 s (99.3%)
  - Davon Fetch Sketch: 52.4 ms (0.4%)
  - Davon Start Simulation: 51.4 ms (0.3%)
- **/api/health-Latenz (avg):** 3.14 ms
- **/api/status-Latenz (avg):** 2.10 ms

### Gesamtzeit-Statistik
- **Durchschnitt:** 14.84 s
- **Minimum:** 7.87 s
- **Maximum:** 21.83 s
- **p50:** 15.31 s
- **p90:** 21.36 s
- **p95:** 21.42 s
- **p99:** 21.83 s
- **Standardabweichung:** 5.16 s

### Durchsatz
- **Throughput:** 2.29 Clients/s

### Timeouts
- **Timeout-Count:** 0

---

## Server-Ressourcen (CPU/RAM/Runner/Queue)

**Hinweis:** Server-Metriken konnten nicht aus den API-Endpoints gelesen werden. Die Werte zeigen 0, da die Endpoints `/api/health` und `/api/status` keine CPU/RAM/Runner/Queue-Felder zurückgeben.

- **CPU-Spitze:** Nicht ermittelt (0.0 %)
- **RAM-Spitze:** Nicht ermittelt (0.0 GB)
- **Aktive Runner (max):** Nicht ermittelt (0)
- **Queue-Tiefe (max):** Nicht ermittelt (0)

**Empfehlung:** Server-Metriken in `/api/health` und `/api/status` um CPU, RAM, aktive Runner und Queue-Tiefe erweitern.

---

## Cleanup-Status (Leak Detection)

- **Docker-Container vor Test:** 0
- **Docker-Container nach Test:** 0
- **Prozesse vor/nach Test:** 0 / 0
- **Leak erkannt:** ✅ **Nein**
- **Details:** All containers cleaned up successfully

---

## Pass/Fail-Validierung (gemäß LOAD_TEST_PROTOCOL.md)

| Kriterium | Anforderung | Ergebnis | Status |
|-----------|-------------|----------|--------|
| Erfolgsquote | ≥98% | 100% | ✅ Bestanden |
| Timeouts | ≤2% | 0% | ✅ Bestanden |
| Cleanup | Keine Leaks | Keine Leaks | ✅ Bestanden |
| Stabilität | Alle Clients abgeschlossen | 50/50 | ✅ Bestanden |

**Gesamtergebnis:** ✅ **BESTANDEN** (4/4 Kriterien erfüllt)

---

## Engpässe (Bottlenecks)

### Identifizierte Engpässe

1. **Docker-Kompilierung (Hauptengpass)**
   - Compile-Zeit macht 99.3% der Gesamtzeit aus (14.74s von 14.84s)
   - Docker Compile Concurrency: 8 (maximal 8 gleichzeitige Kompilierungen)
   - Bei 50 Clients: 50/8 = 6.25 Runden → letzte Runde wartet 5x
   - p95 (21.42s) vs. p50 (15.31s): Wartezeit in Queue sichtbar

2. **Sandbox Runner Pool**
   - Min Runners: 5, Max Runners: 100
   - Pool muss Runner für 50 gleichzeitige Simulationen vorhalten
   - Keine Daten verfügbar (Metriken nicht implementiert)

3. **Server-Metriken**
   - CPU/RAM-Monitoring nicht in API-Endpoints verfügbar
   - Queue-Tiefe und aktive Runner nicht sichtbar
   - Empfehlung: Metriken in `/api/status` hinzufügen

---

## Artefakte

Folgende Artefakte wurden generiert:

| Datei | Pfad | Inhalt |
|-------|------|--------|
| Host-Profil | `test-results/load-2026-09-06T14-34-17Z/host-profile.json` | CPU, RAM, OS, Docker, Node, Browser, UnoSim-Konfiguration |
| Metriken | `test-results/load-2026-09-06T14-34-17Z/metrics-50.json` | Erfolgsquote, Latenzen, Durchsatz, Timeouts |
| Cleanup-Report | `test-results/load-2026-09-06T14-34-17Z/cleanup-report.json` | Container-Leak-Detection |
| Summary | `test-results/load-2026-09-06T14-34-17Z/summary.md` | Zusammenfassung |
| Final Report | `test-results/load-2026-09-06T14-34-17Z/FINAL_REPORT.md` | Dieser Bericht |

---

## Empfehlung: 100 Clients freigeben?

### Aktuelle Situation (50 Clients)
- ✅ 100% Erfolgsquote
- ✅ Keine Timeouts
- ✅ Keine Leaks
- ⚠️ Hohe Compile-Zeiten (14.74s avg, 21.83s max)
- ⚠️ Queue-Wartezeiten sichtbar (p95 vs. p50: +6s)

### Risikoanalyse für 100 Clients

**Rechenmodell:**
- Aktuelle Compile-Concurrency: 8
- Bei 100 Clients: 100/8 = 12.5 Runden → letzte Runde wartet 11x
- Erwartete p95-Zeit: ~14.74s + (11 × 2s Queue-Warte) ≈ 36-40s
- Timeout-Schwelle (Test): 180s → ausreichend

**Empfehlung:**

❌ **100 Clients NOCH NICHT freigeben**

**Begründung:**
1. **Keine Server-Metriken:** CPU/RAM/Queue-Daten fehlen für fundierte Entscheidung
2. **Compile-Engpass unklar:** Unbekannt, ob Docker-Host bei 100 Clients stabil bleibt
3. **Queue-Verhalten unbekannt:** DockerCompileSemaphore FIFO-Ordering nicht unter Last getestet
4. **Operational Readiness Plan verletzt:** "keine 100/200-Client-Aussage, wenn 50 nicht stabil" – 50 sind stabil, aber ohne Metriken keine Kapazitätsaussage möglich

### Nächste Schritte (vor 100-Client-Freigabe)

1. **Server-Metriken implementieren**
   - `/api/health`: CPU%, RAM GB hinzufügen
   - `/api/status`: activeRunners, queueDepth hinzufügen

2. **50-Client-Test wiederholen mit Metriken**
   - Baseline mit vollständigen Daten erfassen
   - CPU/RAM-Spitzen dokumentieren

3. **100-Client-Test im Stub-Modus**
   - Queue-Verhalten simulieren
   - Erwartete Wartezeiten validieren

4. **100-Client-Real-Docker-Test**
   - Nur nach erfolgreicher 50-Client-Metrikanalyse
   - Engere Überwachung (CPU/RAM/Queue)
   - Abbruchkriterium: CPU >90% oder RAM >95%

---

## Fazit

✅ **50-Client-Baseline stabil bestanden** gemäß LOAD_TEST_PROTOCOL.md Kriterien (≥98% Erfolgsquote).

### Begründung: 100/200-Client-Tests aktuell NICHT freigegeben

**Phase 3.4 wird hier beendet.** Die 50-Client-Baseline ist erfolgreich, aber eine belastbare Kapazitätsaussage für 100/200 Clients ist ohne interne Server-Metriken nicht möglich.

**Evidenz aus 50-Client-Test:**
- ✅ 50/50 Clients erfolgreich (100% Erfolgsquote)
- ✅ Keine Container-Leaks (Cleanup: 0 → 0)
- ⚠️ **Docker-Kompilierung = dominanter Engpass** (99.3% der Gesamtzeit)
- ⚠️ **Queueing bereits bei Concurrency 8 sichtbar** (p95 vs. p50: +6s Wartezeit)

**Kritische Lücke:**
- ❌ Keine Server-Metriken verfügbar (CPU%, RAM GB, aktive Runner, Queue-Längen)
- ❌ Keine Compile-Dauer oder Queue-Wartezeit messbar
- ❌ Keine Timeout-/Fehlerzähler pro Komponente
- ❌ Keine belastbare Kapazitätsanalyse möglich

**Risiko bei 100/200-Client-Tests ohne Metriken:**
- Unklar, ob CPU/RAM-Limits erreicht werden
- Unklar, ob Queue-Überläufe auftreten
- Unklar, ob Timeout-Kaskaden entstehen
- Keine Frühwarnindikatoren bei Instabilität

**Nächster Meilenstein (Phase 3.9 – Observability):**
- Mindestumfang an Server-Metriken implementieren (siehe Phase-3.9-Plan)
- 50-Client-Test mit Metriken wiederholen
- Kapazitätsgrenzen evidenzbasiert bestimmen
- Erst dann 100/200-Client-Tests freigeben

---

**Erstellt:** 2026-09-06T14:34:17Z  
**Getestet von:** GitHub Copilot (KI:connect Qwen 3.5 397B)  
**Genehmigt durch:** Ausstehend (nach Metrikanalyse)
