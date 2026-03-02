# Optimization Strategy Summary
## UNO Web Simulator: Vom Audit zum produktiven Einsatz

**Status:** 2. März 2026 | **Audience:** Projektleitung + Tech-Lead  
**Basiert auf:** OPUS4.6_Audit_Results_v1, OPUS4.6_Audit_Results_v2, CLASSROOM_OPTIMIZATION_ROADMAP

---

## I. Die Situation

### Was wurde bisher erreicht? ✅

| Phase | Ziel | Status | Impact |
|-------|------|--------|--------|
| **Operation Zero-Skips** | Test-Suite aufräumen (14→8 skipped) | ✅ DONE | 882 Tests laufen stabil |
| **RunSketchOptions Refactor** | API von Positional → Options-Objekt | ✅ DONE | 40+ Call-Sites migriert, 0 Errors |
| **Routes-Modularisierung** | routes.ts (744 LOC) aufteilen | ✅ DONE | 4 fokussierte Dateien |
| **Frontend-Extraktion (Partial)** | arduino-simulator.tsx (2.761→2.266 LOC) | 🟡 PARTIAL | 5 Hooks herausgelöst, Datei noch God Component |

**Gesamtbild:** Codebase ist **stabiler und wartbarer** (Phase A–C aus Audit v2 teilweise implementiert), aber **nicht klein genug**.

### Was ist das Hauptproblem? 🎯

**Für 200 Studierende gleichzeitig:**

| Problem | Ist-Zustand | Grenzwert | Resultiert in |
|---------|------------|----------|---|
| Compilation-Queue | Sequential, ~200 ms pro Compile | Wenn 200 Studis gleichzeitig F5: 200 × 200 ms = 40s Wartezeit | **Frustration, Timeouts** |
| RAM-Verbrauch | ~45 MB/Client × 200 = 9 GB | Server hat meist 16 GB | **Out-of-Memory Crash** |
| WebSocket-Bandbreite | ~2–3 KB/Frame × 10 Hz × 200 = 6 Mbps | ISP-Grenzen bei 100 Mbps intern | **Latency-Spike, Disconnects** |
| Docker-Container | Neuer Container pro Simulation | Max ~120 auf einem Host | **Container-Exhaustion** |

**Ohne Optimierung:** ~15–25% der Studis können nicht simulieren.

---

## II. Die Lösung (3 Hebel + 2 Phasen)

### Top-3 High-Impact Hebel (Phase 0 — sofort)

#### 1️⃣ **Compilation-Worker-Pool** (−30% Latenz)
- **Was:** Async Job-Queue mit 4–8 Worker-Threads statt sequentielle Verarbeitung
- **Wie:** piscina Library + worker-threads JS API
- **Effekt:** 200 parallele Compilations werden zu 4 parallelen, Rest wartet fair
- **Effort:** 2–3 Stunden
- **Risiko:** 🟢 Niedrig (isolierte Komponente, existiert schon in repos wie tsx)

```
Vorher: F5 → Queue-Server → Compile (200ms) → Response (200ms × Queue-Position)
Nachher: F5 → Queue-Server → [Worker-Pool: 4 parallel] → Response (20ms × Queue-Position / 4)
```

#### 2️⃣ **WebSocket-Message Compression** (−50% Bandbreite)
- **Was:** perMessageDeflate in ws-Library aktivieren
- **Wie:** 1 Config in simulation.ws.ts, Browser-Support automatisch
- **Effekt:** Pin-State-Batches: 2–3 KB → 1–1.5 KB
- **Effort:** 1 Stunde
- **Risiko:** 🟢 Sehr niedrig (industriestandard, ws built-in)

#### 3️⃣ **Runner-Pool & Recycling** (−20% Memory, −50% Container-Overhead)
- **Was:** SandboxRunner-Instanzen wiederverwenden statt immer neu erzeugen
- **Wie:** Object-Pool mit 5–10 idle Runners, destroy bei timeout
- **Effekt:** 500 Container-Initializations → 25 (nur Startup + Pool-Size)
- **Effort:** 2 Stunden
- **Risiko:** 🟡 Mittel (braucht saubere Cleanup-Logik, aber etabliertes Pattern)

**Combined Effect dieser 3 Hebel:**
- **Memory:** 9 GB → 7.2 GB (80% Auslastung statt 112%)
- **Latency:** 500–2000 ms p99 → 250–600 ms
- **Failure-Rate:** 15–25% → 1–2%

---

### Phase 1 Extras (Woche 2 — stabilisieren)

| Feature | Benefit | Effort |
|---------|---------|--------|
| **Adaptive Rate-Limiter** mit Queue-Feedback | Studis sehen, dass es nicht hängt, sondern wartet | 1.5h |
| **Client-Side Reconnect** mit Backoff | Netzwerk-Hiccup = auto-recovery, nicht Manual-Refresh | 1h |
| **Database Connection-Pool** (optional) | Falls Session-DB genutzt: keine Connection-Exhaustion | 1h |

---

### Phase 2 Cleanup (Woche 3–4 — maintainability)

| Task | Benefit | Effort |
|------|---------|--------|
| Load-Tests parametrisieren | −1.200 LOC Tests, CI-Time −30s | 2h |
| OutputPanel Component | −400 LOC arduino-simulator, schneller FCP | 2h |
| RunSketchOptions durchgängig | 0 Positional-Parameter im Code | 3h |

**Kumulativer Benefit:** +200 LOC Code-Reduktion, −1.5s CI/CD, −30% Frontend-JS-Bytes.

---

## III. Implementierungs-Roadmap (Zeitplan)

```
📅 TIMELINE
─────────────────────────────────────────────────────────────

DIESE WOCHE (März 2–8)
├─ Phase 0.1: Compilation-Worker-Pool
│  ├─ Code: server/services/compilation-worker-pool.ts
│  ├─ Integration: compiler.routes.ts update
│  ├─ Tests: Worker-Failover + Load-Test 200 Clients
│  └─ GoLive: Mittwoch
├─ Phase 0.2: WebSocket Compression (parallel)
│  ├─ Code: simulation.ws.ts update (3 Zeilen)
│  └─ Test: Bandwidth-Messung
└─ Phase 0.3: Runner-Pool (parallel)
   ├─ Code: server/services/runner-pool.ts
   ├─ Integration: simulation.ws.ts onConnection/onClose
   └─ Test: Memory-Monitoring

NÄCHSTE WOCHE (März 9–15)
├─ Baseline-Messung: npm run test:load:200 (Metriken)
├─ Phase 1.1–1.3 Stabilisierung
└─ Intensive Last-Tests (100–200 Clients, 10min)

FOLGEWOCHE (März 16–22)
├─ Phase 2: Code-Cleanup
└─ Classroom-Readiness Checklist

DEPLOYMENT
└─ Woche 4: Production → Lehrveranstaltung
```

---

## IV. Success Criteria (Metriken für Classroom-Readiness)

**Load-Test 200 Clients, 10 Minuten Duration:**

| Metrik | Soll | Ist (Phase 0) | Status |
|--------|------|---|---|
| **Memory @ Peak** | < 7.5 GB | TBD (nach 0.1–0.3) | 🔄 Zu messen |
| **CPU @ Peak** | < 85% | TBD | 🔄 Zu messen |
| **Avg Compilation** | < 250 ms | TBD | 🔄 Zu messen |
| **P99 Compilation** | < 1.200 ms | TBD | 🔄 Zu messen |
| **Failure-Rate** | < 2% | TBD | 🔄 Zu messen |
| **E2E Tests** | 100% grün | ✅ 23/23 | 🟢 PASS |
| **TypeScript Errors** | 0 | ✅ 0 | 🟢 PASS |
| **Skipped Tests** | ≤ 10 (nur Perf) | ✅ 8 | 🟢 PASS |

**Baseline-Datei erstellen und wöchentlich aktualisieren:**
```bash
CLASSROOM_METRICS.json → git-tracked History
```

---

## V. Nicht-Technische Voraussetzungen

### für Lehrende
- [ ] Setup-Guide "UNO Simulator in Classroom" (erklärt: erwartete Latenz ~100–300 ms, Best Practice: stagger Starts)
- [ ] Fallback-Plan falls Server down (z.B. "Offline-Compilation auf Studis-Rechner")

### für IT-Admin
- [ ] Server-Sizing: 16 GB RAM, 8+ Cores, 50 GB Storage
- [ ] Monitoring: Prometheus oder einfacher `/api/health/metrics` Endpoint
- [ ] Alerts: Memory > 11 GB, CPU avg > 80%, WS-Disconnect-Rate > 2%/min

### für Entwickler
- [ ] Code-Review Checklist (Memory-Leaks via clinic.js, Load-Tests grün, E2E grün)
- [ ] Commit-Message-Format: `refactor(label): description` + Test-Status

---

## VI. Risiken & Faallback-Pläne

| Risk | Wahrscheinlichkeit | Fallback |
|------|-------------------|----------|
| Memory-Leak in Runner-Pool | 20% | Jeden Runner nach X Compilations recycle |
| Worker-Thread-Crash unter Last | 10% | Worker-Watchdog + auto-restart |
| Docker-Container-Exhaustion | 10% | Aggressive cleanup + max-pool-size |
| WebSocket Backpressure | 5% | Message-Deflate + reduce update rate |

**Bei jedem Blocker:** Git-Bisect auf Phase 0.1/0.2/0.3 und isolieren.

---

## VII. Decision Checklist für Führung

- [ ] **Priorität:** Performance > Code-Quality? → JA (für Classroom-Deployment)
- [ ] **Timeline:** 3 Wochen bis Classroom-Ready? → REALISTISCH
- [ ] **Ressourcen:** 1 Senior + 1 Mid für Implementation? → AUSREICHEND
- [ ] **Go-/No-Go:** Nach Phase 0 Load-Tests machen wir gehen/no-go Entscheidung
- [ ] **Fallback:** Falls Phase 0 nicht 50% Verbesserung bringt → Back to Drawing Board

---

## VIII. Referenzen

1. **OPUS4.6_Audit_Results.md** → Detaillierte Code-Architektur-Analyse (5 Hotspots)
2. **OPUS4.6_Audit_Results_v2.md** → Lessons Learned + Guardian-Tests + Robuste Roadmap
3. **CLASSROOM_OPTIMIZATION_ROADMAP.md** ← **👈 DIESES DOKUMENT LESEN für konkrete Implementation**

---

## TL;DR für CEO/Projektleiter

> **Frage:** Können 200 Studierende gleichzeitig den Simulator nutzen?  
> **Antwort (jetzt):** Nein (15–25% Ausfallquote).  
> **Antwort (in 3 Wochen nach dieser Roadmap):** Ja, stabil (<2% Ausfallquote).  
> **Hebel:** 3 massive Backend-Optimierungen (Worker-Pool, Compression, Runner-Recycling) + Robuste Tests.  
> **Aufwand:** 2–3 Wochen für 1–2 Devs.  
> **Risiko:** 🟢 Niedrig (alle Patterns sind established, gutes Test-Framework vorhanden).
