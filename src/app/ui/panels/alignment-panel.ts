import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SITE_DIMS } from '../../core/site-dims';
import { CalibrationService } from '../../services/calibration.service';
import { SceneService } from '../../services/scene.service';
import { CalibrationStore } from '../../state/calibration.store';
import { numberFrom, textFrom } from '../dom';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-alignment-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="alignment">
      <div class="row">
        <label>shift X <input type="number" step="1" [value]="cal.dx().toFixed(1)" (change)="cal.setDx(num($event))" /></label>
        <label>Z <input type="number" step="1" [value]="cal.dz().toFixed(1)" (change)="cal.setDz(num($event))" /></label>
        <label>rot° <input type="number" step="0.5" [value]="cal.rot().toFixed(1)" (change)="align.setRotation(num($event))" /></label>
      </div>
      <div class="row">
        <button class="btn" (click)="align.rotateBy(-90)">↺ 90°</button>
        <button class="btn" (click)="align.rotateBy(90)">↻ 90°</button>
        <button class="btn" (click)="align.rotateBy(180)">180°</button>
        <button class="btn" [class.on]="scene.pin() === 's'" (click)="scene.armPin('s')">Pin start</button>
        <button class="btn" [class.on]="scene.pin() === 'e'" (click)="scene.armPin('e')">Pin end</button>
      </div>
      <h4>Greenhouse NW corner</h4>
      <div class="row">
        <input type="text" class="grow" [value]="nw().lat" (change)="setNw('lat', text($event))" />
        <input type="text" class="grow" [value]="nw().lon" (change)="setNw('lon', text($event))" />
      </div>
      <h4>Store SE corner</h4>
      <div class="row">
        <input type="text" class="grow" [value]="se().lat" (change)="setSe('lat', text($event))" />
        <input type="text" class="grow" [value]="se().lon" (change)="setSe('lon', text($event))" />
      </div>
      <div class="row"><button class="btn primary" (click)="apply()">Apply to map</button></div>
      <div class="sep"></div>
      <div class="row">
        <label>real shed length m <input type="number" step="0.5" [value]="shedLength()" #len /></label>
        <button class="btn" (click)="align.setModelLength(+len.value)">Set model size</button>
        <label>model × <input type="number" step="0.01" [value]="cal.modelScale().toFixed(3)" (change)="cal.setModelScale(num($event))" /></label>
      </div>
      <div class="dim small">
        Model size: measure the long shed in Google Maps (right-click → Measure distance), type its real length, press Set. The buildings scale around the block
        centre; GPS paths stay true to the ground.
      </div>
    </app-panel>
  `,
})
export class AlignmentPanel {
  protected readonly cal = inject(CalibrationStore);
  protected readonly align = inject(CalibrationService);
  protected readonly scene = inject(SceneService);
  protected readonly num = numberFrom;
  protected readonly text = textFrom;
  private readonly defaults = this.align.defaultCorners();
  protected readonly nw = signal({ lat: String(this.defaults.greenhouseNW.lat), lon: String(this.defaults.greenhouseNW.lon) });
  protected readonly se = signal({ lat: String(this.defaults.storeSE.lat), lon: String(this.defaults.storeSE.lon) });

  protected shedLength(): string {
    return (SITE_DIMS.BL * this.cal.modelScale()).toFixed(1);
  }
  protected setNw(k: 'lat' | 'lon', v: string): void {
    this.nw.update((c) => ({ ...c, [k]: v }));
  }
  protected setSe(k: 'lat' | 'lon', v: string): void {
    this.se.update((c) => ({ ...c, [k]: v }));
  }
  protected apply(): void {
    const n = this.nw(), s = this.se();
    this.align.calibrateFromCorners({ lat: parseFloat(n.lat), lon: parseFloat(n.lon) }, { lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
  }
}
