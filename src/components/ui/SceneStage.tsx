"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useUniverse } from "@/state/universe-context";
import { SceneErrorBoundary } from "@/components/universe/SceneErrorBoundary";
import { BTN_PRIMARY, PANEL } from "./panel";

const UniverseScene = dynamic(
  () => import("@/components/universe/UniverseScene"),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className={`${PANEL} px-4 py-2 text-sm text-slate-300`}>
          Loading universe…
        </p>
      </div>
    ),
  },
);

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    return false;
  }
}

export function SceneStage({ onOpenImport }: { onOpenImport: () => void }) {
  const { boot, filterResult } = useUniverse();
  // Lazy init: runs on the client during hydration; document is undefined on the server.
  const [webgl] = useState<boolean | null>(() =>
    typeof document === "undefined" ? null : supportsWebGL(),
  );
  const [sceneFailed, setSceneFailed] = useState(false);

  if (sceneFailed || webgl === false) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center p-6"
        data-testid="webgl-fallback"
      >
        <div className={`${PANEL} max-w-md p-5 text-center`}>
          <h2 className="mb-2 text-base font-semibold text-slate-100">
            3D view unavailable
          </h2>
          <p className="text-sm leading-relaxed text-slate-400">
            This browser or device could not start WebGL, so the galaxy cannot
            render. Your data is unaffected — try another browser, or enable
            hardware acceleration in settings.
          </p>
        </div>
      </div>
    );
  }

  if (webgl === null || boot.loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className={`${PANEL} px-4 py-2 text-sm text-slate-300`}>
          Loading universe…
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <SceneErrorBoundary onError={() => setSceneFailed(true)}>
        <UniverseScene />
      </SceneErrorBoundary>
      {filterResult.graph.nodes.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
          data-testid="empty-state"
        >
          <div className={`${PANEL} max-w-sm p-5 text-center`}>
            <h2 className="mb-2 text-base font-semibold text-slate-100">
              No entities in view
            </h2>
            <p className="text-sm leading-relaxed text-slate-400">
              Every node is hidden by the current filters or timeframe. Loosen
              the filters or switch the timeframe. To see your real listening
              history, import Spotify Extended Streaming History (JSON or ZIP) —
              request it from Spotify Privacy settings if you haven&apos;t already
              (downloads can take days).
            </p>
            <button
              type="button"
              className={`${BTN_PRIMARY} mt-4`}
              onClick={onOpenImport}
            >
              Import history
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
