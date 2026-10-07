import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PieceSymbol } from "chess.js";

type Profile = [number, number][];

const SEGMENTS = 48;

/** Points along a circular arc, used for rounded heads and collars. */
function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): Profile {
  const pts: Profile = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Shared foot: a wide disc with a soft bevel that every piece stands on. */
const FOOT: Profile = [
  [0, 0],
  [0.355, 0],
  [0.37, 0.015],
  [0.37, 0.06],
  [0.35, 0.085],
  [0.3, 0.1],
  [0.27, 0.125],
];

function lathe(profile: Profile): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)),
    SEGMENTS,
  );
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Some parts are indexed and some are not; merging needs them to agree.
  const prepared = parts.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(flat.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) flat.deleteAttribute(name);
    }
    flat.clearGroups();
    return flat;
  });
  const merged = mergeGeometries(prepared, false);
  bakeContactShade(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Darkens each piece towards its base, like light occluded by the board and its neighbours.
 * This keeps overlapping light pieces readable: a pawn's dark foot stands out against the bright
 * body of the piece behind it.
 */
function bakeContactShade(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.smoothstep(position.getY(i), 0, 0.34);
    const shade = 0.6 + 0.4 * t;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function pawn(): THREE.BufferGeometry {
  return lathe([
    ...FOOT,
    [0.21, 0.18],
    [0.155, 0.28],
    [0.125, 0.4],
    [0.19, 0.43],
    [0.19, 0.46],
    [0.11, 0.48],
    ...arc(0, 0.6, 0.165, -Math.PI / 2 + 0.75, Math.PI / 2, 12),
  ]);
}

function rook(): THREE.BufferGeometry {
  const body = lathe([
    ...FOOT,
    [0.25, 0.19],
    [0.215, 0.32],
    [0.205, 0.62],
    [0.27, 0.66],
    [0.275, 0.76],
    [0.19, 0.76],
    [0.19, 0.71],
    [0, 0.71],
  ]);
  const merlons: THREE.BufferGeometry[] = [];
  const outer = 0.275;
  const inner = 0.19;
  const span = Math.PI / 2 - 0.42;
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.21 + Math.PI / 4;
    const a1 = a0 + span;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, a0, a1, false);
    shape.absarc(0, 0, inner, a1, a0, true);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.76, 0);
    merlons.push(g);
  }
  return merge([body, ...merlons]);
}

function knight(): THREE.BufferGeometry {
  const base = lathe([
    ...FOOT,
    [0.25, 0.17],
    [0.23, 0.22],
    [0.25, 0.25],
    [0.24, 0.28],
    [0, 0.28],
  ]);
  // Side silhouette of the head, facing +X.
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.26);
  s.quadraticCurveTo(-0.23, 0.5, -0.15, 0.68);
  s.quadraticCurveTo(-0.09, 0.8, -0.02, 0.86);
  s.lineTo(0.0, 0.96);
  s.lineTo(0.07, 0.86);
  s.quadraticCurveTo(0.16, 0.8, 0.27, 0.64);
  s.quadraticCurveTo(0.33, 0.55, 0.29, 0.5);
  s.quadraticCurveTo(0.22, 0.47, 0.12, 0.5);
  s.quadraticCurveTo(0.03, 0.47, 0.06, 0.4);
  s.quadraticCurveTo(0.17, 0.3, 0.17, 0.26);
  s.lineTo(-0.2, 0.26);
  const depth = 0.2;
  const head = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.035,
    bevelSegments: 4,
    curveSegments: 10,
  });
  head.translate(0, 0, -depth / 2);
  // Face towards -Z, the direction White plays.
  head.rotateY(Math.PI / 2);
  return merge([base, head]);
}

function bishop(): THREE.BufferGeometry {
  return lathe([
    ...FOOT,
    [0.215, 0.18],
    [0.15, 0.32],
    [0.12, 0.47],
    [0.19, 0.5],
    [0.19, 0.53],
    [0.11, 0.555],
    [0.15, 0.61],
    [0.175, 0.69],
    [0.165, 0.77],
    [0.13, 0.84],
    [0.075, 0.89],
    [0.035, 0.905],
    ...arc(0, 0.95, 0.05, -Math.PI / 2 + 0.6, Math.PI / 2, 6),
  ]);
}

function queen(): THREE.BufferGeometry {
  const body = lathe([
    ...FOOT,
    [0.225, 0.18],
    [0.155, 0.36],
    [0.125, 0.6],
    [0.205, 0.64],
    [0.205, 0.67],
    [0.13, 0.69],
    [0.15, 0.77],
    [0.215, 0.89],
    [0.2, 0.91],
    [0.12, 0.915],
    [0.06, 0.95],
    [0, 0.955],
  ]);
  const top = new THREE.SphereGeometry(0.065, 20, 14);
  top.translate(0, 1.01, 0);
  const beads: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = new THREE.SphereGeometry(0.032, 12, 8);
    b.translate(Math.cos(a) * 0.2, 0.925, Math.sin(a) * 0.2);
    beads.push(b);
  }
  return merge([body, top, ...beads]);
}

function king(): THREE.BufferGeometry {
  const body = lathe([
    ...FOOT,
    [0.235, 0.18],
    [0.165, 0.4],
    [0.135, 0.66],
    [0.215, 0.7],
    [0.215, 0.73],
    [0.14, 0.75],
    [0.165, 0.85],
    [0.205, 0.97],
    [0.17, 0.99],
    [0, 0.995],
  ]);
  const upright = new THREE.BoxGeometry(0.075, 0.24, 0.075);
  upright.translate(0, 1.11, 0);
  const bar = new THREE.BoxGeometry(0.2, 0.07, 0.075);
  bar.translate(0, 1.13, 0);
  return merge([body, upright, bar]);
}

const BUILDERS: Record<PieceSymbol, () => THREE.BufferGeometry> = {
  p: pawn,
  r: rook,
  n: knight,
  b: bishop,
  q: queen,
  k: king,
};

export function createPieceGeometries(): Record<PieceSymbol, THREE.BufferGeometry> {
  const out = {} as Record<PieceSymbol, THREE.BufferGeometry>;
  for (const key of Object.keys(BUILDERS) as PieceSymbol[]) out[key] = BUILDERS[key]();
  return out;
}
