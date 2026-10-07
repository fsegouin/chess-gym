import * as THREE from "three/webgpu";
import { float, mix, mrt, normalView, output, packNormalToRGB, pass, renderOutput, sample, select, uniform, unpackRGBToNormal, vec4 } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Color, PieceSymbol, Square } from "chess.js";
import type { Arrow } from "../game";
import type { Quality } from "../settings";
import type { Theme } from "../themes";
import { createPieceGeometries } from "./pieces";
import { createBoardTexture, createFrameTexture, createPieceMaterial } from "./textures";

export interface Highlights {
  selected: Square | null;
  targets: { to: Square; capture: boolean }[];
  lastMove: { from: Square; to: Square } | null;
  check: Square | null;
  arrows: Arrow[];
  /** Keyboard cursor; null when the board is driven by pointer or touch. */
  cursor: Square | null;
}

interface PieceObj {
  /** Positioned on the board and moved by move tweens. */
  holder: THREE.Group;
  /** Child of the holder; carries the lift when the piece is selected. */
  mesh: THREE.Mesh;
  type: PieceSymbol;
  color: Color;
}

interface Tween {
  start: number;
  duration: number;
  step: (t: number) => void;
  done?: () => void;
  /** Survives flushTweens, e.g. the camera turning while pieces snap into place. */
  keep?: boolean;
}

const FILES = "abcdefgh";
const BOARD_TOP = 0.03;
const FRAME = 9.1;
const OVERLAY_Y = BOARD_TOP + 0.002;
/** Deep enough to stand out on the lightest squares, the warm walnut ones included. */
const ARROW_COLORS: Record<Arrow["kind"], string> = {
  best: "#1f8a58",
  threat: "#d6453d",
  hint: "#2f7fd8",
  played: "#e0782b",
};

function squareToXZ(square: Square): { x: number; z: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return { x: file - 3.5, z: 3.5 - rank };
}

function pointToSquare(x: number, z: number): Square | null {
  const file = Math.floor(x + 4);
  const rank = Math.floor(4 - z);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

function parsePlacement(fen: string): Map<Square, { type: PieceSymbol; color: Color }> {
  const out = new Map<Square, { type: PieceSymbol; color: Color }>();
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const square = `${FILES[file]}${8 - r}` as Square;
      out.set(square, {
        type: ch.toLowerCase() as PieceSymbol,
        color: ch === ch.toUpperCase() ? "w" : "b",
      });
      file++;
    }
  });
  return out;
}

/** Seconds for the keyboard camera to cover about two thirds of the way to its goal. */
const CAMERA_EASE_SECONDS = 0.11;
/** How far the keyboard goal may run ahead of the camera while a key is held. */
const MAX_GOAL_LEAD = 1.2;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function overlayMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function flatPlane(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return mesh;
}

export class BoardScene {
  readonly canvas: HTMLCanvasElement;
  backend: "WebGPU" | "WebGL 2" = "WebGL 2";
  /** Called with the tapped square, or null when the tap missed the board. */
  onTap: (square: Square | null) => void = () => {};
  /** Lets the scene show a pointer cursor over squares that accept a tap. */
  isInteractive: (square: Square) => boolean = () => false;
  /** Fires when the camera leaves or returns to the default view. */
  onViewChange: (adjusted: boolean) => void = () => {};

  private container: HTMLElement;
  private renderer!: THREE.WebGPURenderer;
  /** Scene pass plus ambient occlusion; used on High quality only. */
  private pipeline: THREE.RenderPipeline | null = null;
  /** Page background in display (sRGB) values, composited behind the board by the pipeline. */
  private backdrop = uniform(new THREE.Color(1, 1, 1));
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private controls!: OrbitControls;
  private keyLight!: THREE.DirectionalLight;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pickTargets: THREE.Object3D[] = [];
  private geometries = createPieceGeometries();
  private pieceMaterials: Record<Color, THREE.MeshPhysicalMaterial>;
  private frameMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  private boardMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  private boardTop = new THREE.Mesh(new THREE.BoxGeometry(8, BOARD_TOP, 8), this.boardMaterial);
  private quality: Quality = "high";
  /** Theme and quality the current textures were built for, to skip identical rebuilds. */
  private finishKey = "";
  private labelCanvas = document.createElement("canvas");
  private labelTexture: THREE.CanvasTexture;
  private pieces = new Map<Square, PieceObj>();
  private tweens: Tween[] = [];
  private cameraTween = false;
  /** Where keyboard orbit and zoom are heading; the camera eases towards it each frame. */
  private cameraGoal: THREE.Spherical | null = null;
  private lastFrame = 0;
  /** Shift of the projection, in NDC, that centres the board in the free part of the stage. */
  private viewShift = { x: 0, y: 0 };
  /** Set once the user orbits or zooms, so resizes stop resetting their view. */
  private userAdjusted = false;
  private dirty = true;
  private side: Color = "w";
  private theme: Theme;
  private selected: Square | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private pointerDown: { id: number; x: number; y: number; t: number } | null = null;
  private hoverFrame = 0;
  private arrowKey = "";

  private overlays = {
    last: [] as THREE.Mesh[],
    selected: null as unknown as THREE.Mesh,
    check: null as unknown as THREE.Mesh,
    dots: [] as THREE.Mesh[],
    rings: [] as THREE.Mesh[],
    arrows: new THREE.Group(),
    cursor: null as unknown as THREE.Mesh,
  };

  private constructor(container: HTMLElement, theme: Theme) {
    this.container = container;
    this.theme = theme;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "board-canvas";
    container.appendChild(this.canvas);

    this.pieceMaterials = {
      w: new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
      b: new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.22 }),
    };

    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture.anisotropy = 4;

    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  static async create(container: HTMLElement, theme: Theme, quality: Quality): Promise<BoardScene> {
    const scene = new BoardScene(container, theme);
    try {
      await scene.init(quality);
    } catch (error) {
      scene.dispose();
      throw error;
    }
    return scene;
  }

  private async init(quality: Quality): Promise<void> {
    const renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: true });
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    this.renderer = renderer;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL 2";
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.35;
      pmrem.dispose();
    } catch {
      // Lights alone still give a clean look if the environment cannot be baked.
    }

    this.buildLights();
    this.buildBoard();
    this.buildOverlays();
    this.buildControls();
    this.quality = quality;
    this.setTheme(this.theme);
    this.setQuality(quality);

    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: true });
    this.resizeObserver.observe(this.container);
    this.resize();
    this.placeCamera(this.side, false);
    renderer.setAnimationLoop(this.frame);
  }

  private buildLights(): void {
    // A modest fill keeps shadows readable; most of the shape comes from the key light and the
    // environment, which is what separates overlapping light pieces.
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0x5f584e, 0.38));

    const key = new THREE.DirectionalLight(0xfff4e6, 2.7);
    key.position.set(-5, 10, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -6.5;
    cam.right = 6.5;
    cam.top = 6.5;
    cam.bottom = -6.5;
    cam.near = 2;
    cam.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.keyLight = key;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    rim.position.set(6, 5, -7);
    this.scene.add(rim);
  }

  private buildBoard(): void {
    const base = new THREE.Mesh(new RoundedBoxGeometry(FRAME, 0.4, FRAME, 4, 0.12), this.frameMaterial);
    base.position.y = -0.2;
    base.receiveShadow = true;
    this.scene.add(base);

    const labels = new THREE.Mesh(
      new THREE.PlaneGeometry(FRAME, FRAME),
      new THREE.MeshBasicMaterial({
        map: this.labelTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    labels.rotation.x = -Math.PI / 2;
    labels.position.y = 0.003;
    this.scene.add(labels);

    this.boardTop.position.y = BOARD_TOP / 2;
    this.boardTop.receiveShadow = true;
    this.scene.add(this.boardTop);
  }

  private buildOverlays(): void {
    const unit = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 2; i++) {
      const mesh = flatPlane(unit, overlayMaterial("#f0c24b", 0.4));
      this.overlays.last.push(mesh);
      this.scene.add(mesh);
    }
    this.overlays.selected = flatPlane(unit, overlayMaterial("#f0c24b", 0.62));
    this.scene.add(this.overlays.selected);

    const frame = new THREE.Shape();
    frame.moveTo(-0.49, -0.49);
    frame.lineTo(0.49, -0.49);
    frame.lineTo(0.49, 0.49);
    frame.lineTo(-0.49, 0.49);
    frame.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.41, -0.41);
    hole.lineTo(-0.41, 0.41);
    hole.lineTo(0.41, 0.41);
    hole.lineTo(0.41, -0.41);
    hole.closePath();
    frame.holes.push(hole);
    this.overlays.cursor = flatPlane(new THREE.ShapeGeometry(frame), overlayMaterial(this.theme.ui.focus, 0.95));
    this.overlays.cursor.renderOrder = 3;
    this.scene.add(this.overlays.cursor);

    const glow = document.createElement("canvas");
    glow.width = glow.height = 128;
    const g = glow.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(230, 60, 50, 0.95)");
    grad.addColorStop(0.55, "rgba(230, 60, 50, 0.45)");
    grad.addColorStop(1, "rgba(230, 60, 50, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const glowTexture = new THREE.CanvasTexture(glow);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    this.overlays.check = flatPlane(
      new THREE.PlaneGeometry(1.25, 1.25),
      new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.scene.add(this.overlays.check);

    const dot = new THREE.CircleGeometry(0.15, 32);
    const ring = new THREE.RingGeometry(0.39, 0.47, 48);
    const markMaterial = overlayMaterial("#151515", 0.3);
    for (let i = 0; i < 28; i++) {
      const d = flatPlane(dot, markMaterial);
      const r = flatPlane(ring, markMaterial);
      this.overlays.dots.push(d);
      this.overlays.rings.push(r);
      this.scene.add(d, r);
    }
    this.scene.add(this.overlays.arrows);
  }

  private buildControls(): void {
    const c = new OrbitControls(this.camera, this.canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.enablePan = false;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.minPolarAngle = 0.12;
    c.maxPolarAngle = 1.22;
    c.minDistance = 7;
    c.maxDistance = 40;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.addEventListener("change", () => (this.dirty = true));
    // Grabbing the board with the pointer takes over from any keyboard glide.
    c.addEventListener("start", () => (this.cameraGoal = null));
    this.controls = c;
  }

  private drawLabels(): void {
    const size = 1024;
    const c = this.labelCanvas;
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    const px = size / FRAME;
    const border = (FRAME - 8) / 2;
    const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    ctx.fillStyle = this.theme.board.label;
    ctx.font = `600 ${Math.round(px * 0.26)}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const draw = (text: string, x: number, y: number, rotation: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    // Canvas bottom is White's edge. Coordinates sit on the player's near and left edges,
    // upright from the player's seat.
    const white = this.side === "w";
    const edge = white ? size - (border / 2) * px : (border / 2) * px;
    const side = white ? (border / 2) * px : size - (border / 2) * px;
    const rotation = white ? 0 : Math.PI;
    for (let i = 0; i < 8; i++) {
      draw(FILES[i], (border + i + 0.5) * px, edge, rotation);
      draw(String(i + 1), side, size - (border + i + 0.5) * px, rotation);
    }
    this.labelTexture.needsUpdate = true;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    if (!this.renderer) return;
    this.applyFinish();
    // Store the sRGB numbers as-is: the pipeline composites after its own colour conversion.
    const bg = new THREE.Color(theme.ui.bg).convertLinearToSRGB();
    this.backdrop.value.setRGB(bg.r, bg.g, bg.b, THREE.LinearSRGBColorSpace);
    (this.overlays.cursor.material as THREE.MeshBasicMaterial).color.set(theme.ui.focus);
    this.drawLabels();
    this.dirty = true;
  }

  /** Rebuilds the board surface, frame and piece materials for the theme's finish. */
  private applyFinish(): void {
    const t = this.theme;
    const key = `${t.id}:${this.quality}`;
    if (key === this.finishKey) return;
    this.finishKey = key;
    const high = this.quality === "high";
    const boardFinish = t.finish.board;

    const oldBoard = this.boardMaterial.map;
    this.boardMaterial.map = createBoardTexture(boardFinish, t.board.light, t.board.dark, high ? 2048 : 1024);
    this.boardMaterial.roughness = boardFinish === "stone" ? 0.78 : boardFinish === "wood" ? 0.55 : 0.6;
    this.boardMaterial.needsUpdate = true;
    oldBoard?.dispose();

    const oldFrame = this.frameMaterial.map;
    this.frameMaterial.map = createFrameTexture(boardFinish, t.board.frame, high ? 1024 : 512);
    this.frameMaterial.color.set("#ffffff");
    this.frameMaterial.needsUpdate = true;
    oldFrame?.dispose();

    const old = this.pieceMaterials;
    const size = high ? 512 : 256;
    this.pieceMaterials = {
      w: createPieceMaterial(t.finish.pieces, t.pieces.white, size, 3),
      b: createPieceMaterial(t.finish.pieces, t.pieces.black, size, 5),
    };
    for (const obj of this.pieces.values()) obj.mesh.material = this.pieceMaterials[obj.color];
    for (const m of Object.values(old)) {
      m.map?.dispose();
      m.dispose();
    }
  }

  setQuality(quality: Quality): void {
    if (!this.renderer) return;
    if (quality !== this.quality) {
      this.quality = quality;
      this.applyFinish();
    }
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(quality === "high" ? Math.min(dpr, 2) : Math.min(dpr, 1.25));
    this.keyLight.castShadow = quality === "high";
    if (quality === "high" && !this.pipeline) this.pipeline = this.buildPipeline();
    if (quality !== "high" && this.pipeline) {
      this.pipeline.dispose();
      this.pipeline = null;
    }
    this.resize();
  }

  /** Points the camera from the given side of the board. */
  setOrientation(side: Color, animate = true): void {
    if (side === this.side && animate) return;
    this.side = side;
    if (!this.renderer) return;
    this.drawLabels();
    this.placeCamera(side, animate);
  }

  resetView(): void {
    this.placeCamera(this.side, true);
  }

  /** Turns the camera to the opposite side of the board, without changing whose side it is. */
  flipView(): void {
    if (!this.renderer) return;
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    this.animateCamera(s.radius, s.phi, s.theta + Math.PI);
    this.setAdjusted(true);
  }

  orbitBy(azimuth: number, polar: number): void {
    if (!this.renderer || this.cameraTween) return;
    const current = new THREE.Spherical().setFromVector3(this.camera.position);
    const goal = this.cameraGoal ?? current.clone();
    // Holding the key keeps adding steps; cap the lead so release stops promptly.
    // current.theta is wrapped to (-PI, PI]; wrap the lead too so crossing the seam does not jump.
    let lead = goal.theta - current.theta;
    while (lead > Math.PI) lead -= Math.PI * 2;
    while (lead < -Math.PI) lead += Math.PI * 2;
    goal.theta = current.theta + THREE.MathUtils.clamp(lead + azimuth, -MAX_GOAL_LEAD, MAX_GOAL_LEAD);
    goal.phi = THREE.MathUtils.clamp(goal.phi + polar, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    this.moveCameraTo(goal);
  }

  zoomBy(factor: number): void {
    if (!this.renderer || this.cameraTween) return;
    const goal = this.cameraGoal ?? new THREE.Spherical().setFromVector3(this.camera.position);
    goal.radius = THREE.MathUtils.clamp(goal.radius * factor, this.controls.minDistance, this.controls.maxDistance);
    this.moveCameraTo(goal);
  }

  private moveCameraTo(goal: THREE.Spherical): void {
    this.setAdjusted(true);
    this.dirty = true;
    if (prefersReducedMotion()) {
      this.cameraGoal = null;
      this.camera.position.setFromSpherical(goal);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      return;
    }
    this.cameraGoal = goal;
  }

  /** Eases the camera towards the keyboard goal; frame-rate independent. Returns whether it moved. */
  private stepCameraGoal(dt: number): boolean {
    const goal = this.cameraGoal;
    if (!goal) return false;
    const current = new THREE.Spherical().setFromVector3(this.camera.position);
    let dTheta = goal.theta - current.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const dPhi = goal.phi - current.phi;
    const dRadius = goal.radius - current.radius;
    if (Math.abs(dTheta) < 1e-4 && Math.abs(dPhi) < 1e-4 && Math.abs(dRadius) < 1e-3) {
      this.cameraGoal = null;
      return false;
    }
    const k = 1 - Math.exp(-dt / CAMERA_EASE_SECONDS);
    current.theta += dTheta * k;
    current.phi += dPhi * k;
    current.radius += dRadius * k;
    this.camera.position.setFromSpherical(current);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    return true;
  }

  /**
   * Brings the pieces to the given position. Pieces that moved slide to their new square,
   * captured ones shrink away and new ones (undo, promotion) grow in place.
   */
  /** `speed` above 1 shortens the animations, e.g. when a review plays moves back quickly. */
  setPosition(fen: string, hint: { from: Square; to: Square } | null = null, speed = 1): void {
    this.flushTweens();
    this.setSelectedLift(null);
    const target = parsePlacement(fen);
    const remaining = new Map(this.pieces);
    const next = new Map<Square, PieceObj>();
    const unmatched: [Square, { type: PieceSymbol; color: Color }][] = [];
    const now = performance.now();
    let moveDuration = 0;

    for (const [square, p] of target) {
      const current = remaining.get(square);
      if (current && current.type === p.type && current.color === p.color) {
        next.set(square, current);
        remaining.delete(square);
      } else {
        unmatched.push([square, p]);
      }
    }

    const move = (obj: PieceObj, from: Square, to: Square, becomes?: PieceSymbol, changeFirst = false) => {
      // Undoing a promotion turns the piece back into a pawn before it slides home.
      if (changeFirst && becomes) {
        obj.type = becomes;
        obj.mesh.geometry = this.geometries[becomes];
      }
      const a = squareToXZ(from);
      const b = squareToXZ(to);
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const duration = Math.min(520, 240 + dist * 45) / speed;
      const lift = obj.type === "n" ? 0.55 : 0.08 + Math.min(dist, 4) * 0.03;
      moveDuration = Math.max(moveDuration, duration);
      this.tweens.push({
        start: now,
        duration,
        step: (t) => {
          const e = easeInOut(t);
          obj.holder.position.set(a.x + (b.x - a.x) * e, BOARD_TOP + Math.sin(Math.PI * t) * lift, a.z + (b.z - a.z) * e);
        },
        done: () => {
          if (becomes && becomes !== obj.type) {
            obj.type = becomes;
            obj.mesh.geometry = this.geometries[becomes];
          }
        },
      });
      obj.mesh.userData.square = to;
    };

    if (hint) {
      const mover = remaining.get(hint.from);
      const idx = unmatched.findIndex(([sq]) => sq === hint.to);
      if (mover && idx >= 0 && unmatched[idx][1].color === mover.color) {
        move(mover, hint.from, hint.to, unmatched[idx][1].type);
        remaining.delete(hint.from);
        next.set(hint.to, mover);
        unmatched.splice(idx, 1);
      }
    }

    for (const [square, p] of unmatched) {
      let best: Square | null = null;
      let bestDist = Infinity;
      const t = squareToXZ(square);
      for (const [sq, obj] of remaining) {
        if (obj.type !== p.type || obj.color !== p.color) continue;
        const s = squareToXZ(sq);
        const d = Math.abs(s.x - t.x) + Math.abs(s.z - t.z);
        if (d < bestDist) {
          bestDist = d;
          best = sq;
        }
      }
      const demote = !best && p.type === "p";
      if (demote) best = this.promotedPieceFor(square, p.color, remaining);
      if (best) {
        const obj = remaining.get(best)!;
        remaining.delete(best);
        if (demote) move(obj, best, square, "p", true);
        else move(obj, best, square);
        next.set(square, obj);
      } else {
        next.set(square, this.spawn(square, p.type, p.color, now));
      }
    }

    // Captured pieces leave as the moving piece lands.
    const captureDelay = moveDuration * 0.6;
    for (const obj of remaining.values()) {
      const startY = obj.holder.position.y;
      this.tweens.push({
        start: now + captureDelay,
        duration: 220 / speed,
        step: (t) => {
          const s = 1 - easeOut(t);
          obj.holder.scale.setScalar(Math.max(0.001, s));
          obj.holder.position.y = startY - t * 0.1;
        },
        done: () => this.scene.remove(obj.holder),
      });
    }

    this.pieces = next;
    this.dirty = true;
  }

  setHighlights(h: Highlights): void {
    const o = this.overlays;
    const place = (mesh: THREE.Mesh, square: Square | null, y = OVERLAY_Y) => {
      mesh.visible = square !== null;
      if (!square) return;
      const { x, z } = squareToXZ(square);
      mesh.position.set(x, y, z);
    };

    place(o.last[0], h.lastMove?.from ?? null);
    place(o.last[1], h.lastMove?.to ?? null);
    place(o.selected, h.selected, OVERLAY_Y + 0.001);
    place(o.check, h.check, OVERLAY_Y + 0.002);
    place(o.cursor, h.cursor, OVERLAY_Y + 0.004);

    let d = 0;
    let r = 0;
    for (const t of h.targets) {
      if (t.capture) place(o.rings[r++], t.to, OVERLAY_Y + 0.003);
      else place(o.dots[d++], t.to, OVERLAY_Y + 0.003);
    }
    for (; d < o.dots.length; d++) o.dots[d].visible = false;
    for (; r < o.rings.length; r++) o.rings[r].visible = false;

    this.setSelectedLift(h.selected);
    this.setArrows(h.arrows);
    this.dirty = true;
  }

  /** Client coordinates of a square's centre, for tests and tooling. */
  squareToClient(square: Square): { x: number; y: number } {
    const { x, z } = squareToXZ(square);
    const v = new THREE.Vector3(x, BOARD_TOP, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.hoverFrame);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.pipeline?.dispose();
      this.controls?.dispose();
      this.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((m: THREE.Material & { map?: THREE.Texture | null }) => {
            m.map?.dispose();
            m.dispose();
          });
        }
      });
      Object.values(this.geometries).forEach((g) => g.dispose());
      Object.values(this.pieceMaterials).forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      this.keyLight?.shadow.dispose();
      this.scene.environment?.dispose();
      this.renderer.dispose();
    }
    this.canvas.remove();
  }

  /** A promoted piece standing just above `pawnSquare`, which an undo should turn back into a pawn. */
  private promotedPieceFor(pawnSquare: Square, color: Color, remaining: Map<Square, PieceObj>): Square | null {
    const pawnRank = color === "w" ? "7" : "2";
    const backRank = color === "w" ? "8" : "1";
    if (pawnSquare[1] !== pawnRank) return null;
    const file = FILES.indexOf(pawnSquare[0]);
    for (const [sq, obj] of remaining) {
      if (obj.color !== color || obj.type === "p" || obj.type === "k" || sq[1] !== backRank) continue;
      if (Math.abs(FILES.indexOf(sq[0]) - file) <= 1) return sq;
    }
    return null;
  }

  private setAdjusted(adjusted: boolean): void {
    if (adjusted === this.userAdjusted) return;
    this.userAdjusted = adjusted;
    this.onViewChange(adjusted);
  }

  private spawn(square: Square, type: PieceSymbol, color: Color, now: number): PieceObj {
    const mesh = new THREE.Mesh(this.geometries[type], this.pieceMaterials[color]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.square = square;
    const holder = new THREE.Group();
    holder.add(mesh);
    // Black's pieces face the other way, which matters for the knight.
    holder.rotation.y = color === "b" ? Math.PI : 0;
    const { x, z } = squareToXZ(square);
    holder.position.set(x, BOARD_TOP, z);
    holder.scale.setScalar(0.001);
    this.scene.add(holder);
    this.tweens.push({
      start: now,
      duration: 260,
      step: (t) => holder.scale.setScalar(Math.max(0.001, easeOut(t))),
    });
    return { holder, mesh, type, color };
  }

  private setSelectedLift(square: Square | null): void {
    if (square === this.selected) return;
    const lower = this.selected ? this.pieces.get(this.selected) : undefined;
    const raise = square ? this.pieces.get(square) : undefined;
    this.selected = square;
    const now = performance.now();
    const animate = (obj: PieceObj, to: number) => {
      const from = obj.mesh.position.y;
      this.tweens.push({
        start: now,
        duration: 140,
        step: (t) => (obj.mesh.position.y = from + (to - from) * easeOut(t)),
      });
    };
    if (lower) animate(lower, 0);
    if (raise) animate(raise, 0.12);
  }

  private setArrows(arrows: Arrow[]): void {
    const key = arrows.map((a) => `${a.kind}:${a.from}${a.to}`).join(",");
    if (key === this.arrowKey) return;
    this.arrowKey = key;
    const group = this.overlays.arrows;
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      group.remove(mesh);
    }
    arrows.forEach((arrow, i) => {
      const a = squareToXZ(arrow.from);
      const b = squareToXZ(arrow.to);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const shaft = 0.085;
      const headW = 0.25;
      const headL = 0.4;
      const s = new THREE.Shape();
      s.moveTo(0.18, -shaft);
      s.lineTo(len - headL, -shaft);
      s.lineTo(len - headL, -headW);
      s.lineTo(len - 0.06, 0);
      s.lineTo(len - headL, headW);
      s.lineTo(len - headL, shaft);
      s.lineTo(0.18, shaft);
      s.closePath();
      const geometry = new THREE.ShapeGeometry(s);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, overlayMaterial(ARROW_COLORS[arrow.kind], 0.9));
      mesh.position.set(a.x, OVERLAY_Y + 0.006 + i * 0.002, a.z);
      mesh.rotation.y = Math.atan2(-dz, dx);
      mesh.renderOrder = 2;
      group.add(mesh);
      // A one-square arrow hides under the piece; tint both squares so the move still reads.
      if (len < 1.6) {
        for (const at of [a, b]) {
          const tint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMaterial(ARROW_COLORS[arrow.kind], 0.38));
          tint.rotation.x = -Math.PI / 2;
          tint.position.set(at.x, OVERLAY_Y + 0.004 + i * 0.002, at.z);
          tint.renderOrder = 1;
          group.add(tint);
        }
      }
    });
  }

  /** Ambient occlusion darkens the contact between pieces and the board, and between pieces. */
  private buildPipeline(): THREE.RenderPipeline | null {
    try {
      const pipeline = new THREE.RenderPipeline(this.renderer);
      // Ambient occlusion reads depth, which cannot be multisampled; FXAA smooths edges instead.
      const scenePass = pass(this.scene, this.camera, { samples: 0 });
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      scenePass.getTexture("normal").type = THREE.UnsignedByteType;
      const color = scenePass.getTextureNode("output");
      const normals = scenePass.getTextureNode("normal");
      const normal = sample((uv) => unpackRGBToNormal(normals.sample(uv)));
      const occlusion = ao(scenePass.getTextureNode("depth"), normal, this.camera);
      occlusion.resolutionScale = 0.5;
      occlusion.radius.value = 0.5;
      occlusion.thickness.value = 1;
      const strength = occlusion.getTextureNode().r.mul(0.9).add(0.1);
      pipeline.outputColorTransform = false;
      const graded = renderOutput(vec4(color.rgb.mul(strength), color.a));
      // The pass output is opaque, so the page colour is composited where nothing was drawn
      // (depth still at the far plane). FXAA then smooths the board's edge against it.
      const coverage = select(scenePass.getTextureNode("depth").x.lessThan(0.99999), float(1), float(0));
      pipeline.outputNode = fxaa(vec4(mix(this.backdrop, graded.rgb, coverage), 1));
      return pipeline;
    } catch {
      return null;
    }
  }

  private flushTweens(): void {
    const pending = this.tweens;
    this.tweens = pending.filter((tw) => tw.keep);
    for (const tw of pending) {
      if (tw.keep) continue;
      tw.step(1);
      tw.done?.();
    }
  }

  private runTweens(now: number): boolean {
    if (!this.tweens.length) return false;
    const current = this.tweens;
    this.tweens = [];
    const still: Tween[] = [];
    for (const tw of current) {
      const t = (now - tw.start) / tw.duration;
      if (t < 0) {
        still.push(tw);
        continue;
      }
      tw.step(Math.min(1, t));
      if (t >= 1) tw.done?.();
      else still.push(tw);
    }
    // Tweens added by `done` callbacks during this pass land in this.tweens.
    this.tweens = still.concat(this.tweens);
    return true;
  }

  private frame = (): void => {
    const now = performance.now();
    // Clamp dt so a stalled tab does not jump the camera when it resumes.
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    const animating = this.runTweens(now);
    const gliding = this.cameraTween ? false : this.stepCameraGoal(dt);
    const moved = this.cameraTween ? false : this.controls.update();
    if (animating || gliding || moved || this.dirty || this.cameraTween) {
      if (this.pipeline) this.pipeline.render();
      else this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
  };

  private resize(): void {
    if (!this.renderer) return;
    const { w, h } = this.containerSize();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (!this.cameraTween && !this.userAdjusted) this.placeCamera(this.side, false);
    else this.applyViewShift();
    this.dirty = true;
  }

  private containerSize(): { w: number; h: number } {
    return { w: Math.max(1, this.container.clientWidth), h: Math.max(1, this.container.clientHeight) };
  }

  private applyViewShift(): void {
    const { w, h } = this.containerSize();
    const { x, y } = this.viewShift;
    if (x === 0 && y === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, (x * w) / 2, (-y * h) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }

  /** Default viewing angle: more top-down on tall stages so the board uses their height. */
  private defaultPolar(): number {
    const aspect = this.camera.aspect;
    if (aspect < 0.7) return 0.42;
    if (aspect < 1) return 0.55;
    return 0.72;
  }

  /**
   * Finds the smallest camera distance at which the board, pieces included, fits the free part
   * of the stage (below the status pill, above the evaluation strip), and the projection shift
   * that centres it there.
   */
  private frameBoard(polar: number, azimuth: number): { dist: number; shift: { x: number; y: number } } {
    const { w, h } = this.containerSize();
    const insetTop = 52;
    const insetBottom = 20;
    const insetSide = window.innerWidth >= 1024 ? 56 : 10;
    const halfWidth = 1 - (2 * insetSide) / w;
    const top = 1 - (2 * insetTop) / h;
    const bottom = -1 + (2 * insetBottom) / h;

    const half = FRAME / 2;
    const points: THREE.Vector3[] = [];
    for (const y of [-0.4, 1.2]) {
      for (const x of [-half, half]) for (const z of [-half, half]) points.push(new THREE.Vector3(x, y, z));
    }
    const cam = this.camera.clone();
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const bounds = (dist: number) => {
      cam.position.setFromSphericalCoords(dist, polar, azimuth);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of points) {
        const v = p.clone().project(cam);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
      return { minX, maxX, minY, maxY };
    };
    let lo = 4;
    let hi = 80;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const b = bounds(mid);
      if (b.maxX - b.minX <= 2 * halfWidth && b.maxY - b.minY <= top - bottom) hi = mid;
      else lo = mid;
    }
    const b = bounds(hi);
    return {
      dist: hi,
      shift: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 - (top + bottom) / 2 },
    };
  }

  private placeCamera(side: Color, animate: boolean): void {
    this.cameraGoal = null;
    this.setAdjusted(false);
    const polar = this.defaultPolar();
    const azimuth = side === "w" ? 0 : Math.PI;
    const { dist, shift } = this.frameBoard(polar, azimuth);
    this.viewShift = shift;
    this.applyViewShift();
    this.controls.maxDistance = Math.max(dist * 1.8, 20);
    this.controls.target.set(0, 0, 0);
    if (!animate) {
      this.camera.position.setFromSphericalCoords(dist, polar, azimuth);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.animateCamera(dist, polar, azimuth);
  }

  private animateCamera(radius: number, polar: number, azimuth: number): void {
    this.cameraGoal = null;
    if (prefersReducedMotion()) {
      this.camera.position.setFromSphericalCoords(radius, polar, azimuth);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      this.dirty = true;
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position);
    let dTheta = azimuth - from.theta;
    // Rotate the short way round, but flip sides by turning around the board.
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    // A new camera move replaces one still in flight.
    this.tweens = this.tweens.filter((tw) => !tw.keep);
    this.cameraTween = true;
    this.controls.enabled = false;
    this.tweens.push({
      keep: true,
      start: performance.now(),
      duration: 900,
      step: (t) => {
        const e = easeInOut(t);
        this.camera.position.setFromSphericalCoords(
          from.radius + (radius - from.radius) * e,
          from.phi + (polar - from.phi) * e,
          from.theta + dTheta * e,
        );
        this.camera.lookAt(0, 0, 0);
      },
      done: () => {
        this.cameraTween = false;
        this.controls.enabled = true;
        this.controls.update();
      },
    });
  }

  private pick(clientX: number, clientY: number): Square | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const targets = this.pickTargets;
    targets.length = 0;
    targets.push(this.boardTop);
    for (const p of this.pieces.values()) targets.push(p.mesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object === this.boardTop) return pointToSquare(hit.point.x, hit.point.z);
    return (hit.object.userData.square as Square) ?? null;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.pointerDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private handlePointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    // A drag rotates the camera; only a short, still press counts as a tap.
    if (moved > 8) {
      this.setAdjusted(true);
      return;
    }
    if (performance.now() - down.t > 700) return;
    this.onTap(this.pick(e.clientX, e.clientY));
  };

  private handleWheel = (): void => {
    this.setAdjusted(true);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== "mouse" || this.pointerDown) return;
    cancelAnimationFrame(this.hoverFrame);
    const { clientX, clientY } = e;
    this.hoverFrame = requestAnimationFrame(() => {
      const square = this.pick(clientX, clientY);
      this.canvas.style.cursor = square && this.isInteractive(square) ? "pointer" : "grab";
    });
  };
}
