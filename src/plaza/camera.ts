import * as THREE from "three";

const PITCH = THREE.MathUtils.degToRad(55);
const MIN_DIST = 8;
const MAX_DIST = 60;
const DRAG_THRESHOLD_PX = 5;

/**
 * Angled top-down rig. The rig's `focus` point pans on XZ; the camera sits at
 * a fixed pitch behind it. Exponential smoothing on both pan and zoom gives
 * the buttery feel. Left-drag and middle-drag pan; wheel zooms; a press that
 * never exceeds the drag threshold fires `onClick` (used for picking).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  onClick: ((ev: PointerEvent) => void) | null = null;
  /** Return true to claim a left press (e.g. drag-from-Mii) — camera ignores it. */
  interceptPress: ((ev: PointerEvent) => boolean) | null = null;

  private focus = new THREE.Vector3(0, 0, 2);
  private targetFocus = this.focus.clone();
  private dist = 27;
  private targetDist = this.dist;

  private dragging = false;
  private dragMoved = false;
  private lastPointer = new THREE.Vector2();
  private keys = new Set<string>();

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      40,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.apply();

    dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 0 && this.interceptPress?.(e)) return;
    this.dragging = true;
    this.dragMoved = false;
    this.lastPointer.set(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    if (
      !this.dragMoved &&
      Math.hypot(
        e.clientX - this.lastPointer.x,
        e.clientY - this.lastPointer.y,
      ) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    this.dragMoved = true;
    this.lastPointer.set(e.clientX, e.clientY);
    // World units per pixel at the focus plane.
    const worldPerPx =
      (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
      window.innerHeight;
    this.targetFocus.x -= dx * worldPerPx;
    this.targetFocus.z -= dy * worldPerPx / Math.sin(PITCH);
    this.clampFocus();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.dragMoved && e.button === 0) this.onClick?.(e);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetDist = THREE.MathUtils.clamp(
      this.targetDist * (e.deltaY > 0 ? 1.1 : 0.9),
      MIN_DIST,
      MAX_DIST,
    );
  };

  private clampFocus() {
    const r = 30;
    this.targetFocus.x = THREE.MathUtils.clamp(this.targetFocus.x, -r, r);
    this.targetFocus.z = THREE.MathUtils.clamp(this.targetFocus.z, -r, r);
  }

  panTo(point: THREE.Vector3) {
    this.targetFocus.set(point.x, 0, point.z + 2);
    this.clampFocus();
  }

  update(dt: number) {
    const panSpeed = this.dist * 0.9 * dt;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp"))
      this.targetFocus.z -= panSpeed;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown"))
      this.targetFocus.z += panSpeed;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft"))
      this.targetFocus.x -= panSpeed;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight"))
      this.targetFocus.x += panSpeed;
    this.clampFocus();

    const k = 1 - Math.exp(-10 * dt);
    this.focus.lerp(this.targetFocus, k);
    this.dist += (this.targetDist - this.dist) * k;
    this.apply();
  }

  private apply() {
    this.camera.position.set(
      this.focus.x,
      this.focus.y + this.dist * Math.sin(PITCH),
      this.focus.z + this.dist * Math.cos(PITCH),
    );
    this.camera.lookAt(this.focus);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}
