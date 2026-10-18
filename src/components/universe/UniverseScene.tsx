"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useUniverse } from "@/state/universe-context";
import Starfield from "./Starfield";
import GenreRegions from "./GenreRegions";
import { NodeField } from "./NodeField";
import { ConnectionLines } from "./ConnectionLines";
import SceneLabels from "./SceneLabels";
import CameraRig from "./CameraRig";
import { BACKGROUND, CAMERA_FAR, CAMERA_HOME } from "./scene-config";

function usePrefersReducedMotion(): boolean {
  // Lazy init during the client hydration render; server render falls back to false.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

/** Breadth-first highlight set: the selected node plus two hops of relation. */
function relatedSet(
  neighbors: Map<string, string[]>,
  selectionId: string | null,
): Set<string> {
  const result = new Set<string>();
  if (!selectionId) return result;
  result.add(selectionId);
  const first = neighbors.get(selectionId) ?? [];
  for (const id of first) {
    if (result.has(id)) continue;
    result.add(id);
    for (const second of neighbors.get(id) ?? []) {
      if (!result.has(second)) result.add(second);
    }
  }
  return result;
}

/**
 * The full interactive universe: composed inside a single R3F Canvas.
 * Everything continuous (drift, pulse, camera easing) runs in the frame loop
 * through refs; React state only changes on discrete events (selection, hover,
 * filter, zoom band flips).
 */
export default function UniverseScene() {
  const {
    filterResult,
    selectionId,
    hoverId,
    select,
    setHoverId,
    cameraCommand,
  } = useUniverse();
  const reducedMotion = usePrefersReducedMotion();
  const [zoomLevel, setZoomLevel] = useState<"far" | "near">("far");
  const [dpr, setDpr] = useState<[number, number]>([1, 1.6]);

  const { graph: filteredGraph, visibleIds } = filterResult;

  const genreNodes = useMemo(
    () => filteredGraph.nodes.filter((n) => n.kind === "genre"),
    [filteredGraph],
  );

  const relatedIds = useMemo(
    () => relatedSet(filteredGraph.neighbors, selectionId),
    [filteredGraph, selectionId],
  );

  const selectedNode = selectionId
    ? filteredGraph.nodeById.get(selectionId) ?? null
    : null;
  const hoverNode = hoverId ? filteredGraph.nodeById.get(hoverId) ?? null : null;

  const handleZoomLevelChange = useCallback((level: "far" | "near") => {
    setZoomLevel(level);
  }, []);

  const handleSelect = useCallback(
    (id: string) => select(id, true),
    [select],
  );

  const handleHover = useCallback(
    (id: string | null) => setHoverId(id),
    [setHoverId],
  );

  useEffect(() => {
    // A selected node that filters disappear should release the camera target.
    if (selectionId && !filteredGraph.nodeById.has(selectionId)) {
      select(null, false);
    }
  }, [selectionId, filteredGraph, select]);

  return (
    <Canvas
      dpr={dpr}
      camera={{ position: CAMERA_HOME.toArray(), fov: 55, near: 0.1, far: CAMERA_FAR }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(BACKGROUND, 1);
      }}
      onPointerMissed={() => select(null, false)}
      data-testid="universe-canvas"
    >
      <PerformanceMonitor
        onIncline={() => setDpr([1.2, 1.75])}
        onDecline={() => setDpr([0.8, 1.1])}
      />
      <ambientLight intensity={1.05} />
      <directionalLight position={[60, 80, 40]} intensity={1.35} color="#c8d4ff" />
      <directionalLight position={[-70, -40, -60]} intensity={0.5} color="#7c5cff" />

      <Starfield reducedMotion={reducedMotion} />

      <GenreRegions
        genreNodes={genreNodes}
        selectionId={selectionId}
        hoverId={hoverId}
        reducedMotion={reducedMotion}
      />

      <NodeField
        kind="artist"
        nodes={filteredGraph.nodes}
        visibleIds={visibleIds}
        selectionId={selectionId}
        hoverId={hoverId}
        relatedIds={relatedIds}
        onSelect={handleSelect}
        onHover={handleHover}
        reducedMotion={reducedMotion}
      />
      <NodeField
        kind="album"
        nodes={filteredGraph.nodes}
        visibleIds={visibleIds}
        selectionId={selectionId}
        hoverId={hoverId}
        relatedIds={relatedIds}
        onSelect={handleSelect}
        onHover={handleHover}
        reducedMotion={reducedMotion}
      />
      <NodeField
        kind="track"
        nodes={filteredGraph.nodes}
        visibleIds={visibleIds}
        selectionId={selectionId}
        hoverId={hoverId}
        relatedIds={relatedIds}
        onSelect={handleSelect}
        onHover={handleHover}
        reducedMotion={reducedMotion}
      />

      <ConnectionLines
        edges={filteredGraph.edges}
        nodesById={filteredGraph.nodeById}
        visibleIds={visibleIds}
        selectionId={selectionId}
        zoomLevel={zoomLevel}
      />

      <SceneLabels
        genreNodes={genreNodes}
        hoverNode={hoverNode}
        selectedNode={selectedNode}
        zoomLevel={zoomLevel}
        visibleIds={visibleIds}
      />

      <CameraRig
        cameraCommand={cameraCommand}
        nodesById={filteredGraph.nodeById}
        reducedMotion={reducedMotion}
        onZoomLevelChange={handleZoomLevelChange}
      />
    </Canvas>
  );
}
