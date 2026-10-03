# Tutor Course Content – Post-Mastery-Kapazität des Katalogs

Status: Befund und Authoring-Empfehlungen, **nicht normativ**. Grundlage ist
`ttbombadil/unosim-examples` @ `0087494`, deterministisch nachgestellt mit dem
UnoSim-Planner, Matcher und der Repository-Strategie `precision-policy`. Keine
Provider-Calls.

## Befund

Seit dem Content-Fix (UnoSim-Examples#4) und dem katalogweiten Authoring-Gate
(#149) ist kein aktiviertes Topic mehr vom ersten Turn an unlösbar (0/36).
`content-exhausted` tritt jetzt **nach** Topic-Mastery auf, weil der Katalog
wenig Post-Mastery-Content hat:

| Aktivierungen | Topic | LEARN-Fragen bis Mastery | danach übrig | DEEPEN-Kriterium (Default: 2 Proben ≥ 4, davon 1 Transfer) |
| ---: | --- | ---: | --- | --- |
| 17 | `variables-and-serial` (Sketch mit `int`) | 2 | application, transfer | erreichbar |
| 16 | `variables-and-serial` (Serial ohne `int`) | 1 | transfer | **nicht erreichbar** |
| 3 | `long-values` | 2 | prediction, transfer | erreichbar |

Der Übergangsturn nach LEARN stellt noch eine Frage im LEARN-Plan (R-PH-1),
die damit ebenfalls Post-Mastery-Kapazität verbraucht. Im durchgespielten
Dialog erreichen die 17 `int`-Beispiele nach vier Turns EXPAND und sind dann
erschöpft. Die 16 Serial-only-Beispiele bleiben ab dem dritten Turn in DEEPEN
blockiert.

Beide Topics sind Schema v1: keine `extensions`, keine `deepening`-Konfiguration.
EXPAND bietet daher keine Erweiterung an und endet sofort in
`content-exhausted`. Das entspricht R-EXP-2, weil keine Transferfrage und
keine Erweiterung übrig ist.

## Generalisierbare Empfehlungen

1. **Kapazität je Aktivierung.** Für jedes Example, das ein Topic aktiviert,
   sollten nach einem minimalen Mastery-Pfad mindestens
   `deepening.minimumSuccessfulProbes + 1` applicable Nicht-Recall-Fragen übrig
   sein, darunter jede geforderte Frageart (Default `transfer`). Das „+ 1“
   deckt den Übergangsturn.
2. **Fragen an der tatsächlichen Applicability ausrichten.** Ein Konzept, das
   auf vielen Sketches das einzige abfragbare ist (`serial-output` auf
   Serial-only-Sketches), braucht genug eigene Fragen für LEARN **und** DEEPEN.
3. **EXPAND nur mit Erweiterungen.** Ohne Topic v2 `extensions` gibt es keinen
   EXPAND-Inhalt. Ein Erweiterungsziel muss im Bundle existieren und per
   Matcher aktivierbar sein.
4. **Prämissen prüfen.** Transfer- und Vorhersagefragen dürfen nur bei Fakten
   applicable sein, die ihre Prämisse decken (R-AUT-2). Beispiel aus der
   Anchor-Fixture: „Veränderung von counter“ ist auf einem Sketch ohne
   Veränderung falsch.

## Benötigte Autorenentscheidungen

- Welche zusätzlichen Fragen `serial-output` (Serial ohne `int`) für DEEPEN
  erhält, mindestens eine weitere Nicht-Recall-Frage neben `transfer`.
- Ob und wohin Topics erweitert werden (Schema v2, Zieltopics im Bundle).
- Ob das katalogweite Gate (#149) zusätzlich die DEEPEN-Kapazität je
  Aktivierung prüfen soll. Auf dem heutigen Content würde das 16 Aktivierungen
  melden; für erwartete Topics der Quality-Cases geschieht es schon heute.
