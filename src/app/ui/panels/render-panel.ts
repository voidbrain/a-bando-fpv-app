import { Component, inject } from '@angular/core';
import { ExportService, type RenderBackground } from '../../services/export.service';
import { selectedFrom } from '../dom';
import { Panel } from '../panel/panel';

const RESOLUTIONS = [
  { value: '1280x720', label: '720p' },
  { value: '1920x1080', label: '1080p' },
  { value: '3840x2160', label: '4K' },
] as const;

@Component({
  selector: 'app-render-panel',
  imports: [Panel],
  template: `
    <app-panel id="render">
      <div class="row">
        <label>size
          <select (change)="exporter.update({ resolution: sel($event) })">
            @for (r of resolutions; track r.value) {
              <option [value]="r.value" [selected]="exporter.settings().resolution === r.value">{{ r.label }}</option>
            }
          </select>
        </label>
        <label>fps
          <select (change)="exporter.update({ fps: +sel($event) })">
            <option value="30" [selected]="exporter.settings().fps === 30">30</option>
            <option value="60" [selected]="exporter.settings().fps === 60">60</option>
          </select>
        </label>
        <label>background
          <select (change)="exporter.update({ background: background($event) })">
            <option value="scene" [selected]="exporter.settings().background === 'scene'">main page</option>
            <option value="green" [selected]="exporter.settings().background === 'green'">green screen</option>
          </select>
        </label>
      </div>
      <div class="row">
        @if (exporter.recording()) {
          <button class="btn danger" (click)="exporter.stopRealtime()">■ Stop</button>
        } @else {
          <button class="btn" [disabled]="exporter.rendering()" (click)="exporter.startRealtime()">● Record (real time)</button>
        }
        @if (exporter.rendering()) {
          <button class="btn danger" (click)="exporter.cancel()">■ Cancel</button>
        } @else {
          <button class="btn primary" [disabled]="exporter.recording()" (click)="exporter.renderReplayExact()">Render replay (exact MP4)</button>
        }
      </div>
      <div class="dim small">{{ exporter.status() || help }}</div>
      @if (exporter.result(); as r) {
        <a class="small" [href]="r.url" [download]="r.filename">Download {{ r.filename }} ({{ r.sizeMb.toFixed(1) }} MB)</a>
      }
    </app-panel>
  `,
})
export class RenderPanel {
  protected readonly exporter = inject(ExportService);
  protected readonly resolutions = RESOLUTIONS;
  protected readonly sel = selectedFrom;
  protected readonly background = (e: Event): RenderBackground => selectedFrom(e) as RenderBackground;
  protected readonly help =
    'Render replay (exact MP4): draws the replay frame by frame at the chosen size and fps, so the speed is always right and the file is constant frame rate (best for DaVinci); slower than real time, keep this tab in front. Record: captures what you see, live, and can stutter if the page is slow. “Green screen” keeps only the widgets on green, to key out in DaVinci.';
}
