import { Component, computed, inject } from '@angular/core';
import { COLORS, MONO } from '../../core/drawing/canvas-util';
import { RadioService } from '../../services/radio.service';
import { RadioStore, type MappedControl } from '../../state/radio.store';
import { checkedFrom, numberFrom, selectedFrom } from '../dom';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

const CONTROLS: readonly { key: MappedControl; label: string }[] = [
  { key: 'roll', label: 'Roll' },
  { key: 'pitch', label: 'Pitch' },
  { key: 'thr', label: 'Throttle' },
  { key: 'yaw', label: 'Yaw' },
  { key: 'arm', label: 'Arm switch' },
  { key: 'mode', label: 'Mode switch' },
];
const MAX_AXES = 12;

@Component({
  selector: 'app-radio-panel',
  imports: [Panel, CanvasWidget],
  template: `
    <app-panel id="radio">
      <div class="dim small">{{ pad() ? 'Connected: ' + pad() : 'No controller — plug in your radio (USB joystick mode) or gamepad and move a stick.' }}</div>
      <div class="keep"><app-canvas panel="radio" [height]="axesHeight" [draw]="drawAxes" [capture]="false" [every]="3" /></div>
      <h4>Axis mapping</h4>
      <div class="map">
        @for (c of controls; track c.key) {
          <span>{{ c.label }}</span>
          <select [value]="axisOf(c.key)" (change)="setAxis(c.key, num($event))">
            <option value="-1">—</option>
            @for (n of axisNumbers; track n) {
              <option [value]="n" [selected]="axisOf(c.key) === n">Axis {{ n }}</option>
            }
          </select>
          <label class="check"><input type="checkbox" [checked]="invertOf(c.key)" (change)="setInvert(c.key, checked($event))" /> inv</label>
        }
      </div>
      <div class="row"><label class="check"><input type="checkbox" [checked]="mapping.spring()" (change)="mapping.setSpring(checked($event))" /> throttle springs to centre (gamepad)</label></div>
      <div class="row">
        <label>rate °/s <input type="number" step="50" [value]="mapping.rate()" (change)="mapping.setRate(num($event))" /></label>
        <label>expo <input type="number" step="0.05" min="0" max="1" [value]="mapping.expo()" (change)="mapping.setExpo(num($event))" /></label>
      </div>
      <div class="row">
        <button class="btn" (click)="mapping.applyPreset('radio')">Zorro preset</button>
        <button class="btn" (click)="mapping.applyPreset('gamepad')">Gamepad preset</button>
      </div>
    </app-panel>
  `,
  styles: `
    .map {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 4px 8px;
      align-items: center;
    }
  `,
})
export class RadioPanel {
  protected readonly mapping = inject(RadioStore);
  private readonly radio = inject(RadioService);
  protected readonly pad = this.radio.padName;
  protected readonly controls = CONTROLS;
  protected readonly axisNumbers = Array.from({ length: MAX_AXES }, (_, i) => i);
  protected readonly axesHeight = 14 * 8 + 4;
  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;
  protected readonly selected = selectedFrom;
  private readonly assigned = computed(() => {
    const m = this.mapping;
    return { roll: m.roll().a, pitch: m.pitch().a, thr: m.thr().a, yaw: m.yaw().a, arm: m.arm().a, mode: m.mode().a };
  });

  protected axisOf(k: MappedControl): number {
    return this.assigned()[k];
  }
  protected invertOf(k: MappedControl): boolean {
    return this.mapping[k]().inv;
  }
  protected setAxis(k: MappedControl, a: number): void {
    this.mapping.setAxis(k, { a });
  }
  protected setInvert(k: MappedControl, inv: boolean): void {
    this.mapping.setAxis(k, { inv });
  }

  /** Live bars of the first eight axes, labelled with the control each is mapped to. */
  protected readonly drawAxes = (g: CanvasRenderingContext2D, w: number): void => {
    const axes = this.radio.axes;
    const names = new Map<number, string>();
    for (const c of CONTROLS) {
      const a = this.assigned()[c.key];
      if (a >= 0) names.set(a, (names.get(a) ?? '') + (names.has(a) ? '/' : '') + c.label.split(' ')[0]);
    }
    g.clearRect(0, 0, w, this.axesHeight);
    g.font = `10px ${MONO}`;
    g.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const y = i * 14 + 7;
      const v = axes[i] ?? 0;
      g.fillStyle = COLORS.dim;
      g.fillText(String(i), 2, y);
      const x0 = 18, bw = w - x0 - 70;
      g.fillStyle = '#24332c';
      g.fillRect(x0, y - 4, bw, 8);
      g.fillStyle = names.has(i) ? COLORS.accent : '#6b7f74';
      const mid = x0 + bw / 2;
      g.fillRect(Math.min(mid, mid + (v * bw) / 2), y - 4, Math.abs((v * bw) / 2), 8);
      g.fillStyle = COLORS.text;
      g.fillText(names.get(i) ?? '', x0 + bw + 6, y);
    }
  };
}
