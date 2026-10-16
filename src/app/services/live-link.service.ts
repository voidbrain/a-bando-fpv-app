import { Injectable, inject, signal } from '@angular/core';
import { hasFix, normalizeLive, summarizeLive, type LiveSample } from '../core/live/live-normalizer';
import type { Flight, GeoSample } from '../core/models';
import { FlightService } from './flight.service';
import { FrameLoopService, FrameOrder } from './frame-loop.service';
import { PlaybackService } from './playback.service';

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'receiving' | 'closed' | 'error';

const MIN_FIX_INTERVAL_S = 0.15;
const REDRAW_INTERVAL_S = 1;
/** Above this ground speed the GPS course is a trustworthy heading. */
const HEADING_MIN_SPEED = 1.5;

/**
 * Live telemetry from `tools/elrs_bridge.py` (or anything speaking the same JSON): a WebSocket (ws://) or a
 * Server-Sent-Events stream (http://). GPS fixes build a flight that grows in real time; attitude (when sent) drives
 * the replayed drone. The live flight is kept as a normal flight after disconnecting.
 */
@Injectable({ providedIn: 'root' })
export class LiveLinkService {
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);

  readonly status = signal<LiveStatus>('idle');
  readonly message = signal('');
  readonly values = signal('');
  readonly following = signal(true);

  private source: WebSocket | EventSource | null = null;
  private fixes: GeoSample[] = [];
  private flight: Flight | null = null;
  private t0: number | null = null;
  private lastRedraw = 0;

  constructor() {
    inject(FrameLoopService).add(FrameOrder.live, () => this.tick());
  }

  get connected(): boolean {
    return this.source !== null;
  }

  toggle(url: string): void {
    if (this.source) this.disconnect();
    else this.connect(url.trim());
  }

  followLatest(): void {
    this.following.set(true);
  }

  connect(url: string): void {
    try {
      const src = /^https?:/i.test(url) ? new EventSource(url) : new WebSocket(url);
      this.source = src;
      this.fixes = [];
      this.flight = null;
      this.t0 = null;
      this.following.set(true);
      this.status.set('connecting');
      src.onopen = () => {
        this.status.set('connected');
        this.message.set('Connected: waiting for a GPS fix…');
      };
      src.onmessage = (e: MessageEvent) => {
        for (const line of String(e.data).split('\n')) {
          if (!line.trim()) continue;
          try {
            this.handle(JSON.parse(line) as unknown);
          } catch {
            /* ignore malformed lines */
          }
        }
      };
      src.onerror = () => {
        this.status.set('error');
        this.message.set('Could not connect. Is the telemetry source running, and is this page opened over http://localhost? (A published page cannot reach local devices.)');
        if (src instanceof EventSource && src.readyState === EventSource.CLOSED) this.closed();
      };
      if (src instanceof WebSocket) src.onclose = () => this.closed();
    } catch (e) {
      this.status.set('error');
      this.message.set(`Cannot open the connection: ${(e as Error).message}`);
    }
  }

  disconnect(): void {
    this.source?.close();
    this.closed();
  }

  private closed(): void {
    if (!this.source && this.status() !== 'connected' && this.status() !== 'receiving') return;
    this.source = null;
    if (this.status() !== 'error') this.status.set('closed');
    if (this.flight) this.message.set('Disconnected. The live path is kept as a normal flight.');
  }

  private handle(raw: unknown): void {
    const m = normalizeLive(raw);
    if (!m) return;
    this.values.set(summarizeLive(m));
    if (!hasFix(m)) return;
    const now = performance.now() / 1000;
    this.t0 ??= now;
    const t = now - this.t0;
    const last = this.fixes[this.fixes.length - 1];
    if (last && (t - last.t < MIN_FIX_INTERVAL_S || (last.lat === m.lat && last.lon === m.lon))) return;
    this.fixes.push({ lat: m.lat, lon: m.lon, alt: m.alt ?? 0, t });
    if (this.fixes.length < 2) return;
    if (!this.flight) {
      // the flight shares the growing array, so every new fix shows up without copying
      this.flight = this.flights.add(`LIVE ${new Date().toLocaleTimeString()}`, this.fixes, null, { live: true });
      this.playback.seekTo(0);
      this.following.set(true);
      this.status.set('receiving');
      this.message.set(`Live: receiving GPS (${m.sats ?? '?'} sats)`);
    }
    this.applyAttitude(this.flight, m);
    if (now - this.lastRedraw > REDRAW_INTERVAL_S) {
      this.lastRedraw = now;
      this.flights.refresh(this.flight);
    } else {
      this.flights.refreshLight(this.flight);
    }
  }

  private applyAttitude(f: Flight, m: LiveSample): void {
    if (m.roll == null || m.pitch == null) return;
    const k = Math.PI / 180;
    const speed = m.speed ?? 0;
    f.att = {
      roll: m.roll * k,
      pitch: m.pitch * k,
      hdg: speed > HEADING_MIN_SPEED && m.heading != null ? m.heading * k : f.att ? f.att.hdg : (m.heading ?? 0) * k,
    };
  }

  /** The replay playhead stays on the newest fix while following. */
  private tick(): void {
    const f = this.flight;
    if (!f || !this.following() || this.flights.active !== f) return;
    this.playback.time = f.dur || 0;
  }
}
