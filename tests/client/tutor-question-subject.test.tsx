import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { questionSubject } from "@/components/simulator/tutor-learning-step";
import { TutorText } from "@/components/simulator/tutor-text";

describe("heading of the Tutor question", () => {
  it("names aspect and level for a question of the aspect flow", () => {
    expect(questionSubject({ topic: "Verzweigungen", topicId: "aspect-branching", indicatorId: "level-3" })).toBe("Verzweigungen · Stufe 3 von 4: Vorhersagen");
  });

  it("names the topic alone for a question of the Topic catalog", () => {
    expect(questionSubject({ topic: "Serielle Ausgabe", topicId: "variables-and-serial", indicatorId: "names-output" })).toBe("Serielle Ausgabe");
  });

  it("has no subject without learning context", () => {
    expect(questionSubject({ topic: "Vom Modell genannt" })).toBeUndefined();
    expect(questionSubject({})).toBeUndefined();
  });
});

describe("code in a Tutor text", () => {
  it("sets backticked parts apart as code", () => {
    const { container } = render(<p><TutorText text="Was liefert `analogRead(tempPin)` hier?" /></p>);
    const code = container.querySelector("code");
    expect(code).toHaveTextContent("analogRead(tempPin)");
    expect(code?.className).toContain("bg-muted");
    expect(container).toHaveTextContent("Was liefert analogRead(tempPin) hier?");
  });
});
