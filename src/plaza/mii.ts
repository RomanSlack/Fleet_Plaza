import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { AgentStatus } from "../ipc";

const MODEL_URL = new URL("../assets/simuverse_agent.glb", import.meta.url).href;
const TARGET_HEIGHT = 1.05;

let template: {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  scale: number;
} | null = null;

/** Load the SimuVerse agent once before any Mii is constructed. */
export async function loadAgentModel(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const height = Math.max(box.max.y - box.min.y, 0.01);
  // Mixamo walk clips can carry root motion (hips translate forward, then
  // snap back each loop). Movement is ours; strip the hips position track.
  const walk = THREE.AnimationClip.findByName(gltf.animations, "Walking");
  if (walk) {
    walk.tracks = walk.tracks.filter(
      (t) => !(t.name.toLowerCase().includes("hips") && t.name.endsWith(".position")),
    );
  }
  template = {
    scene: gltf.scene,
    clips: gltf.animations,
    scale: TARGET_HEIGHT / height,
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * A little plaza citizen — the SimuVerse chibi agent, tinted per name.
 * The root moves/turns; animation offsets (plop squash, hop) go on `visual`
 * so movement stays clean. Skeletal Idle/Walking clips run via the mixer.
 */
export class Mii extends THREE.Group {
  readonly agentName: string;
  readonly visual = new THREE.Group();
  readonly shirtColor: THREE.Color;
  readonly indicator: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private walking = false;
  private plate: CSS2DObject;
  private plateDot: HTMLElement;
  private plateStatus: AgentStatus | null = null;
  private hintEl: HTMLElement;
  private nameText!: HTMLElement;

  // Wander state, driven by animator.update()
  walkTarget: THREE.Vector3 | null = null;
  walkSpeed = 1.1;
  walkPhase = 0;
  nextWanderAt = 0;
  status: AgentStatus = "spawning";

  constructor(name: string) {
    super();
    if (!template) throw new Error("loadAgentModel() must resolve first");
    this.agentName = name;
    const h = hashString(name);
    this.shirtColor = new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.55);

    const model = SkeletonUtils.clone(template.scene);
    model.scale.setScalar(template.scale);
    const hue = (h % 360) / 360;
    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        const mats = (
          Array.isArray(obj.material) ? obj.material : [obj.material]
        ) as THREE.MeshStandardMaterial[];
        const tinted = mats.map((m) => {
          const clone = m.clone();
          const hsl = { h: 0, s: 0, l: 0 };
          clone.color.getHSL(hsl);
          // Tint saturated (body/skin) materials; leave whites (eyes/brows).
          if (hsl.s > 0.2) clone.color.setHSL(hue, hsl.s, hsl.l);
          return clone;
        });
        obj.material = Array.isArray(obj.material) ? tinted : tinted[0];
      }
    });
    this.visual.add(model);
    this.add(this.visual);

    this.mixer = new THREE.AnimationMixer(model);
    const idleClip = THREE.AnimationClip.findByName(template.clips, "Idle");
    const walkClip = THREE.AnimationClip.findByName(template.clips, "Walking");
    if (idleClip) {
      this.idleAction = this.mixer.clipAction(idleClip);
      // De-sync the crowd.
      this.idleAction.time = (h % 100) / 100;
      this.idleAction.play();
    }
    if (walkClip) this.walkAction = this.mixer.clipAction(walkClip);

    // Typing-dots "…" bubble shown while busy.
    this.indicator = buildTypingDots();
    this.indicator.position.y = TARGET_HEIGHT + 0.22;
    this.indicator.visible = false;
    this.add(this.indicator);

    // Nameplate: white pill with a status dot, crisp DOM via CSS2D.
    const el = document.createElement("div");
    el.className = "nameplate";
    this.plateDot = document.createElement("span");
    this.plateDot.className = "status-dot";
    const text = document.createElement("span");
    text.textContent = name;
    this.nameText = text;
    this.hintEl = document.createElement("span");
    this.hintEl.className = "plate-hint";
    this.hintEl.style.display = "none";
    el.append(this.plateDot, text, this.hintEl);
    this.plate = new CSS2DObject(el);
    this.plate.position.set(0, TARGET_HEIGHT + 0.45, 0);
    this.add(this.plate);

    // Subtle per-agent size variation.
    const s = 0.92 + (h % 17) / 100;
    this.scale.setScalar(s);
  }

  setWalking(walking: boolean) {
    if (walking === this.walking) return;
    this.walking = walking;
    const fadeIn = walking ? this.walkAction : this.idleAction;
    const fadeOut = walking ? this.idleAction : this.walkAction;
    if (fadeIn && fadeOut) {
      fadeIn.enabled = true;
      fadeIn.reset().play().crossFadeFrom(fadeOut, 0.22, false);
    }
  }

  setHint(text: string | null) {
    this.hintEl.style.display = text ? "" : "none";
    this.hintEl.textContent = text ?? "";
  }

  /** External = a Claude instance running outside Fleet-managed tmux. */
  setExternal(external: boolean) {
    this.plate.element.classList.toggle("external", external);
  }

  /** Display name only — real identity stays in `agentName`. */
  setDisplayName(text: string) {
    this.nameText.textContent = text;
  }

  setStatus(status: AgentStatus) {
    if (status === this.plateStatus) return;
    this.plateStatus = status;
    this.status = status;
    this.plateDot.dataset.status = status;
    this.indicator.visible = status === "busy";
  }

  dispose() {
    this.plate.element.remove();
    this.removeFromParent();
    this.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material !== undefined) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

function buildTypingDots(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dotGeo = new THREE.SphereGeometry(0.035, 10, 8);
  for (let i = 0; i < 3; i++) {
    const dot = new THREE.Mesh(dotGeo, mat);
    dot.position.x = (i - 1) * 0.11;
    group.add(dot);
  }
  return group;
}
