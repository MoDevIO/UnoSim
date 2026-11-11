import { memo, useLayoutEffect } from "react";
import { useTutor, type TutorPanelState } from "@/hooks/use-tutor";
import type { ServerCapabilities } from "@/lib/server-capabilities";

/**
 * Owns the Tutor state for the whole page and renders nothing. The layout loads it lazily, so the
 * Tutor's logic and request schemas stay off the initial load path; the state still lives at page
 * level and survives the mobile Tutor panel being closed and reopened.
 */
export const TutorStateHost = memo(function TutorStateHost({
  capabilities,
  onChange,
}: {
  readonly capabilities: ServerCapabilities;
  readonly onChange: (state: TutorPanelState) => void;
}) {
  const tutor = useTutor(capabilities);
  useLayoutEffect(() => {
    onChange(tutor);
  }, [tutor, onChange]);
  return null;
});
