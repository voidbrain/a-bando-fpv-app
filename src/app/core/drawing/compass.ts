import { COLORS, TAU, scoped } from './canvas-util';

export const COMPASS_SIZE = 150;

export interface CompassInput {
  /** Rotation of the model against true north, degrees (model-axis angle). */
  calRot: number;
  /** Angle of "screen up" in model axes, radians (see {@link cameraUpAngle}). */
  cameraUp: number;
  /** Geographic heading of the drone in radians, shown as an orange pointer. */
  droneHeading: number;
}

/** Angle of the camera's up direction in the model's XZ plane: tells the compass how the map is turned on screen. */
export function cameraUpAngle(view: 'orbit' | 'chase' | 'fpv' | 'top', up: { x: number; z: number }, forward: { x: number; z: number }): number {
  return view === 'top' ? Math.atan2(up.x, -up.z) : Math.atan2(forward.x, -forward.z);
}

/**
 * "Map north" compass: shows where true north lies relative to what the camera sees, with a little icon of the
 * buildings (sheds, annex, greenhouse) as seen from the camera, plus the drone heading.
 */
export function drawCompass(g: CanvasRenderingContext2D, { calRot, cameraUp, droneHeading }: CompassInput): void {
  scoped(g, () => {
    const A = (calRot * Math.PI) / 180;
    const phi = A - cameraUp;
    const R = 62;
    g.clearRect(0, 0, COMPASS_SIZE, COMPASS_SIZE);
    g.translate(75, 75);
    scoped(g, () => {
      g.rotate(-cameraUp);
      g.fillStyle = 'rgba(192,96,58,.6)';
      g.fillRect(-7, -24, 14, 48);
      g.fillStyle = 'rgba(232,160,122,.6)';
      g.fillRect(-20, -24, 13, 8);
      g.fillStyle = 'rgba(158,193,182,.6)';
      g.fillRect(-34, -24, 14, 8);
    });
    g.strokeStyle = '#6b7f74';
    g.fillStyle = COLORS.text;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.stroke();
    g.rotate(phi);
    for (let d = 0; d < 360; d += 10) {
      scoped(g, () => {
        g.rotate((d * Math.PI) / 180);
        g.beginPath();
        g.moveTo(0, -R);
        g.lineTo(0, -R + (d % 90 === 0 ? 10 : d % 30 === 0 ? 7 : 4));
        g.stroke();
      });
    }
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const letters: readonly (readonly [string, number, string])[] = [['N', 0, '#ff5a4d'], ['E', 90, COLORS.text], ['S', 180, COLORS.text], ['W', 270, COLORS.text]];
    for (const [t, d, c] of letters) {
      scoped(g, () => {
        g.rotate((d * Math.PI) / 180);
        g.translate(0, -R + 19);
        g.rotate((-d * Math.PI) / 180 - phi);
        g.fillStyle = c;
        g.fillText(t, 0, 0);
      });
    }
    scoped(g, () => {
      g.rotate(droneHeading);
      g.fillStyle = COLORS.orange;
      g.strokeStyle = COLORS.orange;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(0, -R - 1);
      g.lineTo(-5, -R + 11);
      g.lineTo(5, -R + 11);
      g.fill();
      g.beginPath();
      g.moveTo(0, -R + 11);
      g.lineTo(0, -8);
      g.stroke();
    });
    g.fillStyle = '#ff5a4d';
    g.beginPath();
    g.moveTo(0, -R + 30);
    g.lineTo(-5, 0);
    g.lineTo(5, 0);
    g.fill();
    g.fillStyle = COLORS.ring;
    g.beginPath();
    g.moveTo(0, R - 30);
    g.lineTo(-5, 0);
    g.lineTo(5, 0);
    g.fill();
  });
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(75, 14);
  g.lineTo(70, 5);
  g.lineTo(80, 5);
  g.fill();
}
