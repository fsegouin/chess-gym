import * as THREE from "three/webgpu";

export type PieceFinish = "ceramic" | "metal" | "stone" | "wood" | "clay";
export type BoardFinish = "smooth" | "wood" | "stone";

/** Deterministic PRNG so a theme's textures look the same on every load. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a hex colour towards black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const target = amount < 0 ? new THREE.Color(0, 0, 0) : new THREE.Color(1, 1, 1);
  c.lerp(target, Math.abs(amount));
  return `#${c.getHexString()}`;
}

function rgba(hex: string, alpha: number): string {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

function makeCanvas(width: number, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d")! };
}

function toTexture(canvas: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Wood grain inside a rectangle. Grain runs along the rectangle's long axis unless `across`
 * is set, which is how alternating squares on a real board are cut.
 */
function paintWood(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  rand: () => number,
  across = false,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const length = across ? w : h;
  const span = across ? h : w;
  const lines = Math.max(12, Math.round(span / 3));
  const dark = shade(base, -0.35);
  const light = shade(base, 0.18);
  for (let i = 0; i < lines; i++) {
    const offset = rand() * span;
    const amp = 1 + rand() * span * 0.02;
    const freq = (0.5 + rand() * 1.5) / length;
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = rgba(rand() < 0.75 ? dark : light, 0.05 + rand() * 0.16);
    ctx.lineWidth = 0.6 + rand() * 2.2;
    ctx.beginPath();
    for (let t = 0; t <= length; t += 6) {
      const wobble = Math.sin(t * freq * Math.PI * 2 + phase) * amp + Math.sin(t * 0.07 + phase) * 0.6;
      const px = across ? x + t : x + offset + wobble;
      const py = across ? y + offset + wobble : y + t;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  rand: () => number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const dark = shade(base, -0.3);
  const light = shade(base, 0.25);
  const specks = Math.round((w * h) / 18);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? dark : light, 0.04 + rand() * 0.1);
    const s = 0.6 + rand() * 1.8;
    ctx.fillRect(x + rand() * w, y + rand() * h, s, s);
  }
  // A few soft veins.
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = rgba(rand() < 0.5 ? light : dark, 0.08 + rand() * 0.08);
    ctx.lineWidth = 0.8 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x + rand() * w, y);
    ctx.bezierCurveTo(x + rand() * w, y + h * 0.33, x + rand() * w, y + h * 0.66, x + rand() * w, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

function paintSmooth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  rand: () => number,
): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const specks = Math.round((w * h) / 60);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rgba(rand() < 0.5 ? "#000000" : "#ffffff", 0.015 + rand() * 0.02);
    ctx.fillRect(x + rand() * w, y + rand() * h, 1.5, 1.5);
  }
}

function paint(
  finish: BoardFinish,
  ctx: CanvasRenderingContext2D,
  rect: [number, number, number, number],
  base: string,
  rand: () => number,
  across = false,
): void {
  if (finish === "wood") paintWood(ctx, ...rect, base, rand, across);
  else if (finish === "stone") paintStone(ctx, ...rect, base, rand);
  else paintSmooth(ctx, ...rect, base, rand);
}

/**
 * The playing surface as one texture. Canvas top-left is a8, matching the UV layout of the
 * board's top face (u along files, v from rank 1 up to rank 8).
 */
export function createBoardTexture(
  finish: BoardFinish,
  light: string,
  dark: string,
  size: number,
): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const rand = random(7);
  const sq = size / 8;
  for (let row = 0; row < 8; row++) {
    for (let file = 0; file < 8; file++) {
      const rank = 7 - row;
      const isDark = (file + rank) % 2 === 0;
      paint(finish, ctx, [file * sq, row * sq, sq, sq], isDark ? dark : light, rand, (file + rank) % 2 === 1);
    }
  }
  return toTexture(canvas);
}

export function createFrameTexture(finish: BoardFinish, color: string, size: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  paint(finish, ctx, [0, 0, size, size], color, random(11));
  return toTexture(canvas);
}

/** Surface for one side's pieces. The base colour is baked into the map when there is one. */
export function createPieceMaterial(finish: PieceFinish, color: string, size: number, seed: number): THREE.MeshPhysicalMaterial {
  if (finish === "ceramic") {
    return new THREE.MeshPhysicalMaterial({ vertexColors: true, color, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  }
  if (finish === "clay") {
    return new THREE.MeshPhysicalMaterial({ vertexColors: true, color, roughness: 0.78, sheen: 0.4, sheenRoughness: 0.8, sheenColor: shade(color, 0.3) });
  }
  const rand = random(seed);
  const { canvas, ctx } = makeCanvas(size);
  if (finish === "wood") {
    // Lathe UVs run v up the profile, so vertical grain follows the piece's height.
    paintWood(ctx, 0, 0, size, size, color, rand);
    const map = toTexture(canvas, true);
    return new THREE.MeshPhysicalMaterial({ vertexColors: true, map, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  }
  if (finish === "stone") {
    paintStone(ctx, 0, 0, size, size, color, rand);
    const map = toTexture(canvas, true);
    return new THREE.MeshPhysicalMaterial({ vertexColors: true, map, roughness: 0.82 });
  }
  // Brushed metal: fine streaks running around the piece.
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 1.5; i++) {
    ctx.strokeStyle = rgba(rand() < 0.5 ? shade(color, -0.25) : shade(color, 0.25), 0.04 + rand() * 0.06);
    ctx.lineWidth = 0.5 + rand();
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (rand() - 0.5) * 2);
    ctx.stroke();
  }
  const map = toTexture(canvas, true);
  return new THREE.MeshPhysicalMaterial({ vertexColors: true, map, metalness: 0.9, roughness: 0.34 });
}
