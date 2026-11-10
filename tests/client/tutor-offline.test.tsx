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
  it("keeps the setup action visible but disabled offline", async () => {
    vi.spyOn(globalThis, "fetch");
    render(<OfflineTutorPanel />);

    expect(await screen.findByTestId("tutor-setup-action")).toBeDisabled();
    expect(screen.queryByTestId("tutor-start-question")).not.toBeInTheDocument();
    expect(screen.getByText("Serververbindung erforderlich")).toBeInTheDocument();
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();
  });
});
