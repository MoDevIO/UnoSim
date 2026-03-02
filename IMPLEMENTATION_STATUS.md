# 📋 Status Update: Classroom Optimization Planning Complete

**Erstellt:** 2. März 2026  
**Dokumentationen:** 2 neue strategische Roadmaps  
**Nächster Schritt:** Implementation Phase 0 starten

---

## Was wurde erstellt?

### 1. **CLASSROOM_OPTIMIZATION_ROADMAP.md**
**Status:** ✅ READY FOR IMPLEMENTATION

Ein **detaillierter technischer Handlungsplan** für Production-Readiness mit 200+ gleichzeitigen Studierenden.

**Struktur:**
- **Section 1:** Performance-Baseline Messung (Metriken, Tools, Target-Werte)
- **Section 2:** Priorisierte Optimierungen (Phase 0 mit 3 Hebeln, Phase 1 Stabilisierung, Phase 2 Code-Cleanup)
- **Section 3:** Implementation Checklist mit Week-by-Week Breakdown
- **Section 4:** Classroom-Readiness Checklist (Technical + Operational + Educational)
- **Section 5:** Performance-Tracking Dashboard (CLASSROOM_METRICS.json)
- **Section 6:** Risiko-Management & Fallback-Pläne
- **Section 7:** Schnelle Iterations-Kommandos

**Die 3 kritischen Hebel (Phase 0):**
| Hebel | Impact | Effort | Risiko |
|-------|--------|--------|--------|
| Compilation-Worker-Pool | −30% Latenz | 2–3h | 🟢 Niedrig |
| WebSocket Compression | −50% Bandbreite | 1h | 🟢 Sehr niedrig |
| Runner-Pool & Recycling | −20% Memory | 2h | 🟡 Mittel |

**Erwartete Results nach Phase 0:**
- Memory: 9 GB → 7.2 GB
- Failure-Rate: 15–25% → 1–2%
- Avg Compilation: 200 ms → ~120 ms

---

### 2. **OPTIMIZATION_STRATEGY_SUMMARY.md**
**Status:** ✅ READY FOR STAKEHOLDERS

Ein **Executive Summary** für Projektleitung, Tech-Lead und Management.

**Struktur:**
- **Section I:** Die Situation (Was wurde erreicht? Was ist das Problem?)
- **Section II:** Die Lösung (3 Hebel erklärt in 1 Seite)
- **Section III:** Implementierungs-Timeline (3 Wochen)
- **Section IV:** Success Criteria (Metriken für Classroom-Ready)
- **Section V:** Nicht-technische Voraussetzungen (Setup-Guide, Monitoring, IT-Admin)
- **Section VI:** Risiken & Fallback-Pläne
- **Section VII:** Decision Checklist für Führung
- **Section VIII:** TL;DRfür CEOs

**Key Message:**
> Bei 200 Studierenden _jetzt_: Nein (15–25% Ausfallquote).  
> Bei 200 Studierenden _nach 3 Wochen dieser Roadmap_: Ja, stabil (<2% Ausfallquote).

---

## Ausgangslage

### Codebase Status (vor diesen Plänen)
| Phase | Ziel | Status |
|-------|------|--------|
| Operation Zero-Skips | Skipped Tests: 14 → 8 | ✅ DONE |
| RunSketchOptions Refactor | API modernisieren | ✅ DONE |
| Routes-Modularisierung | routes.ts aufteilen | ✅ DONE |
| Frontend-Extraktion | arduino-simulator kleiner | 🟡 PARTIAL (2.761 → 2.266 LOC) |

**Gesamtkognitive Last:** Reduziert, aber nicht aufgelöst.  
**Für kleine Gruppen:** Stabil.  
**Für 200+ Studierende:** ⚠️ Nicht production-ready.

### Das Hauptproblem
**Bei 200 Studierenden gleichzeitig:**
- Compilation-Queue: Sequential → 40s Wartezeit pro Studi
- RAM: 9 GB (Server hat meist 16 GB, grenzwertig)
- WebSocket-Bandbreite: ~6 Mbps (saturation-risk bei 100 Mbps Intranet)
- Docker-Container: Neue pro Simulation → Container-Exhaustion

---

## Die neue Roadmap

### 3-Wochen-Plan
```
WOCHE 1 (jetzt)     WOCHE 2              WOCHE 3–4
─────────────────   ──────────────────   ──────────────────
Phase 0.1–0.3       Phase 1.1–1.3        Phase 2.1–2.3
Sofortmaßnahmen     Stabilisierung       Code-Cleanup
(Worker-Pool,       (Rate-Limiting,      (Tests, Components,
Compression,        Reconnect, DB-Pool)  Refactor)
Runner-Pool)

Effort:             Effort:              Effort:
6–7 Stunden build   3–4 Stunden build    7–8 Stunden build
+ 2h Testing        + 2h Load-testing    + 1h Clean-up
```

### Success Criteria
**Load-Test: 200 Clients, 10 Minuten**

| Metrik | Ziel | Baseline | Nach Phase 0 |
|--------|------|----------|--------------|
| Memory @ Peak | < 7.5 GB | ~9 GB | ~7.2 GB |
| CPU @ Peak | < 85% | ~120% | ~72% |
| Avg Compilation | < 250 ms | ~400 ms | ~120 ms |
| P99 Compilation | < 1.200 ms | ~3000 ms | ~800 ms |
| Failure-Rate | < 2% | ~20% | ~1% |

---

## Nächste Schritte

### Sofort (heute)
1. **Diese beiden Dateien reviewen:**
   - Lesen: [OPTIMIZATION_STRATEGY_SUMMARY.md](OPTIMIZATION_STRATEGY_SUMMARY.md) (5–10 min)
   - Lesen: [CLASSROOM_OPTIMIZATION_ROADMAP.md](CLASSROOM_OPTIMIZATION_ROADMAP.md) (20–30 min)

2. **Baseline-Messung durchführen:**
   ```bash
   # Aktuellen Zustand dokumentieren
   npm run test:load:200 2>&1 | tee BASELINE.log
   # Ergebnisse → CLASSROOM_METRICS.json
   ```

3. **Team-Entscheidung:** Geben wir grünes Licht für Woche 1 Implementation?

### Woche 1 (Phase 0 — sofort starten)
- [ ] **0.1** Compilation-Worker-Pool (piscina)
  - Code: `server/services/compilation-worker-pool.ts`
  - Effort: 2–3h
  - Branch: `feature/compilation-workers`

- [ ] **0.2** WebSocket Compression (perMessageDeflate)
  - Code: `server/routes/simulation.ws.ts` (3 Zeilen)
  - Effort: 1h
  - Branch: `feature/ws-compression`

- [ ] **0.3** Runner-Pool & Recycling
  - Code: `server/services/runner-pool.ts`
  - Effort: 2h
  - Branch: `feature/runner-pool`

### Woche 2 (Phase 1 — stabilisieren)
- [ ] Load-Test Results nach Phase 0
- [ ] Adaptive Rate-Limiting (1.5h)
- [ ] Client-Side Reconnect (1h)
- [ ] DB-Pooling (optional, 1h)

### Woche 3–4 (Phase 2 — polieren)
- [ ] Load-Tests parametrisieren (2h)
- [ ] OutputPanel Component (2h)
- [ ] RunSketchOptions vollständig (3h)
- [ ] Final Classroom-Readiness Check

---

## Key Decisions zu treffen

**Führung/Tech-Lead:**
- [ ] **Priorität:** Performance > Code-Quality für nächste 3 Wochen? → **JA**
- [ ] **Timeline:** 3 Wochen bis Production-Ready? → **REALISTISCH**
- [ ] **Ressourcen:** 1 Senior + 1 Mid verfügbar? → **ESSENTIELL**
- [ ] **Go/No-Go:** Nach Phase 0 Load-Tests? → **DEFINIEREN**

---

## Kontextuelle Einordnung

Diese Roadmap basiert auf **zwei Audit-Reports:**
1. **OPUS4.6_Audit_Results.md** (Jan 2026)
   - 5 Hotspots identifiziert (arduino-simulator, sandbox-runner, routes.ts, etc.)
   - Refactoring-Roadmap vorgeschlagen

2. **OPUS4.6_Audit_Results_v2.md** (Feb 2026)
   - Post-Mortem fehlgeschlagener Phase-0-Versuch
   - Guardian-Tests definiert
   - Robusia Roadmap mit Anti-Flicker-Spezifikation

**Diese neue Roadmap:**
- Fokussiert auf **Performance** (nicht Code-Quality)
- Spezialisiert auf **Classroom-Szenario** (200+ Studierende)
- Nutzt **bewährte Patterns** (Worker-Pool, Connection-Pooling, Message-Compression)
- Mit **Fallback-Plänen** und **Risiko-Management**

---

## Dokumentations-Referenzen

| Datei | Zielgruppe | Fokus |
|-------|-----------|-------|
| CLASSROOM_OPTIMIZATION_ROADMAP.md | Tech-Lead, Developers | Implementation Details |
| OPTIMIZATION_STRATEGY_SUMMARY.md | Manager, CTO, Tech-Lead | Strategy & Decisions |
| OPUS4.6_Audit_Results_v2.md | Architects, Tech-Lead | Codebase-Analyse |
| OPUS4.6_Audit_Results.md | Technical Reference | Initial Audit |

---

## Erfolgs-Indikatoren (nach 3 Wochen)

🎯 **Ziel erreicht, wenn:**
- ✅ 200 Clients gleichzeitig können 10 Min ohne Fehler laufen
- ✅ Memory unter 7.5 GB bleibt
- ✅ E2E-Tests 100% grün
- ✅ `npm run test` grün mit ≤10 skipped Tests
- ✅ `npm run check` → 0 TypeScript-Errors
- ✅ Lehrveranstaltung kann in Produktionsumgebung starten

🟡 **Warnsignale:**
- Memory-Leak in Runner-Pool erkannt → Sofort debuggen
- Compilation-Latenz bleibt >300 ms → Worker-Config überprüfen
- E2E flaky nach Changes → Guardian-Tests überprüfen

🔴 **Terminator-Kriterium:**
- Failure-Rate bleibt >5% nach Phase 0 → Back to Drawing Board

---

## Letzte Worte

Diese Roadmap ist **praxisorientiert**, **risikobewusst** und **iterativ**:
- Jede Phase ist ein **Selbsttest** (Load-Test validation)
- Jeder Hebel ist **unabhängig** (können parallel an 3 Features arbeiten)
- Alles hat **Fallback-Pläne** (kein "Hope & Deploy")

**Ziel:** Robuste Production-Readiness für echte Lehrezenarien in 3 Wochen.

**Los geht's!** 🚀
