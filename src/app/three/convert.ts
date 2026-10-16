import * as THREE from 'three';
import type { Quat, Vec3 } from '../core/math3d';

/** Copy a domain vector / quaternion into three.js objects (no allocation). */
export const setVector = (out: THREE.Vector3, v: Vec3): THREE.Vector3 => out.set(v.x, v.y, v.z);
export const setQuaternion = (out: THREE.Quaternion, q: Quat): THREE.Quaternion => out.set(q.x, q.y, q.z, q.w);
