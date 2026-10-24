import { Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { SYNC_PLOT_HEIGHT, drawSyncPlot } from '../../core/drawing/sync-plot';
import { ViewStore } from '../../state/view.store';
import { VideoService } from '../../services/video.service';
import { checkedFrom, numberFrom } from '../dom';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-video-panel',
  imports: [Panel, CanvasWidget],
  template: `
    <app-panel id="video">
      <div class="keep slot" #slot [hidden]="view.mainSource() === 'video'"></div>
      @if (view.mainSource() === 'video') {
        <div class="dim small">The video is on the main page (Views panel → Main page).</div>
      }
      <div class="row">
        @if (!video.synced()) {
          <label class="btn" data-tour="load-video">Load video<input type="file" accept="video/*" hidden (change)="load($event)" /></label>
        }
        <button class="btn" [class.primary]="!video.synced()" [disabled]="video.busy() || !video.loaded()" (click)="video.autoSync(scanFrom(), scanLength())" data-tour="auto-sync">{{ video.synced() ? 'Sync again' : 'Auto-sync' }}</button>
        <span class="dim small grow">{{ video.status() }}</span>
      </div>
      <details class="adv">
        <summary>Advanced</summary>
        @if (video.synced()) {
          <div class="row">
            <label class="btn">Load another video<input type="file" accept="video/*" hidden (change)="load($event)" /></label>
          </div>
        }
        <div class="row">
          <label>offset s <input type="number" step="0.1" [value]="video.offset().toFixed(2)" (change)="video.setOffset(num($event))" /></label>
          <button class="btn" (click)="video.syncHere()">Sync here</button>
          <button class="btn" (click)="nudge(-0.1)">−0.1</button>
          <button class="btn" (click)="nudge(0.1)">+0.1</button>
        </div>
        <div class="row">
          <label>cam tilt° <input type="number" step="1" [value]="view.fpvTiltDeg()" (change)="view.setFpvTilt(num($event))" /></label>
        </div>
        <div class="row">
          <label>from s <input type="number" step="10" [value]="scanFrom()" (change)="scanFrom.set(num($event))" /></label>
          <label>scan s <input type="number" step="10" [value]="scanLength()" (change)="scanLength.set(num($event))" /></label>
        </div>
        <div class="row">
          <button class="btn" (click)="video.anchorLiftoff()">Video here = lift-off</button>
          <button class="btn" (click)="video.anchorFlip()">Video here = first flip/roll</button>
          <button class="btn" (click)="video.anchorYawFlick()">Video here = first yaw flick</button>
        </div>
        @if (video.features(); as f) {
          <app-canvas panel="video" [height]="plotHeight" [every]="3" [draw]="drawPlot" [capture]="false" />
        }
        <div class="dim small">
          Auto-sync matches the log with the video over the first minute of flight, using how fast the picture pans and, for flips and rolls, when it is upside down.
          A flip or roll in the first 10 s is the ideal marker (shown as F on the timeline). If it fails: scrub the video to the frame where the picture is upside
          down in the middle of the first flip or roll and press “Video here = first flip/roll”; or use “Video here = lift-off” / “Sync here”. Nudge ±0.1 while
          watching the plot (blue and orange should line up). Video plays locally; nothing is uploaded.
        </div>
      </details>
    </app-panel>
  `,
  styles: `
    .adv summary {
      cursor: pointer;
      color: var(--dim);
      margin: 4px 0;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .slot {
      display: block;
      line-height: 0;
    }
  `,
})
export class VideoPanel {
  protected readonly video = inject(VideoService);
  protected readonly view = inject(ViewStore);
  protected readonly plotHeight = SYNC_PLOT_HEIGHT;
  protected readonly scanFrom = signal(0);
  protected readonly scanLength = signal(90);
  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;
  private readonly slot = viewChild<ElementRef<HTMLElement>>('slot');

  constructor() {
    // The one <video> element lives here, unless the video is the main page.
    effect(() => {
      if (this.view.mainSource() === 'video') return;
      const el = this.video.element;
      const slot = this.slot()?.nativeElement;
      if (!slot) return;
      if (el.parentElement !== slot) slot.appendChild(el);
      el.classList.remove('vbig');
    });
  }

  protected load(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.video.load(f);
    input.value = '';
  }
  protected nudge(d: number): void {
    this.video.setOffset(this.video.offset() + d);
  }

  protected readonly drawPlot = (g: CanvasRenderingContext2D, w: number, h: number): void => {
    const f = this.video.features();
    if (f) drawSyncPlot(g, w, h, f, this.video.offset());
  };
}
