import * as THREE from "three";
import { PALETTE } from "../palette";

/**
 * The iconic Mii Plaza floor: a polar checkerboard radiating from the center,
 * cells alternating white / pale gray, each ring offset half a cell so the
 * pattern reads as diamonds, with a gentle swirl and a fade toward the edge.
 */
function miiPlazaFloorTexture(): THREE.CanvasTexture {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;

  ctx.fillStyle = PALETTE.floorCenter;
  ctx.fillRect(0, 0, size, size);

  const segments = 26;
  const segAngle = (Math.PI * 2) / segments;
  const growth = 1.22;
  let r0 = 14;
  for (let ring = 0; r0 < cx * 1.45; ring++) {
    const r1 = Math.min(r0 * growth + 6, cx * 1.5);
    // Half-cell offset per ring → diamond checker; tiny extra twist → swirl.
    const offset = ring * (segAngle / 2) + ring * 0.025;
    // Contrast fades with distance so the horizon stays calm.
    const t = Math.min(r0 / cx, 1);
    const shade = Math.round(226 + t * 22);
    ctx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 6})`;
    for (let s = 0; s < segments; s++) {
      if (s % 2 === 0) continue;
      const a0 = s * segAngle + offset;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * r0, cx + Math.sin(a0) * r0);
      ctx.arc(cx, cx, r0, a0, a0 + segAngle);
      ctx.lineTo(cx + Math.cos(a0 + segAngle) * r1, cx + Math.sin(a0 + segAngle) * r1);
      ctx.arc(cx, cx, r1, a0 + segAngle, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    r0 = r1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export const FLOOR_RADIUS = 40;

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);

  // Flat white ambient kills harsh contrast — the soft Nintendo-plaza base.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe8f0, 1.15));

  const key = new THREE.DirectionalLight(PALETTE.keyLight, 2.4);
  key.position.set(12, 22, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 28;
  key.shadow.camera.bottom = -28;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-10, 12, -12);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS, 0.1, 96),
    new THREE.MeshStandardMaterial({
      map: miiPlazaFloorTexture(),
      roughness: 0.95,
      metalness: 0,
    }),
  );
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  scene.add(floor);

  return scene;
}
