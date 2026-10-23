import { Component, inject, signal } from '@angular/core';
import { TIMELINE_HEIGHT, drawTimeline, timeAtX } from '../../core/drawing/timeline';
import { flightSpeedMax, pointTimes } from '../../core/flight/flight';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { PLAYBACK_SPEEDS, PlaybackStore } from '../../state/playback.store';
import { checkedFrom, numberFrom } from '../dom';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-timeline-panel',
  imports: [Panel, CanvasWidget],
  template: `
    <app-panel id="timeline">
      <div class="row">
        <button class="btn" title="Back to start" (click)="playback.seekTo(0)">⏮</button>
        <button class="btn" [class.on]="t.playing() && t.direction() < 0" title="Play backwards" (click)="playback.playReverse()">◀</button>
        <button class="btn" [class.on]="!t.playing()" title="Pause" (click)="playback.pause()">⏸</button>
        <button class="btn" [class.on]="t.playing() && t.direction() > 0" title="Play (P)" (click)="playback.play()" data-tour="play">▶</button>
        <button class="btn" (click)="playback.seekBy(-10)">−10s</button>
        <button class="btn" (click)="playback.seekBy(-1)">−1s</button>
        <button class="btn" (click)="playback.seekBy(1)">+1s</button>
        <button class="btn" (click)="playback.seekBy(10)">+10s</button>
        <select aria-label="Replay speed" (change)="t.setSpeed(num($event))">
          @for (s of speeds; track s) {
            <option [value]="s" [selected]="t.speed() === s">{{ s }}×</option>
          }
        </select>
        <label class="check"><input type="checkbox" [checked]="t.loop()" (change)="t.setLoop(checked($event))" /> loop</label>
        <span class="dim small mono">{{ caption() }}</span>
      </div>
      <div class="keep scrub" (pointerdown)="scrubStart($event)" (pointermove)="scrubMove($event)" (pointerup)="scrubEnd()" (pointercancel)="scrubEnd()">
        <app-canvas panel="timeline" [height]="height" [every]="1" [draw]="draw" />
      </div>
    </app-panel>
  `,
  styles: `
    .scrub {
      cursor: pointer;
      touch-action: none;
    }
  `,
})
export class TimelinePanel {
  protected readonly playback = inject(PlaybackService);
  protected readonly t = inject(PlaybackStore);
  private readonly flights = inject(FlightService);
  protected readonly speeds = PLAYBACK_SPEEDS;
  protected readonly height = TIMELINE_HEIGHT;
  protected readonly caption = signal('');
  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;
  private scrubbing = false;

  protected readonly draw = (g: CanvasRenderingContext2D, w: number, h: number): void => {
    const f = this.flights.active;
    if (!f || f.pts.length < 2) {
      g.clearRect(0, 0, w, h);
      if (this.caption()) this.caption.set('');
      return;
    }
    const text = drawTimeline(g, w, h, {
      flight: f,
      times: pointTimes(f),
      time: this.playback.time,
      liftoff: this.flights.liftoff(f),
      firstFlip: this.flights.firstFlip(f),
      speedMax: flightSpeedMax(f),
    });
    if (text !== this.caption()) this.caption.set(text);
  };

  protected scrubStart(e: PointerEvent): void {
    if (!this.flights.active) return;
    this.scrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.seekFrom(e);
  }
  protected scrubMove(e: PointerEvent): void {
    if (this.scrubbing) this.seekFrom(e);
  }
  protected scrubEnd(): void {
    this.scrubbing = false;
  }

  private seekFrom(e: PointerEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.playback.seekTo(timeAtX(e.clientX - r.left, r.width, this.playback.duration));
  }
}
