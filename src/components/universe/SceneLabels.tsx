"use client";

import { Html } from "@react-three/drei";
import type { GraphNode } from "@/types/domain";
import { worldRadius } from "./scene-config";

/**
 * In-scene labels: genre names appear at near zoom (hidden far out for
 * readability), while a compact tooltip follows the hovered node and a label
 * marks the current selection. All labels are pointer-transparent — interaction
 * stays with the raycastable meshes underneath.
 */
export default function SceneLabels({
  genreNodes,
  hoverNode,
  selectedNode,
  zoomLevel,
  visibleIds,
}: {
  genreNodes: GraphNode[];
  hoverNode: GraphNode | null;
  selectedNode: GraphNode | null;
  zoomLevel: "far" | "near";
  visibleIds: Set<string>;
}) {
  const showGenreLabels = zoomLevel === "near";

  return (
    <>
      {showGenreLabels &&
        genreNodes.map((node) => {
          if (!visibleIds.has(node.id)) return null;
          const radius = worldRadius("genre", node.normRadius);
          return (
            <Html
              key={node.id}
              position={[node.position[0], node.position[1] + radius + 2.5, node.position[2]]}
              center
              pointerEvents="none"
              zIndexRange={[10, 0]}
              style={{ userSelect: "none" }}
            >
              <div
                className="whitespace-nowrap rounded-full border border-white/10 bg-black/55 px-2.5 py-0.5 text-[11px] font-medium tracking-[0.14em] text-violet-200/90 uppercase backdrop-blur-sm"
              >
                {node.label}
              </div>
            </Html>
          );
        })}

      {hoverNode && hoverNode.id !== selectedNode?.id && (
        <Html
          position={hoverNode.position}
          center
          pointerEvents="none"
          zIndexRange={[20, 0]}
          style={{ userSelect: "none" }}
        >
          <div className="translate-y-[-18px] whitespace-nowrap rounded-md border border-white/15 bg-black/75 px-2 py-1 text-xs text-slate-100 shadow-lg backdrop-blur-sm">
            <span className="mr-1.5 text-[10px] font-semibold tracking-wide text-cyan-300/80 uppercase">
              {hoverNode.kind}
            </span>
            {hoverNode.label}
          </div>
        </Html>
      )}

      {selectedNode && (
        <Html
          position={selectedNode.position}
          center
          pointerEvents="none"
          zIndexRange={[15, 0]}
          style={{ userSelect: "none" }}
        >
          <div className="mt-6 whitespace-nowrap rounded-md border border-cyan-300/30 bg-black/70 px-2 py-1 text-xs font-medium text-cyan-100 shadow-lg backdrop-blur-sm">
            {selectedNode.label}
          </div>
        </Html>
      )}
    </>
  );
}
