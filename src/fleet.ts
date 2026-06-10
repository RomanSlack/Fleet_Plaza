import * as THREE from "three";
import type { Group as TweenGroup } from "@tweenjs/tween.js";
import type { AgentState, AppConfig, ProjectZone, Snapshot } from "./ipc";
import { MiiAnimator } from "./plaza/animator";
import { Mii } from "./plaza/mii";
import { commonsZone, layoutZones, ZonePad } from "./plaza/zones";
import { agentAlias, zoneAlias } from "./ui/anon";

/**
 * Owns the live mapping snapshot → 3D objects: zone pads from config,
 * one Mii per agent, spawn/despawn animations on diff.
 */
export class FleetView {
  readonly miis = new Map<string, Mii>();
  readonly pads = new Map<string, ZonePad>();
  readonly agents = new Map<string, AgentState>();
  /** Visual-only characters waiting to be dragged onto a project. */
  readonly recruits = new Map<string, Mii>();
  readonly animator: MiiAnimator;
  private dying = new Set<string>();
  /** Recruits walking to a pad; the real session spawns on arrival. */
  private walkingRecruits = new Map<string, string>();
  onAgentsChanged: (() => void) | null = null;
  onRecruitArrived: ((name: string, zoneId: string) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    tweens: TweenGroup,
  ) {
    this.animator = new MiiAnimator(tweens);
  }

  private registered: ProjectZone[] = [];
  private autoZones: ProjectZone[] = [];
  private anonymous = false;

  setZones(config: AppConfig) {
    this.registered = config.projects;
    this.rebuildPads();
  }

  /** Ephemeral pads for unregistered dirs agents are running in. */
  private syncAutoZones(zones: ProjectZone[]) {
    const incoming = zones.map((z) => z.id).join("|");
    const current = this.autoZones.map((z) => z.id).join("|");
    if (incoming === current) return;
    this.autoZones = zones;
    this.rebuildPads();
  }

  private rebuildPads() {
    for (const pad of this.pads.values()) pad.dispose();
    this.pads.clear();
    for (const zone of [commonsZone(), ...this.registered, ...this.autoZones]) {
      const pad = new ZonePad(zone);
      if (this.anonymous) pad.setDisplayName(zoneAlias(zone.name));
      this.pads.set(zone.id, pad);
      this.scene.add(pad);
    }
    layoutZones(this.pads);
    // Re-place existing agents onto the rebuilt pads.
    for (const agent of this.agents.values()) this.placeAgent(agent, false);
  }

  /** Screenshot-safe mode: alias every visible agent and project name. */
  setAnonymous(on: boolean) {
    this.anonymous = on;
    for (const [name, mii] of [...this.miis, ...this.recruits]) {
      mii.setDisplayName(on ? agentAlias(name) : name);
    }
    for (const pad of this.pads.values()) {
      pad.setDisplayName(on ? zoneAlias(pad.zone.name) : pad.zone.name);
    }
  }

  applySnapshot(snap: Snapshot) {
    this.syncAutoZones(snap.zones);
    const liveNames = new Set(snap.agents.map((a) => a.name));

    for (const [name, mii] of this.miis) {
      if (liveNames.has(name) || this.dying.has(name)) continue;
      this.dying.add(name);
      this.animator.despawn(mii, this.scene, () => {
        mii.dispose();
        this.miis.delete(name);
        this.dying.delete(name);
      });
      this.agents.delete(name);
    }

    for (const agent of snap.agents) {
      let mii = this.miis.get(agent.name);
      const prev = this.agents.get(agent.name);
      const recruit = this.recruits.get(agent.name);
      if (recruit) {
        // The recruit becomes the real agent — already standing there, no plop.
        this.recruits.delete(agent.name);
        this.walkingRecruits.delete(agent.name);
        recruit.setHint(null);
        this.miis.set(agent.name, recruit);
        mii = recruit;
      }
      if (!mii) {
        mii = new Mii(agent.name);
        if (this.anonymous) mii.setDisplayName(agentAlias(agent.name));
        this.miis.set(agent.name, mii);
        this.scene.add(mii);
        this.placeAgent(agent, false);
        this.animator.spawn(mii, this.scene);
      } else if (!prev || prev.zone_id !== agent.zone_id || prev.slot !== agent.slot) {
        this.placeAgent(agent, true);
      }
      mii.setStatus(agent.status);
      mii.setExternal(agent.source === "external");
      this.agents.set(agent.name, agent);
    }

    this.onAgentsChanged?.();
  }

  /** Drop a fresh recruit in the commons, waiting to be dragged to a project. */
  addRecruit(name: string): Mii {
    const mii = new Mii(name);
    if (this.anonymous) mii.setDisplayName(agentAlias(name));
    mii.setStatus("stale");
    mii.setHint("drag me to a project");
    const commons = this.pads.get("visitors");
    const point = commons ? commons.randomPoint() : new THREE.Vector3();
    mii.position.copy(point);
    this.recruits.set(name, mii);
    this.scene.add(mii);
    this.animator.spawn(mii, this.scene);
    return mii;
  }

  /** Recruit was dropped on a pad: jog over, spawn the real session on arrival. */
  assignRecruit(name: string, zoneId: string) {
    const mii = this.recruits.get(name);
    const pad = this.pads.get(zoneId);
    if (!mii || !pad) return;
    mii.setHint("heading over…");
    mii.walkSpeed = 3.2;
    mii.walkTarget = pad.randomPoint();
    this.walkingRecruits.set(name, zoneId);
  }

  removeRecruit(name: string) {
    const mii = this.recruits.get(name);
    if (!mii) return;
    this.recruits.delete(name);
    this.walkingRecruits.delete(name);
    this.animator.despawn(mii, this.scene, () => mii.dispose());
  }

  private placeAgent(agent: AgentState, walk: boolean) {
    const mii = this.miis.get(agent.name);
    const pad = this.pads.get(agent.zone_id) ?? this.pads.get("visitors");
    if (!mii || !pad) return;
    const point = pad.slotPoint(agent.slot);
    if (walk) {
      mii.walkTarget = point;
    } else {
      mii.position.copy(point);
      mii.rotation.y = Math.random() * Math.PI * 2;
    }
  }

  padForMii = (mii: Mii): ZonePad | undefined => {
    const agent = this.agents.get(mii.agentName);
    return agent
      ? this.pads.get(agent.zone_id) ?? this.pads.get("visitors")
      : undefined;
  };

  update(dt: number) {
    this.animator.update(
      dt,
      [...this.miis.values(), ...this.recruits.values()],
      this.padForMii,
    );

    // Recruits that reached their pad: fire the real spawn (once).
    for (const [name, zoneId] of this.walkingRecruits) {
      const mii = this.recruits.get(name);
      if (mii && mii.walkTarget === null) {
        this.walkingRecruits.delete(name);
        mii.setHint("booting claude…");
        mii.setStatus("spawning");
        this.onRecruitArrived?.(name, zoneId);
      }
    }
  }
}
