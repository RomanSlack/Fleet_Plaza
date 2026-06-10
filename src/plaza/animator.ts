import * as THREE from "three";
import { Easing, Tween, type Group as TweenGroup } from "@tweenjs/tween.js";
import { Mii } from "./mii";
import type { ZonePad } from "./zones";

/**
 * Per-frame character driving: wander movement + skeletal Idle/Walking
 * crossfades, busy typing dots, and the spawn/despawn set pieces.
 */
export class MiiAnimator {
  private time = 0;

  constructor(private tweens: TweenGroup) {}

  /** Drop-in "plop": fall, squash, elastic recovery, ground ripple. */
  spawn(mii: Mii, scene: THREE.Scene) {
    mii.visual.position.y = 3;
    new Tween(mii.visual.position, this.tweens)
      .to({ y: 0 }, 350)
      .easing(Easing.Quadratic.In)
      .onComplete(() => {
        this.ripple(mii, scene);
        mii.visual.scale.set(1.35, 0.6, 1.35);
        new Tween(mii.visual.scale, this.tweens)
          .to({ x: 1, y: 1, z: 1 }, 600)
          .easing(Easing.Elastic.Out)
          .start();
      })
      .start();
  }

  /** Despawn "hop & poof": anticipation, happy spin-hop, particle puff. */
  despawn(mii: Mii, scene: THREE.Scene, onDone: () => void) {
    new Tween(mii.visual.scale, this.tweens)
      .to({ x: 1.1, y: 0.85, z: 1.1 }, 120)
      .easing(Easing.Quadratic.Out)
      .onComplete(() => {
        new Tween(mii.visual.position, this.tweens)
          .to({ y: 0.7 }, 250)
          .easing(Easing.Back.Out)
          .start();
        new Tween(mii.visual.rotation, this.tweens)
          .to({ y: Math.PI * 2 }, 250)
          .onComplete(() => {
            mii.visual.visible = false;
            mii.indicator.visible = false;
            this.poof(mii, scene);
            setTimeout(onDone, 700);
          })
          .start();
      })
      .start();
  }

  private ripple(mii: Mii, scene: THREE.Scene) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.02, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(mii.position);
    ring.position.y += 0.03;
    scene.add(ring);
    new Tween({ s: 0.5, o: 0.8 }, this.tweens)
      .to({ s: 2.2, o: 0 }, 500)
      .easing(Easing.Cubic.Out)
      .onUpdate(({ s, o }) => {
        ring.scale.setScalar(s);
        (ring.material as THREE.MeshBasicMaterial).opacity = o;
      })
      .onComplete(() => {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        scene.remove(ring);
      })
      .start();
  }

  private poof(mii: Mii, scene: THREE.Scene) {
    const count = 14;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const puff = new THREE.Group();
    const velocities: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.05, 8, 6), mat);
      p.position.set(
        (Math.random() - 0.5) * 0.3,
        0.5 + Math.random() * 0.4,
        (Math.random() - 0.5) * 0.3,
      );
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          0.8 + Math.random() * 1.2,
          (Math.random() - 0.5) * 2,
        ),
      );
      puff.add(p);
    }
    puff.position.copy(mii.position);
    scene.add(puff);
    new Tween({ t: 0 }, this.tweens)
      .to({ t: 1 }, 650)
      .onUpdate(({ t }) => {
        puff.children.forEach((p, i) => {
          p.position.addScaledVector(velocities[i], 0.016);
          p.scale.setScalar(Math.max(1 - t, 0.01));
        });
        mat.opacity = 0.95 * (1 - t);
      })
      .onComplete(() => {
        puff.children.forEach((p) => (p as THREE.Mesh).geometry.dispose());
        mat.dispose();
        scene.remove(puff);
      })
      .start();
  }

  /** Per-frame: wander, walk/idle crossfade, mixer, typing dots. */
  update(dt: number, miis: Iterable<Mii>, padFor: (mii: Mii) => ZonePad | undefined) {
    this.time += dt;
    for (const mii of miis) {
      const busy = mii.status === "busy";

      // Wandering
      if (mii.walkTarget) {
        const target = mii.walkTarget;
        const dist = Math.hypot(target.x - mii.position.x, target.z - mii.position.z);
        if (dist < 0.05) {
          mii.walkTarget = null;
          mii.nextWanderAt = this.time + 3 + Math.random() * 5;
        } else {
          const step = Math.min(mii.walkSpeed * dt, dist);
          const dx = (target.x - mii.position.x) / dist;
          const dz = (target.z - mii.position.z) / dist;
          mii.position.x += dx * step;
          mii.position.z += dz * step;
          const targetRot = Math.atan2(dx, dz);
          mii.rotation.y = lerpAngle(mii.rotation.y, targetRot, 8 * dt);
        }
      } else if (this.time > mii.nextWanderAt && !busy) {
        const pad = padFor(mii);
        if (pad) {
          mii.walkSpeed = 1.1;
          mii.walkTarget = pad.randomPoint();
        }
      }

      mii.setWalking(mii.walkTarget !== null);
      // Walking clip is authored at normal speed — pace it to actual velocity.
      mii.mixer.timeScale = mii.walkTarget ? mii.walkSpeed / 1.1 : 1;
      mii.mixer.update(dt);

      if (busy && mii.indicator.visible) {
        mii.indicator.children.forEach((dot, i) => {
          dot.position.y = Math.max(0, Math.sin(this.time * 6 - i * 0.5)) * 0.06;
        });
      }
    }
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(t, 1);
}
