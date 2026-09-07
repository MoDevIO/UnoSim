# Release-Runbook

Status: current  
Version: 1.0.0  
Datum: 2026-09-06  
Grundlage: aktuelle Repository-Gates, `TESTING_STANDARDS.md` und `INSTALL_SERVER.md`.

---

## Zweck

Dieses Runbook definiert das verbindliche Release-Gate für UnoSim. Es stellt sicher, dass jedes Release reproduzierbar, sicher und qualitätsgesichert ausgeliefert wird.

---

## Geltungsbereich

- **Pflichtgates:** Müssen vor jedem Release erfolgreich durchlaufen werden.
- **Opt-in-Gates:** Heavy-/Load-/Skalierungstests, die bei Bedarf oder vor Major-Releases ausgeführt werden.
- **Security-Audit:** Verbindlicher Bestandteil jedes Release-Prozesses.

---

## Voraussetzungen

### Umgebungsvariablen

| Variable | Zweck | Beispiel |
| --- | --- | --- |
| `SONAR_TOKEN` | SonarQube-Analyse | `sqp_...` |
| `DOCKER_HOST` | Docker-Host (optional) | `unix:///Users/to/.docker/run/docker.sock` |
| `DOCKER_SANDBOX_IMAGE` | Sandbox-Image | `unosim-sandbox:latest` |
| `RUN_HEAVY_TESTS` | Heavy-Tests aktivieren | `1` oder `true` |

### Systemvoraussetzungen

- Node.js: `24.20.0` (oder gemäß `.nvmrc`)
- Docker: verfügbar für Docker-/E2E-Gates
- SonarQube: lokal (`http://localhost:9000`) oder remote

---

## Pflichtgates (vor jedem Release)

### 1. Typecheck

```bash
npm run check
```

**Erwartung:** Keine TypeScript-Fehler.  
**Abbruch bei:** Typecheck-Fehlern.

---

### 2. Unit-Tests

```bash
npm run test:unit
```

**Erwartung:** Alle Tests bestanden, keine Flakiness.  
**Abbruch bei:** Fehlgeschlagenen Tests oder Timeout-Überschreitungen.

---

### 3. Integrationstests

```bash
npm run test:integration
```

**Erwartung:** Toolchain-Integration funktioniert.  
**Abbruch bei:** Fehlgeschlagenen Integrationstests.

---

### 4. Docker-Tests (falls Docker verfügbar)

```bash
npm run test:docker
```

**Erwartung:** Sandbox-Isolation, Cleanup, Security-Contract.  
**Abbruch bei:** Docker-Test-Fehlern oder Cleanup-Problemen.

---

### 5. E2E-Tests

```bash
npm run test:e2e
```

**Erwartung:** Smoke-Tests und relevante Flows bestanden.  
**Abbruch bei:** Kritischen E2E-Fehlern.

---

### 6. Produktionsbuild

```bash
npm run build
```

**Erwartung:** Build erfolgreich, Bundle-Budgets eingehalten.  
**Abbruch bei:** Build-Fehlern oder Budget-Überschreitungen.

---

### 7. SonarQube-Analyse

```bash
npm run sonar
```

**Erwartung:** Quality Gate für Projekt `unosim` ist grün.  
**Abbruch bei:** Rotem Quality Gate oder nicht akzeptierten kritischen Issues.

---

### 8. Security-Audit

```bash
npm audit --omit=dev
```

**Erwartung:** Keine kritischen, nicht akzeptierten Security-Befunde.  
**Abbruch bei:** Kritischen Vulnerabilities ohne Akzeptanz/Workaround.

**Manuelle Prüfung:**

- Abhängigkeiten auf bekannte Sicherheitslücken prüfen (`npm audit`)
- Dockerfile.sandbox auf Security-Best-Practices prüfen
- Gateway-Konfiguration auf korrekte Secrets prüfen

---

### 9. Dokumentations-Check (falls Dokumentation geändert)

```bash
npm run check:docs
```

**Erwartung:** Alle Markdown-Dateien syntaktisch korrekt.  
**Abbruch bei:** Dokumentationsfehlern.

---

## Opt-in-Gates (Heavy-/Load-/Skalierungstests)

### Load-Tests (3.4)

```bash
npm run test:load:50
npm run test:load:100
npm run test:load:200
```

**Zweck:** Kapazitätsaussagen validieren.  
**Empfohlen:** Vor Major-Releases oder bei Skalierungsänderungen.

---

### Heavy-Tests

```bash
RUN_HEAVY_TESTS=1 ./run-tests.sh
```

**Zweck:** Produktionsszenarien mit realer Docker-Last.  
**Empfohlen:** Vor Major-Releases oder bei Sandbox-Änderungen.

---

### Skalierungstests

```bash
CLIENT_COUNT=40 npx playwright test --config=playwright.scalability.config.ts
```

**Zweck:** Viele gleichzeitige Clients simulieren.  
**Empfohlen:** Bei WebSocket-/Frontend-Änderungen.

---

## Vollständige Pipeline

### Standard-Pipeline (Pflichtgates)

```bash
./run-tests.sh
```

**Enthält:**

1. Pre-Flight-Checks (Node, Docker, Cleanup)
2. Static Analysis (`npm run check`)
3. Dead-Code Check (knip, nicht-blockierend)
4. Unit-Tests (`npm run test:unit`)
5. Integrationstests (`npm run test:integration`)
6. Docker-Tests (`npm run test:docker`)
7. E2E-Tests (`npm run test:e2e`)
8. Build (`npm run build`)
9. Bundle-Budget-Check
10. Zusammenfassung

---

### Vollständige Pipeline mit Heavy-Tests

```bash
RUN_HEAVY_TESTS=1 ./run-tests.sh
```

**Enthält zusätzlich:**

- Heavy-Tests (Sandbox-Isolation, reale Docker-Last)
- Ausführliche Cleanup-Prüfung

---

## Abbruchkriterien

Ein Release wird **nicht** freigegeben, wenn:

1. **Ein Pflichtgate fehlschlägt:**
   - Typecheck rot
   - Unit-/Integration-/Docker-/E2E-Tests fehlschlagen
   - Build fehlschlägt oder Budgets überschreitet
   - SonarQube Quality Gate rot
   - Security-Audit kritische, nicht akzeptierte Befunde meldet

2. **Reproduzierbarkeit nicht gegeben:**
   - Gates sind nicht lokal oder in CI reproduzierbar
   - Erforderliche Secrets sind undokumentiert
   - Docker-Sandbox-Image fehlt bei Docker-Gates

3. **Sicherheit kompromittiert:**
   - Sandbox-Isolation nicht nachweisbar
   - Gateway-Konfiguration unsicher (fehlende Secrets, öffentliche Bindings)
   - Penetrationstest-Befunde nicht akzeptiert

4. **Cleanup-Probleme:**
   - Container/Prozesse bleiben nach Tests zurück
   - Ressourcen-Leaks in `./check-leaks.sh`

5. **Dokumentation inkonsistent:**
   - Geänderte Dokumentation besteht `npm run check:docs` nicht
   - API-Dokumentation stimmt nicht mit Implementierung überein

---

## Artefakte

Folgende Artefakte müssen pro Release vorhanden sein:

| Artefakt | Ort | Zweck |
| --- | --- | --- |
| Testergebnisse | `test-results/` | Reproduzierbarkeit |
| Coverage-Bericht | `coverage/` | Testabdeckung |
| SonarQube-Report | SonarQube-Projekt `unosim` | Quality Gate |
| Build-Artefakte | `dist/` | Auslieferbares Paket |
| Security-Audit | `npm audit`-Output | Sicherheitsstatus |
| Release-Notes | `CHANGELOG.md` (falls vorhanden) | Änderungen dokumentieren |

---

## Verantwortlichkeiten

| Rolle | Verantwortung |
| --- | --- |
| **Release Manager** | Gate-Durchführung, Artefaktsammlung, Freigabeentscheidung |
| **DevOps** | Infrastruktur (Docker, SonarQube, CI), Pipeline-Wartung |
| **Security** | Security-Audit, Penetrationstests, Sandbox-Vertrag |
| **Entwicklung** | Behebung von Gate-Fehlern, Testabdeckung |

---

## Release-Freigabe

Ein Release gilt erst als freigegeben, wenn:

1. Alle Pflichtgates grün sind
2. Alle Artefakte vorliegen
3. Security-Audit abgeschlossen und akzeptiert
4. Release-Notes dokumentiert sind
5. Release Manager die Freigabe explizit erteilt hat

**Freigabe-Command (Beispiel):**

```bash
# Nach erfolgreicher Pipeline:
echo "Release vX.Y.Z freigegeben am $(date)" >> RELEASE_LOG.md
git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

---

## Notfallplan

### Bei Gate-Fehlschlag

1. **Fehler analysieren:** Logs in `run-tests_output.log` prüfen
2. **Lokal reproduzieren:** Fehler auf Entwicklermaschine nachstellen
3. **Beheben:** Fix implementieren und testen
4. **Retest:** Nur betroffene Gates wiederholen
5. **Dokumentieren:** Incident im Release-Log festhalten

### Bei Security-Vulnerability

1. **Severity prüfen:** `npm audit --audit-level=critical`
2. **Workaround identifizieren:** Falls Patch nicht sofort verfügbar
3. **Akzeptanz entscheiden:** Risiko vs. Betriebsnotwendigkeit
4. **Patch planen:** Fix in nächstem Patch-Release
5. **Dokumentieren:** Security-Incident reporten

---

## Historie

| Version | Datum | Änderungen |
| --- | --- | --- |
| 1.0.0 | 2026-09-06 | Initiale Version, Phase 3.7 implementiert |

---

## Referenzen

- `docs/TESTING_STANDARDS.md` – Teststandards
- `README_SECURITY.md` – Sicherheitskontrollen
- `INSTALL_SERVER.md` – Serverinstallation und Administration
- `package.json` – Scripts und Gates
- `run-tests.sh` – Vollständige Pipeline
