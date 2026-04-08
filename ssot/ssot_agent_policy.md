# Agent Runtime-Evidence & Governance Policy (REV 2026.1)

## 1. Grundprinzipien der Verifizierung
1.1 Getrennte Ebenen prüfen: Code, Runtime/UI-Ebene, Tests.
1.2 Keine Selbstbehauptungen: Aussagen ohne Beweis sind ungültig.
1.3 Verpflichtende Evidenz: Vorher-Nachher-States, DOM-Attribute, Style-Werte.

## 2. Governance & Workflow (Git & Tests)
2.1 Git-Flow Mandat: 
- Jede Arbeit im Working-Branch (feature/*, refactor/*, fix/*).
- Pfad: Working-Branch -> dev -> main.
- Vor Merge in dev: dev in Working-Branch ziehen und Konflikte lokal lösen.

2.2 Test-Integrität:

- Kompletter lokaler Test-Lauf (unit, integration, e2e) vor jedem Push.
- **`git push --no-verify` ist VERBOTEN** – der pre-push Hook ist ein nicht umgehbares Security Gate.
- Bestehende Tests sind unantastbare Spezifikationen (Immutability).
- Test-Anpassungen erfordern technische Begründung und explizite User-Genehmigung.

2.3 Commit-Etikette & Constraints:
- Längenbeschränkung: Commit-Header dürfen maximal 100 Zeichen lang sein (wegen commitlint/husky).
- Format: Nutze Conventional Commits (z. B. `feat(scope): ...` oder `refactor(scope): ...`).
- Atomarität: Erst committen, dann Branchen wechseln. Ein fehlgeschlagener Commit-Hook muss sofort korrigiert werden; kein Branch-Wechsel mit "dirty" State ohne explizites Stashing.

## 3. Vorgehensweise für den Agenten (Pro Feature)
1. Ist-Zustand (State/DOM/Props) vor Änderung.
2. Trigger (User-Klick/Event).
3. Soll-Zustand (Final-State/DOM).
4. Evidenz-Check (exakte Werte: height, classes, aria-attributes).
5. User-Priorität: Manuelle Eingaben haben Vorrang vor Automatik.

## 4. Checkliste für jeden Agenten-Durchlauf
- [ ] Working-Branch genutzt?
- [ ] State/DOM-Bindung korrekt (Sichtbarkeit/Klassen)?
- [ ] Alle Tests lokal ohne unautorisierte Änderungen bestanden?
- [ ] User-Intent gewahrt?
- [ ] Numerische/DOM Evidenzen dokumentiert?

## 5. Spezifische Anweisungen für UI-Elemente (Beispielmenü)
- Exklusivität: Maximal ein Element markiert.
- Auto-Collapse: Single-Accordion-Prinzip (beim Öffnen eines Knotens schließen andere auf derselben Ebene).
- Feedback: Jede Interaktion erzeugt unmittelbare DOM-Evidenz.