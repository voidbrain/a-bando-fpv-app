import { Injectable, inject, signal } from '@angular/core';
import { FrameLoopService, FrameOrder } from './frame-loop.service';
import { FlightService } from './flight.service';
import { PlaybackService } from './playback.service';
import { SceneService } from './scene.service';
import { VideoService } from './video.service';
import { ViewStore } from '../state/view.store';
import { PlaybackStore } from '../state/playback.store';

export type RenderBackground = 'scene' | 'green';
export interface RenderSettings {
  /** "WIDTHxHEIGHT" */
  resolution: string;
  fps: number;
  background: RenderBackground;
}

export interface RenderResult {
  url: string;
  filename: string;
  sizeMb: number;
}

const GREEN = '#00b140';
const MIME_CANDIDATES = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

const bitrateFor = (width: number): number => (width >= 3000 ? 45e6 : width >= 1900 ? 16e6 : 8e6);

function h264Codec(width: number, fps: number): string {
  if (width >= 3000) return fps > 30 ? 'avc1.640034' : 'avc1.640033';
  return fps > 30 ? 'avc1.64002A' : 'avc1.640028';
}

interface RealtimeRecording {
  recorder: MediaRecorder;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  chunks: Blob[];
  startedAt: number;
  lastStatusAt: number;
  mime: string;
  /** Stop automatically when the replay reaches its end. */
  auto: boolean;
}

/**
 * Renders the main page (3D or video) plus every visible widget, in their on-screen positions and stacking order, into
 * an HD file. Two ways:
 *  - exact: each output frame is drawn at an exact replay time and encoded with explicit timestamps (WebCodecs +
 *    mp4-muxer) -> constant frame rate, correct speed, H.264 MP4 that edits smoothly. Chrome / Edge.
 *  - real-time: MediaRecorder on a canvas (works anywhere MediaRecorder does, and on live video).
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly loop = inject(FrameLoopService);
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly transport = inject(PlaybackStore);
  private readonly scene = inject(SceneService);
  private readonly video = inject(VideoService);
  private readonly view = inject(ViewStore);

  readonly settings = signal<RenderSettings>({ resolution: '1920x1080', fps: 30, background: 'scene' });
  readonly status = signal('');
  readonly recording = signal(false);
  readonly rendering = signal(false);
  readonly result = signal<RenderResult | null>(null);

  private realtime: RealtimeRecording | null = null;
  private cancelRender = false;

  constructor() {
    this.loop.add(FrameOrder.capture, () => this.captureFrame());
  }

  update(patch: Partial<RenderSettings>): void {
    this.settings.update((s) => ({ ...s, ...patch }));
  }

  private size(): [number, number] {
    const [w, h] = this.settings().resolution.split('x').map(Number);
    return [w || 1920, h || 1080];
  }

  // ---- compositing ----
  /** Draw the page as it looks on screen into `ctx` (W x H), letterboxed. */
  composite(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const iw = innerWidth, ih = innerHeight;
    const s = Math.min(W / iw, H / ih);
    const ox = (W - iw * s) / 2, oy = (H - ih * s) / 2;
    const green = this.settings().background === 'green';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = green ? GREEN : '#000';
    ctx.fillRect(0, 0, W, H);
    if (!green) {
      const v = this.video.element;
      if (this.view.mainSource() === 'video' && v.videoWidth) {
        const k = Math.min(iw / v.videoWidth, ih / v.videoHeight);
        const w = v.videoWidth * k, h = v.videoHeight * k;
        ctx.drawImage(v, ox + ((iw - w) / 2) * s, oy + ((ih - h) / 2) * s, w * s, h * s);
      } else if (this.view.mainSource() === '3d' && this.scene.host) {
        const dom = this.scene.host.canvas;
        ctx.drawImage(dom, 0, 0, dom.width, dom.height, ox, oy, iw * s, ih * s);
      }
    }
    // widgets in the same stacking order and place as on screen
    const widgets = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-capture]')]
      .map((c) => ({ c, r: c.getBoundingClientRect(), z: +((c.closest('[data-panel]') as HTMLElement | null)?.style.zIndex ?? 0) || 2 }))
      .filter((o) => o.r.width > 8 && o.r.height > 8)
      .sort((a, b) => a.z - b.z);
    for (const o of widgets) ctx.drawImage(o.c, ox + o.r.left * s, oy + o.r.top * s, o.r.width * s, o.r.height * s);
  }

  // ---- real-time recorder ----
  startRealtime(auto = false): void {
    if (this.realtime) return;
    const [W, H] = this.size();
    const fps = this.settings().fps;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
      this.status.set('This browser cannot record video: use Chrome or Edge.');
      return;
    }
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      this.status.set('No supported video format in this browser.');
      return;
    }
    const recorder = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: bitrateFor(W) });
    const rec: RealtimeRecording = { recorder, canvas, ctx, width: W, height: H, chunks: [], startedAt: performance.now(), lastStatusAt: -1, mime, auto };
    recorder.ondataavailable = (e) => {
      if (e.data.size) rec.chunks.push(e.data);
    };
    recorder.onstop = () => this.finishRealtime(rec);
    this.result.set(null);
    this.realtime = rec;
    recorder.start(1000);
    this.recording.set(true);
  }

  stopRealtime(): void {
    const rec = this.realtime;
    if (!rec) return;
    this.realtime = null;
    this.recording.set(false);
    try {
      rec.recorder.stop();
    } catch {
      /* already stopped */
    }
  }

  /** One pass of the replay at 1x, recorded in real time. */
  renderReplayRealtime(): void {
    const f = this.flights.active;
    if (!f || f.live) {
      this.status.set('Load a recorded flight first (live paths are recorded with the Record button).');
      return;
    }
    if (this.realtime) return;
    this.transport.setLoop(false);
    this.transport.setSpeed(1);
    this.playback.pause();
    this.playback.seekTo(0);
    this.status.set('Seeking to the start…');
    setTimeout(() => {
      this.startRealtime(true);
      this.playback.play();
    }, 800);
  }

  private captureFrame(): void {
    const rec = this.realtime;
    if (!rec) return;
    this.composite(rec.ctx, rec.width, rec.height);
    const elapsed = (performance.now() - rec.startedAt) / 1000;
    if (elapsed - rec.lastStatusAt >= 1) {
      rec.lastStatusAt = elapsed;
      this.status.set(`Recording ${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')} · ${rec.mime.split(';')[0]?.replace('video/', '')} ${rec.width}×${rec.height}`);
    }
    const f = this.flights.active;
    if (rec.auto && !this.transport.playing() && f && this.playback.time >= f.dur - 0.05) this.stopRealtime();
  }

  private finishRealtime(rec: RealtimeRecording): void {
    const type = rec.mime.split(';')[0] ?? 'video/webm';
    const blob = new Blob(rec.chunks, { type });
    this.publish(blob, `openbando-render.${type.includes('mp4') ? 'mp4' : 'webm'}`, `Done: ${(blob.size / 1e6).toFixed(1)} MB. Press the download link.`);
  }

  // ---- exact renderer ----
  cancel(): void {
    this.cancelRender = true;
  }

  async renderReplayExact(): Promise<void> {
    const f = this.flights.active;
    if (!f || f.live || !f.dur) {
      this.status.set('Load a recorded flight first.');
      return;
    }
    if (this.realtime || this.rendering()) return;
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      this.status.set('This browser cannot encode video frame by frame (use Chrome or Edge). Using the real-time recorder instead.');
      this.renderReplayRealtime();
      return;
    }
    const [W, H] = this.size();
    const fps = this.settings().fps;
    const total = Math.ceil(f.dur * fps) + 1;
    const config: VideoEncoderConfig = { codec: h264Codec(W, fps), width: W, height: H, bitrate: bitrateFor(W), framerate: fps };
    let supported = false;
    try {
      supported = !!(await VideoEncoder.isConfigSupported(config)).supported;
    } catch {
      supported = false;
    }
    if (!supported) {
      this.status.set(`This browser cannot encode ${W}×${H} H.264 at ${fps} fps. Using the real-time recorder instead.`);
      this.renderReplayRealtime();
      return;
    }
    const { ArrayBufferTarget, Muxer } = await import('mp4-muxer');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
    let encodeError: unknown = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encodeError = e) });
    encoder.configure(config);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const startedAt = performance.now();
    const keepTime = this.playback.time;
    this.cancelRender = false;
    this.result.set(null);
    this.loop.suspended = true;
    this.loop.forceAll = true;
    this.video.suspended = true;
    this.playback.pause();
    this.rendering.set(true);
    try {
      for (let i = 0; i < total && !this.cancelRender && !encodeError; i++) {
        const t = Math.min(i / fps, f.dur);
        this.playback.time = t;
        if (this.view.mainSource() === 'video') await this.video.seekExact(t + this.video.offset());
        this.loop.runOnce(1 / fps, 1 / fps, performance.now()); // cameras, x-ray, 3D render and every widget at exactly this time
        this.composite(ctx, W, H);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        if (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 10));
        if (i % 5 === 0) {
          const elapsed = (performance.now() - startedAt) / 1000;
          this.status.set(`Rendering ${Math.round((i / total) * 100)}% (${i}/${total} frames) · about ${Math.ceil((elapsed / (i + 1)) * (total - i - 1))} s left. Keep this tab in front.`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (this.cancelRender) {
        this.status.set('Render cancelled.');
        return;
      }
      await encoder.flush();
      if (encodeError) throw encodeError;
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      this.publish(blob, 'openbando-render.mp4', `Done in ${Math.round((performance.now() - startedAt) / 1000)} s: exact ${fps} fps, ${W}×${H} H.264, ${f.dur.toFixed(1)} s long. Press the download link.`);
    } catch (e) {
      this.status.set(`Render failed: ${(e as Error).message}`);
    } finally {
      this.loop.suspended = false;
      this.loop.forceAll = false;
      this.video.suspended = false;
      this.playback.time = keepTime;
      this.rendering.set(false);
      try {
        encoder.close();
      } catch {
        /* already closed */
      }
    }
  }

  private publish(blob: Blob, filename: string, message: string): void {
    const url = URL.createObjectURL(blob);
    this.result.set({ url, filename, sizeMb: blob.size / 1e6 });
    this.status.set(message);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
}
