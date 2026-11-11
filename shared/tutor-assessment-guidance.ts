/**
 * The scales the Tutor rates and calibrates with. The system prompt uses these texts verbatim, and the
 * Tutor review export shows them as its legend, so both always describe the same rules. Browser-safe:
 * no server or crypto imports.
 */
export const TUTOR_RATING_RUBRIC = "Rubrik: 1 überwiegend falsch oder grundlegendes Missverständnis, 2 teilweise richtig mit wesentlicher Lücke, 3 Kernidee verstanden aber unvollständig, 4 korrekt mit kleiner Lücke, 5 fachlich korrekt, vollständig und nachvollziehbar. Eine kurze Antwort darf 5 erhalten, wenn die Frage bewusst eine eindeutige kurze Antwort verlangt.";

export const TUTOR_DIFFICULTY_GUIDANCE = "Kalibriere die Frage kognitiv: 1–10 = elementare Wiedererkennung oder direkter Fakt, 11–30 = einfache Anwendung, 31–50 = Verständnis und Zusammenhang, 51–70 = Transfer oder Analyse, 71–90 = anspruchsvolle Herleitung mehrerer Konzepte, 91–100 = sehr anspruchsvolle Synthese. Die Frage muss zum aktuellen Wert passen; Difficulty ist kein Prüfungsniveau.";

/**
 * Names the rule set above. The server reports it with each reviewed request; a legend from a client with a
 * different value is marked as not confirmed by the server. Raise it whenever a text above changes.
 */
export const TUTOR_ASSESSMENT_GUIDANCE_REVISION = "assessment-guidance-v1";
