import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TutorWorkspacePlaceholder } from "@/components/simulator/ExperimentalWorkspace";
import { useTutor } from "@/hooks/use-tutor";
import { getServerCapabilities } from "@/lib/server-capabilities";

function OfflineTutorPanel() {
  const tutor = useTutor(getServerCapabilities(false));
  return (
    <TutorWorkspacePlaceholder
      code="void setup() {} void loop() {}"
      tutor={tutor}
    />
  );
}

describe("Tutor offline controls", () => {
  it("keeps the key and question controls visible but disabled offline", () => {
    vi.spyOn(globalThis, "fetch");
    render(<OfflineTutorPanel />);

    expect(screen.getByTestId("tutor-api-key-action")).toBeDisabled();
    expect(screen.getByTestId("tutor-new-question-action")).toBeDisabled();
    expect(screen.getByText("Server connection required")).toBeInTheDocument();
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();
  });
});
