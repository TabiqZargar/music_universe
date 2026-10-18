"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GraphNode } from "@/types/domain";
import { seededRandom } from "@/lib/music/keys";
import { KIND_COLOR, worldRadius } from "./scene-config";

const CLOUD_POINTS = 110;

function regionCloudGeometry(seed: string): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const positions = new Float32Array(CLOUD_POINTS * 3);
  for (let i = 0; i < CLOUD_POINTS; i++) {
    // Uniform-ish points inside a unit sphere, scaled later by the mesh.
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.cbrt(rand());
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = Math.cos(theta) * s * r;
    positions[i * 3 + 1] = u * r;
    positions[i * 3 + 2] = Math.sin(theta) * s * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geo;
}

/**
 * A genre region is a faint boundary sphere plus an inner particle cloud —
 * deliberately not one giant opaque ball, so children stay visible inside it.
 */
function GenreRegion({
  node,
  dimmed,
  highlighted,
  reducedMotion,
}: {
  node: GraphNode;
  dimmed: boolean;
  highlighted: boolean;
  reducedMotion: boolean;
}) {
  const radius = worldRadius("genre", node.normRadius);
  const cloudRef = useRef<THREE.Points>(null);
  const cloud = useMemo(() => regionCloudGeometry(`cloud:${node.id}`), [node.id]);
  const color = KIND_COLOR.genre;
  const opacity = dimmed ? 0.035 : highlighted ? 0.16 : 0.085;

  useFrame((state) => {
    if (reducedMotion || !cloudRef.current) return;
    const t = state.clock.elapsedTime;
    cloudRef.current.rotation.y = t * 0.03;
    cloudRef.current.rotation.x = Math.sin(t * 0.012) * 0.08;
  });

  return (
    <group position={node.position}>
      <mesh raycast={() => null}>
        <sphereGeometry args={[radius, 28, 20]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.55}
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      <mesh raycast={() => null}>
        <sphereGeometry args={[radius, 20, 14]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={dimmed ? 0.03 : 0.07}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <points ref={cloudRef} raycast={() => null}>
        <primitive object={cloud} attach="geometry" />
        <pointsMaterial
          color={color}
          size={radius * 0.075}
          sizeAttenuation
          transparent
          opacity={dimmed ? 0.1 : 0.32}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  );
}

export default function GenreRegions({
  genreNodes,
  selectionId,
  hoverId,
  reducedMotion,
}: {
  genreNodes: GraphNode[];
  selectionId: string | null;
  hoverId: string | null;
  reducedMotion: boolean;
}) {
  const activeGenres = new Set(
    selectionId && genreNodes.find((n) => n.id === selectionId)?.kind === "genre"
      ? [selectionId]
      : [],
  );
  return (
    <>
      {genreNodes.map((node) => (
        <GenreRegion
          key={node.id}
          node={node}
          dimmed={activeGenres.size > 0 && !activeGenres.has(node.id)}
          highlighted={activeGenres.has(node.id) || hoverId === node.id}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}
