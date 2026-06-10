import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ProjectZone } from "../ipc";
import { PALETTE } from "../palette";

const PAD_WIDTH = 7;
const PAD_DEPTH = 5.5;
const PAD_HEIGHT = 0.12;
const RIM_OVERHANG = 0.12;
const CORNER_RADIUS = 0.8;
const RING_RADIUS = 11;

function roundedRectShape(w: number, d: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// Subtle paper-grain texture for pad tops — speckle + soft sheen, tiling.
let grainTexture: THREE.CanvasTexture | null = null;
function padGrain(): THREE.CanvasTexture {
  if (grainTexture) return grainTexture;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fcfdfe";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const shade = 200 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${shade - 20}, ${shade - 8}, ${shade}, ${0.05 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
  }
  const sheen = ctx.createLinearGradient(0, 0, size, size);
  sheen.addColorStop(0, "rgba(255,255,255,0.05)");
  sheen.addColorStop(0.5, "rgba(225,232,240,0.05)");
  sheen.addColorStop(1, "rgba(255,255,255,0.05)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);
  grainTexture = new THREE.CanvasTexture(canvas);
  grainTexture.colorSpace = THREE.SRGBColorSpace;
  grainTexture.wrapS = grainTexture.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry UVs are in shape units — tile the grain every ~1.6m.
  grainTexture.repeat.set(0.6, 0.6);
  grainTexture.anisotropy = 4;
  return grainTexture;
}

function padMesh(
  w: number,
  d: number,
  h: number,
  color: THREE.ColorRepresentation,
  textured = false,
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, d, CORNER_RADIUS), {
    depth: h,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2); // extrude along +Y instead of +Z
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: textured ? 0.78 : 0.85,
      map: textured ? padGrain() : null,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A project's platform: white top on a dark-blue rim, name sign, wander bounds. */
export class ZonePad extends THREE.Group {
  readonly zoneId: string;
  readonly zone: ProjectZone;
  private label: CSS2DObject;
  private labelEl!: HTMLElement;
  private rimMat: THREE.MeshStandardMaterial;

  constructor(zone: ProjectZone) {
    super();
    this.zoneId = zone.id;
    this.zone = zone;

    const rim = padMesh(
      PAD_WIDTH + RIM_OVERHANG * 2,
      PAD_DEPTH + RIM_OVERHANG * 2,
      PAD_HEIGHT * 0.6,
      zone.color || PALETTE.accent,
    );
    this.rimMat = rim.material as THREE.MeshStandardMaterial;
    const top = padMesh(PAD_WIDTH, PAD_DEPTH, PAD_HEIGHT, PALETTE.padTop, true);
    top.position.y = PAD_HEIGHT * 0.35;
    this.add(rim, top);

    const el = document.createElement("div");
    el.className = "zone-label";
    el.textContent = zone.name;
    this.labelEl = el;
    this.label = new CSS2DObject(el);
    this.label.position.set(0, 0.6, -PAD_DEPTH / 2 - 0.4);
    this.add(this.label);
  }

  /** Random wander target inside the pad, in world space. */
  randomPoint(): THREE.Vector3 {
    const inset = 0.7;
    return new THREE.Vector3(
      this.position.x + (Math.random() - 0.5) * (PAD_WIDTH - inset * 2),
      this.padTopY(),
      this.position.z + (Math.random() - 0.5) * (PAD_DEPTH - inset * 2),
    );
  }

  /** Deterministic home position for an agent slot (grid across the pad). */
  slotPoint(slot: number): THREE.Vector3 {
    const cols = 3;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    return new THREE.Vector3(
      this.position.x + (col - 1) * 1.9,
      this.padTopY(),
      this.position.z + (row - 0.5) * 1.7,
    );
  }

  padTopY(): number {
    return PAD_HEIGHT * 0.35 + PAD_HEIGHT;
  }

  /** Display name only — real identity stays in `zone`. */
  setDisplayName(text: string) {
    this.labelEl.textContent = text;
  }

  /** Drop-target feedback while a Mii is being dragged over this pad. */
  setHighlight(on: boolean) {
    this.rimMat.emissive.set(on ? PALETTE.busy : 0x000000);
    this.rimMat.emissiveIntensity = on ? 0.55 : 0;
    this.scale.setScalar(on ? 1.03 : 1);
  }

  dispose() {
    this.label.element.remove();
    this.removeFromParent();
  }
}

/** The commons: where visitors (agents in unregistered dirs) hang out. */
export function commonsZone(): ProjectZone {
  return { id: "visitors", name: "Visitors", path: "", color: "#8da4b8" };
}

/** Lay pads out on a ring around the commons; commons stays at origin. */
export function layoutZones(pads: Map<string, ZonePad>) {
  const ringPads = [...pads.values()].filter((p) => p.zoneId !== "visitors");
  const commons = pads.get("visitors");
  if (commons) commons.position.set(0, 0, 0);
  const n = ringPads.length;
  ringPads.forEach((pad, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    pad.position.set(
      Math.cos(angle) * RING_RADIUS,
      0,
      Math.sin(angle) * RING_RADIUS,
    );
    pad.rotation.y = 0;
  });
}
