# Auftrag für Umsetzungs-Sessions: Browser-Emulation (Stand nach M2)

> **Nicht normativ.** Startauftrag für Claude-Sessions, die
> [browser-emulation-plan.md](browser-emulation-plan.md) selbstständig zu Ende
> umsetzen. Wird mit dem Plan gelöscht.
>
> **Start:** In einer frischen Session auf diesem Repository eingeben:
> „Lies docs/proposals/browser-emulation-agent-prompt.md und führe den Auftrag
> aus.“ Jede weitere Session startet mit demselben Satz und setzt beim Stand in
> der Statusdatei fort.
>
> **Voraussetzungen:** Docker läuft; `arduino-cli` 1.5.x mit
> `arduino:avr@1.8.8`; `SONAR_TOKEN` steht in `~/.zshrc.local` (nicht im
> Repository); die Session läuft in einem Berechtigungsmodus, der nicht jeden
> Befehl einzeln abfragt. **Mergen darf die Session nicht** (Abschnitt 3).

---

Du führst in diesem Repository (UnoSim) den Plan
`docs/proposals/browser-emulation-plan.md` zu Ende. M1 und M2 sind abgenommen; M0 wartet
nur noch auf die Annahme der ADRs durch die Maintainer. Arbeite selbstständig und so weit wie möglich. Unterbrich und
frag nur in den Ausnahmefällen aus Abschnitt 7.

## 1. Stand (23.10.2026)

- `feature/browser-emulation` ist grün (CI aller sechs Jobs). Uno `available`,
  Nano und Mega 2560 `preview`, ATtiny85 `planned` (`shared/boards.ts`). Lokal
  ist die Browser-Emulation Standard; im **Docker-Profil gibt es sie noch
  nicht**: dort läuft nur der Host-Mock, und `UNOSIM_RUNTIME_BACKENDS` mit
  `browser` bricht beim Start ab, solange es keine Compile-Sandbox gibt
  (`server/runtime-settings.ts`).
- Abnahmeberichte: [report-m1-acceptance.md](report-m1-acceptance.md),
  [report-m2-acceptance.md](report-m2-acceptance.md). Fortschritt je Paket:
  [browser-emulation-status.md](browser-emulation-status.md) (lies sie zuerst).
- Korpus: 93 Fälle (Uno 65, Nano 7, Mega 21) in
  `tests/fixtures/runtime-corpus/`; Regeln in dessen README und in
  [TESTING_STANDARDS.md](../TESTING_STANDARDS.md).

**Was noch fehlt (nach Plan-Abschnitt 5):**

| Paket | Stand | Hinweis |
|---|---|---|
| **P2.3** Toolchain für alle Boards (M) | **nie begonnen** (keine Statuszeile) | ATTinyCore 1.5.2 pinnen (Entscheidung aus [spike-p0-5-attiny85.md](spike-p0-5-attiny85.md)); lokal ist nur `arduino:avr` installiert |
| **P2.4** Compile-Sandbox (L) | **nie begonnen**, Voraussetzung für M4 und jede Beta | kein `Dockerfile.compile-sandbox`, kein `sandboxed-cli-runner.ts` |
| P6.1–P6.5 ATtiny85 (M3) | offen | `status: "planned"` |
| P7.1 Kapazität, P7.2 Deployment, P7.4 Host-Mock-Festschreibung | offen | |
| P7.3 Beta/RC und Unterricht | offen, **nur zum Teil Agentenarbeit** | Tags, Pilot-Instanz und Rückmeldungen macht ein Mensch |
| Reste | P0.1 (ADR 0009/0010 stehen auf `Proposed`; Annahme entscheiden die Maintainer), P1.14/M2 (Aufnahmen an echten Boards), P4.2/P4.3/P4.4/P4.6 (siehe Statusdatei) | |

**Bekannte Risiken, die du früh angehst:**

- **Bundle-Reserve 1,8 kB:** der initiale Ladepfad liegt bei 708,2 kB von
  710 kB (`npm run check:bundle`). Eine ATtiny-Boardansicht (P6.5) passt nicht
  mehr hinein. Löse das zuerst, bevorzugt durch Nachladen der Boardansichten
  (wie P3.9 für die Emulator-Laufzeit), nicht durch Anheben des Limits. Ein
  neues Limit nur mit Begründung im PR.
- **Zeitbudgets der Gates:** `test:unit` läuft in zwei Durchläufen
  (`test:unit:app` 75/120 s, `test:unit:emulator` 45/90 s), `test:docker` hat
  240 s. Der Emulator-Korpus wächst mit jedem Board. Lösche keine Tests, um ein
  Budget einzuhalten; teile oder begründe eine Anhebung mit Messwerten.
- **Portleiste des Serial Monitors** (Mega, #319): noch von keinem Menschen
  angesehen. Weise im Abnahmebericht darauf hin.

## 2. Reihenfolge

Beginne beim ersten Paket, das nicht erledigt ist. Empfohlen (wie der Plan,
M4 hängt nur an M1 und P2.4 und kann parallel zu M3 laufen):

1. **Bundle-Reserve schaffen** (klein), damit P6.5 möglich bleibt.
2. **P2.4 Compile-Sandbox** (in mehrere PRs teilen, jeder für sich grün), dann
   **P7.2 Deployment**, **P7.1 Kapazität**, **P7.4 Host-Mock-Festschreibung**.
   Danach ist die Voraussetzung für `v2.0.0-beta.N` technisch erfüllt (Plan
   9.2); den Tag und die Pilot-Instanz setzt ein Mensch (P7.3).
3. **P2.3, dann P6.1–P6.5 (ATtiny85)** und `report-m3-acceptance.md` nach dem
   Muster der Berichte M1/M2. P6.1 nimmt ATTinyCore in das Compile-Sandbox-Image
   auf; das geht erst nach P2.4.
4. Reste aus der Tabelle, soweit kein Mensch nötig ist.

Was eine Person braucht, überspringst du und trägst es als „wartet auf Mensch“
ein: Messungen auf Referenzgeräten (P0.3), Aufnahmen an echter Hardware
(Klasse `hardware` für Nano, Mega, ATtiny85), Erprobung im Unterricht (P7.3),
die Annahme der ADRs, das README von UnoSim-Examples (anderes Repository, nicht
anfassen), das Merge von PRs. Alles andere an diesen Paketen setzt du um.

## 3. Ablauf je Arbeitspaket

1. **Vorher:** `git status`, `gh pr list`, CI-Stand von `feature/browser-emulation`
   (`gh run list --branch feature/browser-emulation --limit 1`), `docker info`,
   `arduino-cli version`. Prüfe das Token, ohne es auszugeben:
   `curl -s -u "$SONAR_TOKEN:" http://localhost:9000/api/authentication/validate`
   muss `{"valid":true}` liefern (SonarQube läuft nur auf `127.0.0.1:9000`).
2. Arbeitsbranch vom aktuellen `origin/feature/browser-emulation`, benannt
   `<typ>/<paket>-<kurzname>` (z. B. `feat/p2-4-compile-sandbox`).
3. Umsetzen, was der Plan für das Paket nennt. Normative Dokumente (ADR, SSOT,
   ARCHITECTURE, SECURITY, USER_GUIDE, INSTALL_*, CAPACITY_MODEL,
   RELEASE_RUNBOOK) ändern sich im selben PR wie der Code (Plan-Abschnitt 8).
4. Lokal prüfen: `npm run check`, `npm run lint`, `npm run test:unit`,
   `npm run check:docs`, `npm run check:bundle`, `npx knip`. Berührt das Paket
   Toolchain, Docker oder UI, zusätzlich `npm run test:integration`,
   `npm run test:docker` bzw. `npm run test:e2e`. **Vor E2E den Client neu
   bauen** (`npm run build`); die E2E-Tests laufen gegen den gebauten Client.
5. Commits: Conventional Commits auf Englisch, Header höchstens 100 Zeichen, mit
   der Attribution, die deine Umgebung vorgibt. Korrekturen als **neue**
   Commits, nie Amend, nie Force-Push gepushter Commits, nie `--no-verify`.
6. Push: Der Pre-Push-Hook (Unit-Tests und Sonar-Scan) muss grün sein. Meldet
   Sonar einen neuen Befund, behebe ihn (MCP-Server `sonarqube` oder die API auf
   `localhost:9000`).
7. PR gegen `feature/browser-emulation`, nie gegen `main`. Beschreibung auf
   Deutsch: Paket-ID, was umgesetzt ist, Abnahmeevidenz (Befehle, Messwerte,
   Testnamen), Abweichungen vom Plan, geänderte bestehende Tests mit Begründung.
8. **CI abwarten, aber nicht mit Dauerschleifen:** `gh pr checks <nr>` einzeln
   abfragen, oder eine Hintergrundschleife (`until … ; do sleep 5; done` mit
   `run_in_background`). Rot: Ursache beheben, neuer Commit. **Wirklich lesen,
   was rot ist:** ein Zeitbudget, ein Flake und ein Testfehler brauchen
   verschiedene Antworten.
9. **Mergen darf nur ein Mensch.** Die Berechtigungsprüfung dieser Umgebung
   verweigert `gh pr merge` („Merge Without Review“). Umgehe das nicht. Melde
   den PR als „grün, bereit zum Merge“ mit dem fertigen Befehl
   (`gh pr merge <nr> --merge --delete-branch`) und arbeite an Paketen weiter,
   die nicht davon abhängen. Hängt das nächste Paket am offenen PR, baue es auf
   dessen Branch (gestapelt) und führe nach dem Merge `origin/feature/browser-emulation`
   in deinen Branch ein (Merge, kein Rebase, kein Force-Push).
10. **Nach dem Merge aufräumen:** auf `feature/browser-emulation` wechseln,
    `git merge --ff-only origin/feature/browser-emulation`, Arbeitsbranch lokal
    (`git branch -d`) und auf GitHub (`gh api -X DELETE repos/MoDevIO/UnoSim/git/refs/heads/<branch>`)
    löschen. Am Ende einer Session soll es lokal nur `main` und
    `feature/browser-emulation` geben, keinen Stash, keine unversionierten
    Dateien außer `UnoSim.code-workspace` (gehört dem Nutzer).
11. Pakete der Größe L in mehrere PRs teilen.

## 4. Spikes, ADRs, Abnahmeberichte

- Jeder Spike endet mit einem Bericht `docs/proposals/spike-<paket>-<thema>.md`,
  nicht normativ: Ziel, Aufbau, Messwerte, Kriterium erfüllt ja/nein, Folgen für
  die Entscheidungen E1–E16.
- ADR 0009 und 0010 bleiben `Proposed`; auf `Accepted` setzt sie ein Mensch.
- Jeder Meilenstein bekommt `report-<m>-acceptance.md` nach dem Muster von
  M1/M2: Kriterien mit Beleg, E2E-Szenarien, Messwerte (**selbst erhoben, mit
  Gerät und Befehl**), Funde, Restpunkte. Weise Ausnahmen offen aus; trage nichts
  als erledigt ein, was nur hergeleitet (`derived`) ist.

## 5. Regeln

- Nie: Push oder PR gegen `main`, Rebase von `feature/browser-emulation`,
  fremde Branches löschen, Sicherheitsvorgaben (Gateway, Sandbox, Limits)
  abschwächen, Secrets lesen oder ausgeben (auch nicht in Zusammenfassungen und
  Tool-Ausgaben: Werte maskieren). Neue Secrets gehören in `~/.zshrc.local`,
  nicht ins Repository.
- Bestehende Tests: Für die Änderungen in Plan-Abschnitt 7.3 gilt die Freigabe;
  begründe jede im PR. Imports und Typen nachziehen ist erlaubt. Jede andere
  Änderung, vor allem eine abgeschwächte oder entfernte Prüfung, ist ein
  Ausnahmefall. (Zuletzt freigegeben und begründet: sieben doppelte oder leere
  Docker-Tests, #317. Prüfe ein Gate auf Nutzen, bevor du ein Budget anhebst.)
- Visuelle Snapshots nie mit `--update-snapshots` erneuern.
- Weicht der Code vom Plan ab, entscheide im Sinne des Plans, dokumentiere es im
  PR unter „Abweichungen“ und korrigiere den Plan im selben PR.
- Neue Laufzeitabhängigkeit nur `avr8js`, exakt gepinnt. Neue
  Dev-Abhängigkeiten nur mit Begründung im PR.
- `config.ts` lehnt entfernte Variablen ab (`DOCKER_COMPILE_CONCURRENT` u. a.);
  der Dev-Starter und `run-tests.sh` räumen sie weg. Neue Ablehnungen gehören in
  alle drei Listen (ein Vertragstest prüft das).

## 6. Gelerntes aus den bisherigen Sessions

- **Stash nie vorschnell löschen.** `git stash show` zeigt unversionierte Dateien
  nicht; sie liegen im dritten Elternteil (`git show --stat <stash>^3`). Bevor
  du etwas verwirfst, liste alles, auch Ignoriertes. Lege Arbeit lieber auf
  einen Branch als in einen Stash. `git restore --source=<x> -- .` gleicht den
  ganzen Baum an und löscht alles andere: nur mit konkreten Pfaden.
- **Verweigert die Berechtigungsprüfung eine Aktion** (Merge, `git stash drop`,
  Löschen unversionierter Dateien, `git gc`), umgehe es nicht. Mach den Rest
  fertig und nenne dem Menschen den genauen Befehl samt Grund.
- **Terminal-Umgebung:** VS Code stellt Terminals mit ihrer alten Umgebung
  wieder her. Eine Variable, die in keiner Datei steht, kommt von dort. `ps`
  zeigt unter macOS die Umgebung fremder Prozesse nicht.
- **Vite:** Abhängigkeiten, die nur der Worker lädt (`new Worker(new URL(…))`),
  findet der Vorab-Scan nicht und die Seite lädt beim ersten Lauf neu. Neue
  solche Pakete kommen in `optimizeDeps.include`.
- **Docker-Gate:** Die Tests laufen seriell mit echten Containern (rund 125 s
  lokal) und schwanken auf dem Runner zwischen 120 und 185 s. Das Image
  `unosim-sandbox:latest` muss vorhanden sein.
- **E2E:** Läuft schon ein Server auf Port 3000, testest du ihn statt des
  Prüflings; offline-Mutationen von React Query brauchen `networkMode: "always"`.
  Weitere Fallen stehen im Memory dieses Projekts
  (`~/.claude/projects/-Users-to-Documents-TT-Web-UnoSim/memory/`).
- **Zahlen im Bericht selbst messen.** Leistung mit
  `npm run emulate -- <hex> --board <id> --ms 1500 --repeat 7`, Korpus aus den
  `case.json`, Bundle mit `npm run check:bundle`.

## 7. Ausnahmefälle: nur dann anhalten und fragen

1. Ein Spike verfehlt sein Kriterium, oder ein Ergebnis widerspricht einer
   Entscheidung E1–E16.
2. Eine Entscheidung ist nötig, die der Plan nicht trifft, und sie betrifft
   Sicherheit, die Verträge (REST, WebSocket, iframe), Datenschutz oder das
   Verhalten im Unterricht.
3. Eine Teständerung liegt außerhalb der Freigabe in Abschnitt 5.
4. Etwas braucht Hardware, Geräte, Zugangsdaten, Admin-Rechte im Repository,
   einen Merge oder kostet Geld.
5. Ein Gate bleibt nach drei ernsthaften Versuchen rot, und die Ursache liegt
   außerhalb des Pakets.
6. Für `v2.0.0` ist eine Entscheidung nötig (Versionsnummer, Tag, CHANGELOG,
   Zeitpunkt der Pilot-Instanz): das legt ein Mensch fest.

Bevor du fragst, bearbeite alle Pakete weiter, die davon nicht abhängen. Frag
knapp: Problem, Optionen, deine Empfehlung.

## 8. Ende der Session und Statusdatei

Wird der Kontext knapp oder ist alles Mögliche erledigt: Statusdatei
aktualisieren (Zeile je Paket, PR-Nummern statt „dieser PR“), per PR einbringen,
den Arbeitsstand aufräumen (Abschnitt 3, Punkt 10) und zusammenfassen: erledigte
Pakete mit PR-Links, offene PRs mit Merge-Befehlen, wartende und blockierte
Pakete, nächster Schritt. Die nächste Session startet mit diesem Auftrag.

Format der Statusdatei: siehe die vorhandene
[browser-emulation-status.md](browser-emulation-status.md). Status ist einer von
offen · in Arbeit · erledigt · wartet auf Mensch · blockiert.
