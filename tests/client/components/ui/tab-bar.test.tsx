import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabBar } from "@/components/ui/tab-bar";

describe("TabBar", () => {
  it("provides the shared tab-strip class", () => {
    render(<TabBar data-testid="tabs">Editor</TabBar>);
    expect(screen.getByTestId("tabs")).toHaveClass("unified-tab-bar");
  });

  it("can apply the shared contract to a semantic child", () => {
    render(
      <TabBar asChild>
        <ul data-testid="tabs" role="tablist">
          <li>Messages</li>
        </ul>
      </TabBar>,
    );
    expect(screen.getByRole("tablist")).toHaveClass("unified-tab-bar");
  });
});
