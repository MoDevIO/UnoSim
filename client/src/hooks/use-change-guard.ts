import { useCallback, useEffect, useRef } from "react";

/**
 * Guards asynchronous work against changes made while it ran: `mark()` returns
 * a check that stays true only while none of `values` changed its identity.
 */
export function useChangeGuard(values: readonly unknown[]): () => () => boolean {
  const revision = useRef(0);
  const previous = useRef(values);

  useEffect(() => {
    if (values.length === previous.current.length && values.every((value, index) => Object.is(value, previous.current[index]))) return;
    previous.current = values;
    revision.current++;
  });

  return useCallback(() => {
    const start = revision.current;
    return () => revision.current === start;
  }, []);
}
