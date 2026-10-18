import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import { UniverseProvider, useUniverse } from "@/state/universe-context";
import { DetailPanel } from "@/components/ui/DetailPanel";

function SelectDemoArtist() {
  const { filterResult, select } = useUniverse();
  return (
    <button
      onClick={() => {
        const artist = filterResult.graph.nodes.find((n) => n.kind === "artist");
        if (artist) select(artist.id, false);
      }}
    >
      select-first-artist
    </button>
  );
}

describe("DetailPanel", () => {
  it("shows the overview with top artists when nothing is selected", async () => {
    render(
      <UniverseProvider>
        <DetailPanel isMobile={false} onClose={() => {}} />
      </UniverseProvider>,
    );
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(await screen.findByText("Top artists")).toBeTruthy();
    expect(screen.getByText("Top tracks")).toBeTruthy();
  });

  it("shows artist details after selection", async () => {
    render(
      <UniverseProvider>
        <SelectDemoArtist />
        <DetailPanel isMobile={false} onClose={() => {}} />
      </UniverseProvider>,
    );
    fireEvent.click(screen.getByText("select-first-artist"));
    const panel = screen.getByTestId("detail-panel");
    expect(panel.textContent).toMatch(/artist/i);
    expect(screen.getByTestId("detail-listening")).toBeTruthy();
    expect(screen.getByTestId("focus-camera")).toBeTruthy();
  });
});
