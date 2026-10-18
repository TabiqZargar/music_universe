import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HeaderBar } from "@/components/ui/HeaderBar";
import { UniverseProvider } from "@/state/universe-context";

function renderHeader(props?: Partial<React.ComponentProps<typeof HeaderBar>>) {
  return render(
    <UniverseProvider>
      <HeaderBar onOpenImport={() => {}} onOpenConnection={() => {}} {...props} />
    </UniverseProvider>,
  );
}

describe("HeaderBar", () => {
  it("renders the wordmark and demo universe title", async () => {
    renderHeader();
    expect(screen.getByText("Music Universe")).toBeTruthy();
    expect(await screen.findByText("Demo Universe")).toBeTruthy();
    expect(screen.getByTestId("source-badge").textContent).toMatch(/demo/i);
    expect(screen.getByTestId("open-import")).toBeTruthy();
    expect(screen.getByTestId("open-connection").textContent).toBe("Connect Spotify");
  });
});
