import { stripComments } from "@shared/parser-patterns";

/**
 * A question with a silent reference points at something it never names: "der betrachteten Variable",
 * "dieser Wert". A learner cannot tell which variable or value is meant (Tutor quality analysis M1). The
 * reference is anchored when the question names a declared identifier of the sketch, quotes code, or asks
 * the learner to pick the element first.
 */

/** "der betrachteten Variable", "die genannte Stelle": a participle that points at an earlier mention. */
const POINTING_PARTICIPLE = /\b(?:betrachtete|genannte|erwähnte|besagte|obige)[nrms]?\s+[A-ZÄÖÜ]/;
/** "diese Variable", "dieser Wert": a demonstrative with a sketch element. */
const DEMONSTRATIVE_ELEMENT = /\bdiese[rsmn]?\s+(?:Variablen?|Werte?s?|Konstanten?|Funktion|Schleife|Bedingung|Stelle|Zeile|Arrays?|Pins?|Datentyps?|Ausdrucks?|Anweisung|Aufrufs?)\b/i;
/** "der in der Variable gespeicherte Wert": one definite variable, as if the sketch had only one. */
const DEFINITE_VARIABLE = /\b(?:der|die)\s+Variable\b/;
/** "Wähle eine Variable …", "Nenne einen Aufruf …": the learner names the element, so a later reference is clear. */
const LEARNER_SELECTION = /\b(?:Wähle|Nenne|Suche|Finde|Nimm)\b[^?]{0,200}?\beine[nrms]?\b/;
const QUOTED_CODE = /`[^`\n]{1,200}`/;

const DECLARING_TYPES = "bool|boolean|char|byte|int|long|short|float|double|String|word|size_t|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|void|struct|class|enum";
const DECLARATION = new RegExp(String.raw`\b(?:${DECLARING_TYPES})\b[\s*&]{1,8}([A-Za-z_]\w{0,63})`, "g");
const DEFINE = /#[ \t]{0,8}define[ \t]{1,8}([A-Za-z_]\w{0,63})/g;
const WORD = /[A-Za-z_]\w*/g;

/** Names every sketch has, and words a German question uses anyway: none of them identifies an element. */
const NOT_AN_ANCHOR = new Set([
  ...DECLARING_TYPES.split("|"), "unsigned", "signed", "const", "static", "volatile", "setup", "loop",
  "an", "aus", "ein", "in", "im", "um", "zu", "es", "er", "so", "da", "ob", "wo", "am", "ab", "bei", "mit", "und", "der", "die", "das",
  "den", "dem", "des", "ist", "hat", "wie", "was", "wer", "nach", "vor", "auf", "von", "zum", "zur", "als", "nur", "auch", "oder",
  "wenn", "dann", "noch", "sich", "wird", "sind", "eine", "einen", "einer", "eines", "einem", "nicht", "mehr", "kann",
]);

/** The names a sketch declares itself: variables, constants, functions, parameters, types and macros. */
export function declaredSketchNames(code: string): ReadonlySet<string> {
  const clean = stripComments(code);
  const names = new Set<string>();
  for (const pattern of [DECLARATION, DEFINE]) {
    for (const match of clean.matchAll(pattern)) {
      const name = match[1];
      if (name && !NOT_AN_ANCHOR.has(name)) names.add(name);
    }
  }
  return names;
}

function hasSilentReference(question: string): boolean {
  return POINTING_PARTICIPLE.test(question) || DEMONSTRATIVE_ELEMENT.test(question) || DEFINITE_VARIABLE.test(question);
}

function namesSketchElement(question: string, code: string): boolean {
  const names = declaredSketchNames(code);
  if (names.size === 0) return false;
  return (question.match(WORD) ?? []).some((word) => names.has(word));
}

/**
 * Whether the question refers to a sketch element without saying which. Without `code` (a catalog text
 * that must hold for every sketch) only quoted code and a learner selection anchor the reference.
 */
export function hasUnanchoredReference(question: string, code?: string): boolean {
  if (!hasSilentReference(question)) return false;
  if (QUOTED_CODE.test(question) || LEARNER_SELECTION.test(question)) return false;
  return code === undefined || !namesSketchElement(question, code);
}
