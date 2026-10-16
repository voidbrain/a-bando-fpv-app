import { Injectable, inject } from '@angular/core';
import { CALIBRATION_CORNERS } from '../core/constants';
import { solveCalibration } from '../core/geo';
import { toLocal } from '../core/geo';
import { SITE_DIMS } from '../core/site-dims';
import { CalibrationStore } from '../state/calibration.store';
import { FlightService } from './flight.service';
import { ToastService } from './toast.service';

export interface CornerInput {
  lat: number;
  lon: number;
}

/** Higher-level alignment operations that need the flights as well as the calibration. */
@Injectable({ providedIn: 'root' })
export class CalibrationService {
  private readonly store = inject(CalibrationStore);
  private readonly flights = inject(FlightService);
  private readonly toast = inject(ToastService);

  /**
   * Set the rotation (degrees, wrapped to [-180, 180)). The active flight turns about its own midpoint instead of the
   * map origin, so it does not swing away from where it was placed.
   */
  setRotation(deg: number): void {
    const rot = (((deg + 540) % 360) + 360) % 360 - 180;
    const f = this.flights.active;
    const mid = f?.pts[(f.pts.length / 2) | 0];
    const before = mid ? toLocal(mid.lat, mid.lon, this.store.calibration()) : null;
    this.store.setRot(rot);
    if (mid && before) {
      const after = toLocal(mid.lat, mid.lon, this.store.calibration());
      this.store.shift(before[0] - after[0], before[1] - after[1]);
    }
  }

  rotateBy(deg: number): void {
    this.setRotation(this.store.rot() + deg);
  }

  /** Corner coordinates of the real world the model corners are matched to (greenhouse NW, store SE). */
  defaultCorners(): { greenhouseNW: CornerInput; storeSE: CornerInput } {
    return { greenhouseNW: { ...CALIBRATION_CORNERS.greenhouseNW }, storeSE: { ...CALIBRATION_CORNERS.storeSE } };
  }

  /** Solve rotation + shift from two real corners mapped onto the (scaled) model corners. */
  calibrateFromCorners(nw: CornerInput, se: CornerInput): void {
    if ([nw.lat, nw.lon, se.lat, se.lon].some((x) => !isFinite(x))) {
      this.toast.show('Enter both coordinates (decimal degrees)');
      return;
    }
    const k = this.store.modelScale();
    const r = solveCalibration(nw, se, { x: SITE_DIMS.GX0 * k, z: SITE_DIMS.AZ0 * k }, { x: SITE_DIMS.BX1 * k, z: SITE_DIMS.BZ1 * k });
    if (!r) {
      this.toast.show('The two points are too close together');
      return;
    }
    this.store.apply(r.calibration);
    this.toast.show(
      `Calibrated: rotation ${r.calibration.rot.toFixed(2)}°, shift ${r.calibration.dx.toFixed(1)} / ${r.calibration.dz.toFixed(1)} m · corner error ${r.cornerError.toFixed(1)} m · model/real distance ${r.distanceRatio.toFixed(3)}`,
    );
  }

  /** Resize the model so the long shed measures `lengthMetres` in reality. */
  setModelLength(lengthMetres: number): void {
    this.store.setModelScale((lengthMetres || SITE_DIMS.BL) / SITE_DIMS.BL);
  }
}
