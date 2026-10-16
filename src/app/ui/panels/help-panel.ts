import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-help-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="help">
      <div class="keep help">
        <p><b>FLY</b> · Enter arm/record · W/S pitch · A/D roll · Q/E yaw · ↑/↓ or Space/Shift throttle</p>
        <p><b>KEYS</b> · V view · M angle/acro · H alt-hold · R reset · P replay · ←/→ seek (Shift = 10 s) · radio via USB (Radio panel)</p>
        <p><b>ORBIT</b> · drag rotate · right-drag pan · wheel zoom · pinch on touch</p>
        <p><b>LOGS</b> · drop a Betaflight Blackbox CSV, GPX or JSON file anywhere · drop a satellite screenshot to replace the map</p>
      </div>
    </app-panel>
  `,
  styles: `
    .help p {
      margin: 0 0 6px;
      color: var(--dim);
      b {
        color: var(--accent);
      }
    }
  `,
})
export class HelpPanel {}
