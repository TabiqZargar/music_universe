"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { EntityKind, GraphNode } from "@/types/domain";
import { KIND_COLOR, worldRadius } from "./scene-config";

export interface NodeFieldProps {
  kind: Exclude<EntityKind, "genre">;
  nodes: GraphNode[];
  visibleIds: Set<string>;
  selectionId: string | null;
  hoverId: string | null;
  /** depth-lit node ids for the current selection (selected included). */
  relatedIds: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  reducedMotion: boolean;
}

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const tmpPosition = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();

function buildGeometry(kind: Exclude<EntityKind, "genre">): THREE.BufferGeometry {
  if (kind === "artist") return new THREE.IcosahedronGeometry(1, 2);
  if (kind === "album") return new THREE.SphereGeometry(1, 22, 16);
  return new THREE.SphereGeometry(1, 14, 10);
}

function nodeFactor(
  node: GraphNode,
  selectionId: string | null,
  hoverId: string | null,
  relatedIds: Set<string>,
): number {
  if (selectionId) {
    if (node.id === selectionId) return 1.65;
    if (relatedIds.has(node.id)) return 1.12;
    return 0.3;
  }
  if (hoverId === node.id) return 1.4;
  return 1;
}

/**
 * One instanced mesh per entity kind (plus an additive halo layer for
 * tracks). All repeated geometry is batched into single draw calls; matrices
 * and colors are rewritten only when the visible set or selection changes —
 * never inside the frame loop.
 */
function NodeFieldInner({
  kind,
  nodes,
  visibleIds,
  selectionId,
  hoverId,
  relatedIds,
  onSelect,
  onHover,
  reducedMotion,
}: NodeFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  const visible = useMemo(
    () => nodes.filter((n) => n.kind === kind && visibleIds.has(n.id)),
    [nodes, kind, visibleIds],
  );
  const geometry = useMemo(() => buildGeometry(kind), [kind]);
  const colorBase = KIND_COLOR[kind];

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < visible.length; i++) {
      const node = visible[i];
      const radius = worldRadius(kind, node.normRadius);
      const boost = nodeFactor(node, selectionId, hoverId, relatedIds);
      const hoverPulse =
        !reducedMotion && hoverId === node.id ? 1.06 : 1;
      tmpPosition.set(node.position[0], node.position[1], node.position[2]);
      tmpScale.setScalar(radius * (selectionId === node.id ? 1.22 : 1) * hoverPulse);
      tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      tmpColor.copy(colorBase).multiplyScalar(boost);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.count = visible.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const halo = haloRef.current;
    if (halo) {
      for (let i = 0; i < visible.length; i++) {
        const node = visible[i];
        const radius = worldRadius(kind, node.normRadius);
        const boost = nodeFactor(node, selectionId, hoverId, relatedIds);
        tmpPosition.set(node.position[0], node.position[1], node.position[2]);
        tmpScale.setScalar(radius * 2.3);
        tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
        halo.setMatrixAt(i, tmpMatrix);
        tmpColor.copy(colorBase).multiplyScalar(Math.min(1, boost * 0.8));
        halo.setColorAt(i, tmpColor);
      }
      halo.count = visible.length;
      halo.instanceMatrix.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    }
  }, [visible, kind, selectionId, hoverId, relatedIds, colorBase, reducedMotion]);

  const material = useMemo(() => {
    if (kind === "track") {
      return new THREE.MeshBasicMaterial({ toneMapped: false });
    }
    return new THREE.MeshStandardMaterial({
      roughness: 0.42,
      metalness: 0.18,
      emissive: new THREE.Color("#141b3d"),
      emissiveIntensity: 0.9,
    });
  }, [kind]);

  const haloMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: kind === "track" ? 0.16 : 0.07,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [kind],
  );

  if (visible.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, visible.length]}
        frustumCulled={false}
        onPointerOver={(event) => {
          event.stopPropagation();
          if (event.instanceId == null) return;
          const node = visible[event.instanceId];
          if (node) onHover(node.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(event) => {
          event.stopPropagation();
          if (event.instanceId == null) return;
          const node = visible[event.instanceId];
          if (node) onSelect(node.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (event.instanceId == null) return;
          const node = visible[event.instanceId];
          if (node) onSelect(node.id);
        }}
      />
      <instancedMesh
        ref={haloRef}
        args={[geometry, haloMaterial, visible.length]}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}

export const NodeField = memo(NodeFieldInner);
