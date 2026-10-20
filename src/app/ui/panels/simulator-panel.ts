import { Component, inject } from '@angular/core';
import { SimulatorService } from '../../services/simulator.service';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-simulator-panel',
  imports: [Panel],
  template: `
    <app-panel id="simulator">
      <div class="row">
        <button class="btn" [class.primary]="!sim.armed()" [class.danger]="sim.armed()" (click)="sim.toggleArmed()">{{ sim.armed() ? 'Disarm + stop' : 'Arm + record' }}</button>
        <button class="btn" (click)="sim.toggleMode()">Mode: {{ sim.mode() === 'angle' ? 'Angle' : 'Acro' }}</button>
        <button class="btn" [class.on]="sim.altitudeHold()" title="H" (click)="sim.toggleHold()">Alt hold</button>
      </div>
      <div class="row mono hud">
        <span><b>{{ sim.hud().speedKmh }}</b> km/h</span>
        <span><b>{{ sim.hud().altitude.toFixed(1) }}</b> m</span>
        <span>{{ sim.hud().status }}</span>
      </div>
      <div class="row">
        <button class="btn" [disabled]="!sim.hasRecording()" (click)="sim.downloadCsv()">CSV</button>
        <button class="btn" [disabled]="!sim.hasRecording()" (click)="sim.downloadJson()">JSON</button>
        <button class="btn" title="R" (click)="sim.reset()">Reset drone</button>
      </div>
    </app-panel>
  `,
  styles: `
    .hud {
      gap: 12px;
      color: var(--dim);
      b {
        color: var(--text);
        font-size: 14px;
      }
    }
  `,
})
export class SimulatorPanel {
  protected readonly sim = inject(SimulatorService);
}
