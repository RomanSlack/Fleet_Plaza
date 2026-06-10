import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Group as TweenGroup } from "@tweenjs/tween.js";
import { createScene } from "./plaza/scene";
import { CameraRig } from "./plaza/camera";
import { DragController } from "./plaza/drag";
import { FleetView } from "./fleet";
import { loadAgentModel } from "./plaza/mii";
import { ZonePad } from "./plaza/zones";
import {
  addProject,
  getConfig,
  getSnapshot,
  onSnapshot,
  sendTask,
  spawnAgent,
  suggestName,
  type AppConfig,
  type Snapshot,
} from "./ipc";
import { TopBar } from "./ui/topbar";
import { AgentPanel } from "./ui/agent_panel";
import {
  openConfirm,
  openProjectsDialog,
  openSpawnDialog,
  openTaskDialog,
} from "./ui/dialogs";
import { PALETTE } from "./palette";

const app = document.getElementById("app")!;

// Surface runtime errors on screen (no devtools in the webview).
window.addEventListener("error", (e) => {
  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:9999;background:#d2543e;color:#fff;" +
    "font:12px monospace;padding:6px 10px;border-radius:8px;max-width:90vw;";
  badge.textContent = `JS error: ${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`;
  document.body.appendChild(badge);
});
window.addEventListener("unhandledrejection", (e) => {
  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;bottom:40px;left:8px;z-index:9999;background:#b0413e;color:#fff;" +
    "font:12px monospace;padding:6px 10px;border-radius:8px;max-width:90vw;";
  badge.textContent = `Unhandled rejection: ${e.reason}`;
  document.body.appendChild(badge);
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
app.appendChild(renderer.domElement);

// DOM-based nameplates/status pills live in a CSS2D overlay.
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = "fixed";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
app.appendChild(labelRenderer.domElement);

const tweens = new TweenGroup();
const scene = createScene();
const rig = new CameraRig(renderer.domElement);
const fleet = new FleetView(scene, tweens);

// ---------- UI ----------

let config: AppConfig = { projects: [], claude_args: [] };
const panel = new AgentPanel();
panel.onAssign = (name) => openTaskDialog(name);

// First task typed in the spawn dialog: sent once the agent reports idle.
const pendingTasks = new Map<string, string>();

// "+ Spawn Agent" drops a recruit in the commons — drag them to a project.
let anonymous = false;
const topbar = new TopBar(
  async () => {
    fleet.addRecruit(await suggestName());
  },
  () => {
    openProjectsDialog(config, (updated) => {
      config = updated;
      fleet.setZones(updated);
    });
  },
  () => {
    anonymous = !anonymous;
    fleet.setAnonymous(anonymous);
    panel.setAnonymous(anonymous);
    return anonymous;
  },
);

function handleSnapshot(snap: Snapshot) {
  fleet.applySnapshot(snap);
  topbar.update(snap);
  for (const agent of snap.agents) {
    if (agent.name === panel.current) panel.update(agent);
    const pending = pendingTasks.get(agent.name);
    if (pending && agent.status === "idle") {
      pendingTasks.delete(agent.name);
      sendTask(agent.name, pending);
    }
  }
  if (panel.current && !snap.agents.some((a) => a.name === panel.current)) {
    panel.close();
  }
}

async function bootstrap() {
  // Characters need the model; everything else can wait the few ms it takes.
  await loadAgentModel();
  config = await getConfig();
  fleet.setZones(config);
  onSnapshot(handleSnapshot);
  // Pull current state immediately — events only fire on change.
  const snap = await getSnapshot();
  if (snap) handleSnapshot(snap);
}
bootstrap();


// ---------- Picking & drag-to-assign ----------

const drag = new DragController(
  rig.camera,
  scene,
  () => [...fleet.miis.values(), ...fleet.recruits.values()],
  () => fleet.pads.values(),
);
rig.interceptPress = (ev) => drag.tryStartPress(ev);

// Pulsing ring under the selected character.
const selectionRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.035, 8, 36),
  new THREE.MeshBasicMaterial({
    color: PALETTE.busy,
    transparent: true,
    opacity: 0.85,
  }),
);
selectionRing.rotation.x = -Math.PI / 2;
selectionRing.position.y = 0.06;
selectionRing.visible = false;

drag.onPick = (mii) => {
  const agent = fleet.agents.get(mii.agentName);
  if (agent) {
    panel.open(agent);
    rig.panTo(mii.position);
    mii.add(selectionRing);
    selectionRing.visible = true;
  }
};

panel.onClosed = () => {
  selectionRing.visible = false;
  selectionRing.removeFromParent();
};

// Auto pads (unregistered dirs) must be registered before we can spawn there.
async function ensureRegistered(pad: ZonePad): Promise<string | null> {
  const zone = pad.zone;
  if (!zone.auto) return zone.id;
  const ok = await openConfirm(
    `Register ${zone.name}?`,
    `Add ${zone.path} as a permanent project pad.`,
    "Register",
  );
  if (!ok) return null;
  try {
    const updated = await addProject(zone.path, zone.name, zone.color);
    config = updated;
    fleet.setZones(updated);
    return updated.projects.find((p) => p.path === zone.path)?.id ?? null;
  } catch {
    return null;
  }
}

drag.onAssign = async (mii, zoneId) => {
  const name = mii.agentName;
  const pad = fleet.pads.get(zoneId);
  if (!pad) return;
  if (fleet.recruits.has(name)) {
    // Recruits actually join the project: walk over, claude boots there.
    const targetId = await ensureRegistered(pad);
    if (targetId) fleet.assignRecruit(name, targetId);
    return;
  }
  const agent = fleet.agents.get(name);
  if (!agent || agent.source === "external") return;
  // Existing agents stay put — the drop scopes a task to that project.
  openTaskDialog(name, pad.zone);
};

fleet.onRecruitArrived = async (name, zoneId) => {
  try {
    await spawnAgent(zoneId, name);
  } catch {
    fleet.removeRecruit(name);
  }
};

// Plain click on a pad (not a drag) → classic spawn dialog for that project.
rig.onClick = (ev) => {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (ev.clientX / window.innerWidth) * 2 - 1,
      -(ev.clientY / window.innerHeight) * 2 + 1,
    ),
    rig.camera,
  );
  const hits = raycaster.intersectObjects([...fleet.pads.values()], true);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      if (node instanceof ZonePad) {
        if (node.zoneId !== "visitors") {
          const pad = node;
          ensureRegistered(pad).then((id) => {
            if (!id) return;
            openSpawnDialog(config, id, (name, initialTask) => {
              if (initialTask) pendingTasks.set(name, initialTask);
            });
          });
        }
        return;
      }
      node = node.parent;
    }
  }
  panel.close();
};

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});


// Soft vignette framing the plaza.
const vignette = document.createElement("div");
vignette.style.cssText =
  "position:fixed;inset:0;pointer-events:none;" +
  "background:radial-gradient(ellipse at center, transparent 58%, rgba(20,35,50,0.10) 100%)";
document.body.appendChild(vignette);

let last = performance.now();
renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - last) / 1000, 0.1);
  last = time;
  tweens.update(time);
  fleet.update(dt);
  rig.update(dt);
  if (selectionRing.visible) {
    selectionRing.scale.setScalar(1 + Math.sin(time / 320) * 0.08);
  }
  renderer.render(scene, rig.camera);
  labelRenderer.render(scene, rig.camera);
});
