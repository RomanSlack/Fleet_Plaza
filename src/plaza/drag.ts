import * as THREE from "three";
import { Mii } from "./mii";
import { ZonePad } from "./zones";
import { PALETTE } from "../palette";

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const DRAG_THRESHOLD_PX = 6;

/**
 * Press on a Mii → either a click (open panel) or a drag: a blue line from
 * the character to the cursor; release over a pad assigns the agent there.
 * The CameraRig defers to this controller for presses that start on a Mii.
 */
export class DragController {
  onPick: ((mii: Mii) => void) | null = null;
  onAssign: ((mii: Mii, zoneId: string) => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private active: Mii | null = null;
  private moved = false;
  private startPx = new THREE.Vector2();
  private line: THREE.Line;
  private marker: THREE.Mesh;
  private hoverPad: ZonePad | null = null;

  constructor(
    private camera: THREE.Camera,
    scene: THREE.Scene,
    private getMiis: () => Iterable<Mii>,
    private getPads: () => Iterable<ZonePad>,
  ) {
    // Drawn on top of everything — the affordance must never clip into pads.
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]),
      new THREE.LineBasicMaterial({
        color: PALETTE.busy,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.line.frustumCulled = false;
    this.line.renderOrder = 999;
    this.line.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({
        color: PALETTE.busy,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    scene.add(this.line, this.marker);

    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  /** Returns true if this press starts on a Mii (camera should ignore it). */
  tryStartPress(ev: PointerEvent): boolean {
    if (ev.button !== 0) return false;
    const mii = this.pickMii(ev);
    if (!mii) return false;
    this.active = mii;
    this.moved = false;
    this.startPx.set(ev.clientX, ev.clientY);
    return true;
  }

  private pointerRay(ev: PointerEvent) {
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        (ev.clientX / window.innerWidth) * 2 - 1,
        -(ev.clientY / window.innerHeight) * 2 + 1,
      ),
      this.camera,
    );
    return this.raycaster;
  }

  private pickMii(ev: PointerEvent): Mii | null {
    const hits = this.pointerRay(ev).intersectObjects([...this.getMiis()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (node instanceof Mii) return node;
        node = node.parent;
      }
    }
    return null;
  }

  private pickPad(ev: PointerEvent): ZonePad | null {
    const hits = this.pointerRay(ev).intersectObjects([...this.getPads()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (node instanceof ZonePad) return node;
        node = node.parent;
      }
    }
    return null;
  }

  private onMove = (ev: PointerEvent) => {
    if (!this.active) return;
    if (
      !this.moved &&
      Math.hypot(ev.clientX - this.startPx.x, ev.clientY - this.startPx.y) <
        DRAG_THRESHOLD_PX
    ) {
      return;
    }
    this.moved = true;

    const ground = new THREE.Vector3();
    this.pointerRay(ev).ray.intersectPlane(GROUND, ground);
    if (!ground) return;

    const pad = this.pickPad(ev);
    if (pad !== this.hoverPad) {
      this.hoverPad?.setHighlight(false);
      this.hoverPad = pad && pad.zoneId !== "visitors" ? pad : null;
      this.hoverPad?.setHighlight(true);
    }

    // Sit the marker on the pad surface when hovering one.
    const surfaceY = pad ? pad.position.y + pad.padTopY() + 0.04 : 0.06;
    const from = this.active.position.clone().setY(0.55);
    this.line.geometry.setFromPoints([from, ground.clone().setY(surfaceY)]);
    this.line.visible = true;
    this.marker.position.copy(ground).setY(surfaceY);
    this.marker.visible = true;
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.active) return;
    const mii = this.active;
    const wasDrag = this.moved;
    const pad = this.hoverPad;
    this.active = null;
    this.moved = false;
    this.line.visible = false;
    this.marker.visible = false;
    this.hoverPad?.setHighlight(false);
    this.hoverPad = null;

    if (!wasDrag) {
      this.onPick?.(mii);
    } else if (pad) {
      this.onAssign?.(mii, pad.zoneId);
    }
    void ev;
  };
}
