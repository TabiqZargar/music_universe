"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import type { GraphEdge, GraphNode } from "@/types/domain";
import { EDGE_COLOR, EDGE_HIGHLIGHT_COLOR } from "./scene-config";

export interface ConnectionLinesProps {
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  visibleIds: Set<string>;
  selectionId: string | null;
  /** "far" hides low-priority links (LOD); "near" shows everything. */
  zoomLevel: "far" | "near";
}

function buildPositions(
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
): Float32Array {
  const positions = new Float32Array(edges.length * 6);
  edges.forEach((edge, i) => {
    const a = nodesById.get(edge.from);
    const b = nodesById.get(edge.to);
    if (!a || !b) return;
    positions.set(a.position, i * 6);
    positions.set(b.position, i * 6 + 3);
  });
  return positions;
}

/**
 * All visible relationships in one LineSegments draw call, plus a second
 * brighter pass for the selected node's incident edges. Low-priority links
 * are dropped at far zoom (LOD) to keep the overview readable.
 */
function ConnectionLinesInner({
  edges,
  nodesById,
  visibleIds,
  selectionId,
  zoomLevel,
}: ConnectionLinesProps) {
  const { visibleEdges, highlighted } = useMemo(() => {
    const visible = edges.filter(
      (e) =>
        visibleIds.has(e.from) &&
        visibleIds.has(e.to) &&
        (zoomLevel === "near" ||
          e.kind === "genre-artist" ||
          e.kind === "artist-album"),
    );
    const hi = selectionId
      ? visible.filter((e) => e.from === selectionId || e.to === selectionId)
      : [];
    return { visibleEdges: visible, highlighted: hi };
  }, [edges, visibleIds, selectionId, zoomLevel]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(buildPositions(visibleEdges, nodesById), 3),
    );
    return geo;
  }, [visibleEdges, nodesById]);

  const highlightGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(buildPositions(highlighted, nodesById), 3),
    );
    return geo;
  }, [highlighted, nodesById]);

  if (visibleEdges.length === 0) return null;

  return (
    <group raycast={() => null}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          color={EDGE_COLOR}
          transparent
          opacity={zoomLevel === "far" ? 0.16 : 0.3}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      {highlighted.length > 0 && (
        <lineSegments geometry={highlightGeometry}>
          <lineBasicMaterial
            color={EDGE_HIGHLIGHT_COLOR}
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}
    </group>
  );
}

export const ConnectionLines = memo(ConnectionLinesInner);
