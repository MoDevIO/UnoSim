import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("uses the shared visual root for Radix tab triggers", async () => {
    const { Tabs, TabsList, TabsTrigger } = await import("@/components/ui/tabs");
    render(
      <Tabs defaultValue="editor">
        <TabBar asChild>
          <TabsList>
            <TabsTrigger value="editor">sketch.ino</TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
          </TabsList>
        </TabBar>
      </Tabs>,
    );

    const activeTab = screen.getByRole("tab", { name: "sketch.ino" });
    expect(activeTab).toHaveClass("app-tab", "ui-type-tab");
    expect(activeTab).toHaveAttribute("data-app-tab", "true");
    expect(activeTab).not.toHaveClass(
      "unified-tab-trigger",
      "shadow-sm",
      "rounded-sm",
      "focus-visible:ring-2",
    );
    expect(activeTab).toHaveClass(
      "focus-visible:outline-none",
      "focus-visible:ring-0",
      "focus-visible:ring-offset-0",
    );
    expect(activeTab).toHaveAttribute("data-state", "active");
  });

  it("preserves Radix keyboard navigation with badge content", async () => {
    const user = userEvent.setup();
    const { Tabs, TabsList, TabsTrigger } = await import("@/components/ui/tabs");
    render(
      <Tabs defaultValue="compiler">
        <TabsList>
          <TabsTrigger value="compiler">Compiler</TabsTrigger>
          <TabsTrigger value="debug">
            Debug <span aria-label="1 debug message">1</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    const compiler = screen.getByRole("tab", { name: "Compiler" });
    const debug = screen.getByRole("tab", { name: /Debug/ });
    compiler.focus();
    await user.keyboard("{ArrowRight}");

    expect(debug).toHaveFocus();
    expect(screen.getByLabelText("1 debug message")).toBeInTheDocument();
  });
});
