import type { CameraView } from '../core/models';
import { orbitPan, orbitPinch, orbitRotate, orbitZoom, type OrbitState } from './camera-rig';

export interface ControlTarget {
  /** Camera mode this surface shows (orbit / top react to the mouse; chase and FPV follow the drone). */
  view(): CameraView;
  state(): OrbitState;
  /** Rotation of the model against true north, degrees (the top view pans along north). */
  calRot(): number;
  /** Called on a click (a press and release that barely moved); the caller decides whether a pin is armed. */
  onClick?(clientX: number, clientY: number, alt: boolean): void;
}

interface Pointer {
  x: number;
  y: number;
  x0: number;
  y0: number;
  button: number;
  shift: boolean;
}

/**
 * Mouse / touch navigation for a 3D surface: left-drag orbits, right-drag / shift-drag / any drag in the top view
 * pans, wheel zooms, two-finger pinch zooms. Returns a function that removes the listeners.
 */
export function attachOrbitControls(el: HTMLElement, target: ControlTarget): () => void {
  const pointers = new Map<number, Pointer>();
  let pinch = 0;
  const interactive = (): boolean => target.view() === 'orbit' || target.view() === 'top';

  const down = (e: PointerEvent): void => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, shift: e.shiftKey });
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  };
  const up = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (p && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 5) target.onClick?.(e.clientX, e.clientY, e.altKey);
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  const move = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p || !interactive()) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const st = target.state();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Pointer, Pointer];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      orbitPinch(st, pinch, d);
      pinch = d;
      return;
    }
    const view = target.view();
    if (p.button === 2 || p.shift || view === 'top') orbitPan(st, dx, dy, view, target.calRot());
    else orbitRotate(st, dx, dy);
  };
  const wheel = (e: WheelEvent): void => {
    if (!interactive()) return;
    e.preventDefault();
    orbitZoom(target.state(), e.deltaY);
  };
  const menu = (e: Event): void => e.preventDefault();
  // double-click: hand the view back to the follow (it glides to the drone again)
  const dbl = (): void => {
    if (interactive()) target.state().manual = false;
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointermove', move);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', menu);
  el.addEventListener('dblclick', dbl);
  return () => {
    el.removeEventListener('dblclick', dbl);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', menu);
  };
}
