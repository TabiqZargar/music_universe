import * as THREE from "three";
import type { EntityKind } from "@/types/domain";
import { RADIUS_RANGES } from "@/lib/music/sizing";

/** Restrained palette: violet / blue / cyan on near-black deep space. */
export const KIND_COLOR: Record<EntityKind, THREE.Color> = {
  genre: new THREE.Color("#7c5cff"),
  artist: new THREE.Color("#7aa2ff"),
  album: new THREE.Color("#a08cff"),
  track: new THREE.Color("#6ee7f9"),
};

export const BACKGROUND = "#04050c";
export const STAR_COLOR = new THREE.Color("#93a6cc");
export const EDGE_COLOR = "#3d4d84";
export const EDGE_HIGHLIGHT_COLOR = "#8ea7ff";

export const CAMERA_HOME = new THREE.Vector3(0, 22, 132);
export const TARGET_HOME = new THREE.Vector3(0, 0, 0);

/** Initial camera far plane — keeps the whole shell visible without z-fighting. */
export const CAMERA_FAR = 900;

export function worldRadius(kind: EntityKind, normRadius: number): number {
  const { min, max } = RADIUS_RANGES[kind];
  return min + (max - min) * Math.min(1, Math.max(0, normRadius));
}

/**
 * Distance from a node at which the camera should stop when focusing it.
 * Genres need much more standoff than a single track.
 */
export function focusDistance(kind: EntityKind, radius: number): number {
  const base: Record<EntityKind, number> = {
    genre: 42,
    artist: 16,
    album: 9,
    track: 6,
  };
  return base[kind] + radius * 2.4;
}
