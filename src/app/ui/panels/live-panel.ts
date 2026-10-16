import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LiveLinkService } from '../../services/live-link.service';
import { textFrom } from '../dom';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-live-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="live">
      <div class="row">
        <input type="text" class="grow" [value]="url()" (input)="url.set(text($event))" />
        <button class="btn" [class.danger]="live.connected" (click)="live.toggle(url())">{{ live.connected ? 'Disconnect' : 'Connect' }}</button>
      </div>
      <div class="row"><button class="btn" [class.on]="live.following()" (click)="live.followLatest()">Go live</button></div>
      <div class="dim small">{{ live.message() || idleHelp }}</div>
      <div class="keep mono small values">{{ live.values() }}</div>
      <div class="dim small">
        Telemetry: run <span class="mono">tools/elrs_bridge.py</span> (CRSF from an ExpressLRS receiver, UDP, TCP, serial, or <span class="mono">--simulate</span>) and connect
        to its WebSocket. Video: SquirrelCast can stream the phone's camera over WebRTC or RTSP; open its page or load the file in the Video panel.
      </div>
    </app-panel>
  `,
  styles: `
    .values {
      min-height: 1.4em;
    }
  `,
})
export class LivePanel {
  protected readonly live = inject(LiveLinkService);
  protected readonly url = signal('ws://localhost:8765');
  protected readonly text = textFrom;
  protected readonly idleHelp =
    'Not connected. Enter a ws:// (WebSocket) or http:// (event stream) URL for your telemetry source, open this page over http://localhost, then Connect.';
}
