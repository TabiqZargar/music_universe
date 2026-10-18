"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { GraphNode } from "@/types/domain";
import { CAMERA_HOME, TARGET_HOME, focusDistance, worldRadius } from "./scene-config";

export interface CameraRigProps {
  cameraCommand: { type: "focus" | "reset"; id: string | null; nonce: number };
  nodesById: Map<string, GraphNode>;
  reducedMotion: boolean;
  onZoomLevelChange: (level: "far" | "near") => void;
}

const FAR_THRESHOLD = 168;

const desiredPosition = new THREE.Vector3();
const desiredTarget = new THREE.Vector3();
const direction = new THREE.Vector3();

/**
 * Smooth camera choreography: focus on selection, reset to full-universe
 * overview, subtle idle orbit when idle, and a zoom-level signal for scene
 * LOD. All motion runs through refs inside the frame loop — no React state
 * per frame; state is touched only when the zoom band flips.
 */
export default function CameraRig({
  cameraCommand,
  nodesById,
  reducedMotion,
  onZoomLevelChange,
}: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  const animating = useRef(false);
  const zoomBand = useRef<"far" | "near">("far");

  useEffect(() => {
    if (cameraCommand.nonce === 0) return;
    if (cameraCommand.type === "reset" || !cameraCommand.id) {
      desiredPosition.copy(CAMERA_HOME);
      desiredTarget.copy(TARGET_HOME);
    } else {
      const node = nodesById.get(cameraCommand.id);
      if (!node) return;
      const radius = worldRadius(node.kind, node.normRadius);
      desiredTarget.set(node.position[0], node.position[1], node.position[2]);
      direction.set(node.position[0], node.position[1], node.position[2]);
      if (direction.lengthSq() < 0.001) direction.set(0.2, 0.35, 1);
      direction.normalize();
      const distance = focusDistance(node.kind, radius);
      desiredPosition.copy(desiredTarget).addScaledVector(direction, distance);
      // Keep a sensible elevation rather than aligning with the region axis.
      desiredPosition.y = Math.max(desiredPosition.y + distance * 0.28, desiredTarget.y + distance * 0.25);
    }
    animating.current = true;
    if (reducedMotion) {
      camera.position.copy(desiredPosition);
      const controls = controlsRef.current;
      if (controls) {
        controls.target.copy(desiredTarget);
        controls.update();
      }
      animating.current = false;
    }
  }, [cameraCommand, nodesById, camera, reducedMotion]);

  const idleOrbit = !reducedMotion;

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (animating.current) {
      // Park the idle orbit while transitioning so it cannot fight the lerp.
      controls.autoRotate = false;
      const t = 1 - Math.exp(-delta * 3.2);
      camera.position.lerp(desiredPosition, t);
      controls.target.lerp(desiredTarget, t);
      if (
        camera.position.distanceTo(desiredPosition) < 0.4 &&
        controls.target.distanceTo(desiredTarget) < 0.2
      ) {
        camera.position.copy(desiredPosition);
        controls.target.copy(desiredTarget);
        animating.current = false;
      }
      controls.update();
    } else {
      controls.autoRotate = idleOrbit;
    }

    const distance = camera.position.distanceTo(controls.target);
    const band = distance > FAR_THRESHOLD ? "far" : "near";
    if (band !== zoomBand.current) {
      zoomBand.current = band;
      onZoomLevelChange(band);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.55}
      zoomSpeed={0.8}
      panSpeed={0.6}
      minDistance={5}
      maxDistance={320}
      autoRotate={idleOrbit}
      autoRotateSpeed={0.22}
      enablePan={false}
      onStart={() => {
        animating.current = false;
      }}
    />
  );
}
