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
