import * as THREE from 'three';
import type { CameraView, Flight } from '../core/models';
import type { Quat, Vec3 } from '../core/math3d';
import type { DroneState } from '../core/sim/drone-physics';
import { setQuaternion, setVector } from './convert';

export interface RigContext {
  /** True when the camera follows the replayed drone instead of the simulator drone. */
  followingReplay: boolean;
  flight: Flight | null;
  simPosition: Vec3;
  replayPosition: Vec3;
}

/**
 * The two drones in the scene: the simulator drone (small black/orange quad with a glowing beacon so it can be found
 * from far away) and the replay "ghost" (a white arrow for GPS-only logs, a copy of the quad when attitude is known).
 * Both are scaled with distance so they stay visible from the whole-site view.
 */
export class DroneRig {
  readonly sim = new THREE.Group();
  readonly ghost = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly beacon: THREE.Sprite;
  private readonly props: THREE.Mesh[] = [];
  private readonly cone: THREE.Mesh;
  private readonly ghostBody: THREE.Group;

  constructor(scene: THREE.Scene) {
    const dark = new THREE.MeshBasicMaterial({ color: '#222' });
    const orange = new THREE.MeshBasicMaterial({ color: '#ff7a1a' });
    this.body.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), dark));
    for (const s of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.018), dark);
      arm.rotation.y = (s * Math.PI) / 4;
      this.body.add(arm);
    }
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.004, 10), new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.55 }));
      p.position.set(x * 0.13, 0.02, z * 0.13);
      this.body.add(p);
      this.props.push(p);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.03), orange);
    nose.position.set(0, 0.02, -0.08);
    this.body.add(nose);

    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      r.addColorStop(0, '#fff');
      r.addColorStop(0.3, '#ffb35a');
      r.addColorStop(1, '#ff7a1a00');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    this.sim.add(this.body, this.beacon);
    scene.add(this.sim);

    this.cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.ghostBody = this.body.clone();
    this.ghostBody.scale.setScalar(4);
    this.ghost.add(this.cone, this.ghostBody);
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  /** Move the simulator drone to its physics state; props spin while armed. */
  syncSim(state: DroneState, dt: number): void {
    setVector(this.sim.position, state.p);
    setQuaternion(this.sim.quaternion, state.q);
    if (state.armed) for (const p of this.props) p.rotation.y += dt * 80;
  }

  syncGhost(position: Vec3, orientation: Quat, flight: Flight | null): void {
    this.ghost.visible = !!flight;
    if (!flight) return;
    const hasAttitude = !!(flight.tel || flight.att);
    this.cone.visible = !hasAttitude;
    this.ghostBody.visible = hasAttitude;
    setVector(this.ghost.position, position);
    setQuaternion(this.ghost.quaternion, orientation);
  }

  /** Per camera, before rendering: visibility and distance-dependent scale. */
  prepare(camera: THREE.Camera, view: CameraView, ctx: RigContext): void {
    const dist = camera.position.distanceTo(setVector(TMP, ctx.simPosition));
    const gdist = camera.position.distanceTo(setVector(TMP, ctx.replayPosition));
    // when the camera sits inside a drone (FPV), that drone is not drawn
    this.body.visible = this.beacon.visible = view !== 'fpv' || ctx.followingReplay;
    this.ghost.visible = !!ctx.flight && !(view === 'fpv' && ctx.followingReplay);
    this.body.scale.setScalar(view === 'chase' ? 3 : Math.max(1, dist * 0.02));
    this.beacon.scale.setScalar(Math.max(0.5, dist * 0.035));
    this.ghost.scale.setScalar(Math.max(1, gdist * 0.012));
  }
}

const TMP = new THREE.Vector3();
