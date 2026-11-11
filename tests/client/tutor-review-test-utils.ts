/**
 * Test helper for the Tutor review export (LearningQuestions 12.7): the JSON record between the markers of
 * an export text. Throws when the JSON section or the closing marker is missing, i.e. the copy was cut off.
 */
export function parseTutorReviewExportJson(text: string): unknown {
  const start = text.indexOf("\n== JSON ==\n");
  const end = text.lastIndexOf("\n=== ENDE UnoSim Tutor-Review");
  if (start < 0 || end < 0 || end < start) throw new Error("Export is incomplete: JSON section or closing marker missing");
  return JSON.parse(text.slice(start + "\n== JSON ==\n".length, end));
}
