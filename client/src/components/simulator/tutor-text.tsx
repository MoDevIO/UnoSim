/** A teacher writes code terms in backticks. */
export function TutorText({ text }: { readonly text: string }) {
  let offset = 0;
  const parts = text.split("`").map((part, index) => {
    const start = offset;
    offset += part.length + 1;
    return index % 2 ? <code key={start}>{part}</code> : part;
  });
  return <>{parts}</>;
}

/** The provider as learners know it; an unknown one keeps its configured name. */
function providerName(provider: string): string {
  return provider === "kiconnect" ? "KI:connect.nrw" : provider;
}

/**
 * Who answers and what leaves the browser, before the first request (LearningQuestions 10.9): the provider,
 * the transmission of the current sketch, and that the access is the learner's personal one.
 */
export function TutorTransparencyNote({ provider, className = "" }: { readonly provider: string; readonly className?: string }) {
  const name = providerName(provider);
  return (
    <p className={`text-ui-sm text-muted-foreground ${className}`} data-testid="tutor-transparency">
      Der Tutor nutzt {name} mit deinem persönlichen API-Key. Für Fragen, Rückmeldungen und Hilfen wird dein
      aktueller Sketch an {name} übertragen.
    </p>
  );
}
