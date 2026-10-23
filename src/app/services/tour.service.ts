import { Service, inject, signal } from '@angular/core';
import { AI_SCRIPTS, SNIPPET_BY_ID, backTarget, type At, type Beat, type Hook, type Need, type Snippet, type Tour, type TourAction } from '../core/tour';
import { sanitizeSpec } from '../core/site-spec';
import type { PanelId } from '../ui/panel-defs';
import { LayoutStore } from '../state/layout.store';
import { AiService } from './ai.service';
import { DownloadService } from './download.service';
import { FlightService } from './flight.service';
import { PlaybackService } from './playback.service';
import { SiteService } from './site.service';
import { StorageService } from './storage.service';
import { StudioService } from './studio.service';
import { ToastService } from './toast.service';
import { VideoService } from './video.service';

/** What the open editor lets the tour do (it registers itself while it exists). */
export interface TourEditor {
  tool(id: string): void;
  select(name: string): boolean;
  model(): void;
  closeBoxes(): void;
  /** Which tab the editor shows, and whether its 3D view is on. */
  state(): { mode: 'area' | 'model'; view3d: boolean };
  view2d(): void;
}

export interface TourState {
  title: string;
  /** Beat number (1-based) and how many. */
  index: number;
  total: number;
  say: string;
  paused: boolean;
  /** Back has somewhere to go. */
  canBack: boolean;
  /** Recording the screen for a clip. */
  recording: boolean;
}

/** The copy of the Villetta example the tour edits (replaced on every run, so the pilot's own copies stay untouched). */
const TOUR_BANDO = { id: 'tour-villetta', name: 'Bando Villetta (tour)', file: 'library/bandos/villetta.json' };
/** A short cut of a real flight at Villetta (log thinned to ~100 Hz, video 480p): published with the app for the guide. */
const DEMO = { log: 'guide-demo/flight.csv', video: 'guide-demo/flight.mp4' };
const SETTINGS = 'abando-guide';

class Stopped extends Error {}

/**
 * Plays the guided tour on the real interface: a drawn cursor glides to each target, clicks, types and drags with
 * synthetic events, and a caption says what happens. Slow or online work (generating from map data, the AI model) is
 * replaced by the real result of a ready example. Esc or Stop ends it at once; a snippet can also be recorded to a
 * video clip for the docs.
 */
@Service()
export class TourService {
  private readonly layout = inject(LayoutStore);
  private readonly studio = inject(StudioService);
  private readonly site = inject(SiteService);
  private readonly ai = inject(AiService);
  private readonly flights = inject(FlightService);
  private readonly video = inject(VideoService);
  private readonly playback = inject(PlaybackService);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);
  private readonly storage = inject(StorageService);

  readonly state = signal<TourState | null>(null);
  readonly cursor = signal<{ x: number; y: number; down: boolean } | null>(null);
  /** A click ring, bumped on every click. */
  readonly ring = signal<{ x: number; y: number; n: number } | null>(null);
  /** The box of the current target, outlined. */
  readonly focus = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Show a snippet as a tip when hovering a tool it explains. */
  readonly tips = signal(this.storage.read(SETTINGS, { tips: false }).tips);

  editor: TourEditor | null = null;
  private stop = false;
  private paused = false;
  private skip = false;
  /** Set by Back: the beat to play next. */
  private jump: number | null = null;

  setTips(on: boolean): void {
    this.tips.set(on);
    this.storage.write(SETTINGS, { tips: on });
  }

  playTour(t: Tour): Promise<void> {
    return this.run(t.title, t.snippets.map((id) => SNIPPET_BY_ID.get(id)).filter((s): s is Snippet => !!s));
  }

  playSnippet(s: Snippet): Promise<void> {
    return this.run(s.title, [s]);
  }

  /** Play a snippet while recording this tab, then save the clip (WebM). The browser asks which tab to share. */
  async record(s: Snippet): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
    } catch {
      this.toast.show('Recording needs permission to capture this tab.');
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((ok) => (rec.onstop = () => ok()));
    rec.start(250);
    await this.sleep(600).catch(() => undefined);
    await this.run(s.title, [s], true);
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    await done;
    this.downloads.save(`${s.id}.webm`, new Blob(chunks, { type: 'video/webm' }), 'video/webm');
  }

  end(): void {
    this.stop = true;
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.state.update((s) => (s ? { ...s, paused: this.paused } : s));
  }

  next(): void {
    this.skip = true;
    if (this.paused) this.togglePause();
  }

  /** Play the current step again from its start; from a step's start, the step before it. */
  back(): void {
    const s = this.state();
    if (!s) return;
    this.jump = backTarget(this.firsts, s.index - 1);
    this.next();
  }
  private firsts: boolean[] = [];

  private async run(title: string, snippets: readonly Snippet[], recording = false): Promise<void> {
    const beats: { beat: Beat; snippet: Snippet; first: boolean }[] = snippets.flatMap((s) => s.beats.map((beat, k) => ({ beat, snippet: s, first: k === 0 })));
    if (this.state()) this.end();
    while (this.state()) await new Promise((r) => setTimeout(r, 50));
    this.stop = this.paused = this.skip = false;
    this.jump = null;
    this.firsts = beats.map((b) => b.first);
    // the layout before the guide: the panels it opens or moves go back when it ends
    const before = Object.fromEntries(Object.entries(this.layout.panels()).map(([id, p]) => [id, { visible: p.visible, x: p.x, y: p.y, minimized: p.minimized }]));
    const c = this.cursor() ?? { x: innerWidth / 2, y: innerHeight / 2, down: false };
    this.cursor.set({ ...c, down: false });
    try {
      for (let i = 0; i < beats.length; i++) {
        const { beat: b, snippet, first } = beats[i]!;
        this.state.set({ title, index: i + 1, total: beats.length, say: b.say ?? this.state()?.say ?? '', paused: this.paused, canBack: i > 0, recording });
        this.skip = false;
        if (first) await this.prepare(snippet.needs ?? []);
        for (const a of b.actions) {
          if (this.skip) break;
          await this.act(a);
        }
        if (this.jump !== null) {
          i = this.jump - 1;
          this.jump = null;
        }
      }
      await this.sleep(400);
    } catch (e) {
      if (!(e instanceof Stopped)) console.warn('tour', e);
    } finally {
      this.layout.restore(before);
      this.ai.demo.set(false);
      this.state.set(null);
      this.cursor.set(null);
      this.focus.set(null);
      this.ring.set(null);
    }
  }

  /**
   * Make sure what a snippet needs is there before it plays (a no-op inside a tour, where the earlier steps did it):
   * the map of a new bando, the tour's model open in the 2D editor, the demo flight and its video.
   */
  private async prepare(needs: readonly Need[]): Promise<void> {
    if (needs.includes('zone')) {
      await this.open('studio');
      if (this.studio.view() !== 'zone' || !this.studio.isNew()) this.studio.create();
      await this.sleep(900);
    }
    if (needs.includes('model')) {
      await this.open('studio');
      const open = this.studio.view() === 'zone' && this.site.active().id === TOUR_BANDO.id && this.editor?.state().mode === 'model';
      if (!open) {
        if (this.site.peek(TOUR_BANDO.id)) {
          this.studio.edit(TOUR_BANDO.id);
          await this.sleep(700);
          this.editor?.model();
          await this.sleep(500);
        } else await this.fakeGenerate();
      }
      this.editor?.closeBoxes();
      if (this.editor?.state().view3d) this.editor.view2d();
      await this.sleep(300);
      // the inspector may have been folded away: open it again, as the pilot would (its ▸ button)
      document.querySelector<HTMLButtonElement>('app-float-box[data-tour~="inspector"].closed header button')?.click();
      await this.sleep(200);
    }
    if (needs.includes('log') && !this.flights.all.length) await this.hook('demoLog');
    if (needs.includes('video') && !this.video.loaded()) {
      await this.open('video');
      await this.hook('demoVideo');
    }
  }

  /** Wait, honouring pause, stop and skip. */
  private async sleep(ms: number): Promise<void> {
    const end = performance.now() + ms;
    while (performance.now() < end || this.paused) {
      if (this.stop) throw new Stopped();
      if (this.skip && !this.paused) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    if (this.stop) throw new Stopped();
  }

  private async act(a: TourAction): Promise<void> {
    switch (a.do) {
      case 'wait':
        return this.sleep(a.ms);
      case 'hook':
        return this.hook(a.hook, a.arg);
      case 'point':
      case 'click':
      case 'press': {
        const el = await this.find(a.at);
        if (!el) return;
        const p = this.freePoint(el, a.to);
        await this.glide(p.x, p.y, el);
        if (a.do === 'point') return;
        await this.tap(p.x, p.y);
        if (a.do === 'click') this.clickAt(el, p.x, p.y);
        return;
      }
      case 'type': {
        const el = await this.find(a.at);
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        const p = this.pointIn(el);
        await this.glide(p.x, p.y, el);
        await this.tap(p.x, p.y);
        el.focus();
        el.value = '';
        for (const ch of a.text) {
          el.value += ch;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await this.sleep(45);
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      case 'drag': {
        const el = await this.find(a.at);
        if (!el) return;
        const from = this.freePoint(el, a.from), to = this.freePoint(el, a.to);
        await this.glide(from.x, from.y, el);
        const target = this.hitAt(from.x, from.y) ?? el;
        this.pointer(target, 'pointerdown', from.x, from.y, 1);
        this.cursor.set({ ...from, down: true });
        const steps = Math.max(8, Math.round((a.ms ?? 900) / 30));
        for (let i = 1; i <= steps; i++) {
          const t = ease(i / steps), x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
          this.cursor.set({ x, y, down: true });
          this.pointer(target, 'pointermove', x, y, 1);
          await this.sleep((a.ms ?? 900) / steps);
        }
        this.pointer(target, 'pointerup', to.x, to.y, 0);
        this.cursor.set({ ...to, down: false });
        return;
      }
    }
  }

  /** A `data-tour` name or a CSS selector; waits a little for it to appear (panels open, lists load). */
  private async find(at: string): Promise<HTMLElement | null> {
    const sel = /^[#.[]/.test(at) || at.startsWith('app-') ? at : `[data-tour~="${at}"]`;
    for (let i = 0; i < 40; i++) {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return el;
      }
      await this.sleep(50);
    }
    console.warn('tour: nothing to point at for', at);
    return null;
  }

  /**
   * A point of the target that is really visible (not under a floating box, the palette or another panel), as near
   * as possible to the asked one; the asked one when there is none.
   */
  private freePoint(el: HTMLElement, at: At = [0.5, 0.5]): { x: number; y: number } {
    const want = this.pointIn(el, at);
    const free = (x: number, y: number): boolean => {
      const h = this.hitAt(x, y);
      return !!h && el.contains(h) && !h.closest('app-float-box, .palette, .opts, .fly');
    };
    if (free(want.x, want.y) || el.closest('button, a, label, input, select, textarea')) return want;
    const r = el.getBoundingClientRect();
    for (let ring = 1; ring <= 8; ring++)
      for (let k = 0; k < 8 * ring; k++) {
        const ang = (k / (8 * ring)) * Math.PI * 2;
        const x = want.x + Math.cos(ang) * ring * r.width * 0.05, y = want.y + Math.sin(ang) * ring * r.height * 0.05;
        if (x > r.left + 4 && x < r.right - 4 && y > r.top + 4 && y < r.bottom - 4 && free(x, y)) return { x, y };
      }
    return want;
  }

  private pointIn(el: HTMLElement, at: At = [0.5, 0.5]): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * at[0], y: r.top + r.height * at[1] };
  }

  /** Move the cursor in a slight arc, outlining the target. */
  private async glide(x: number, y: number, el?: HTMLElement): Promise<void> {
    if (el) {
      const r = el.getBoundingClientRect();
      this.focus.set({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const c = this.cursor() ?? { x, y, down: false };
    const d = Math.hypot(x - c.x, y - c.y);
    const steps = Math.max(6, Math.min(30, Math.round(d / 25)));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps), lift = Math.sin(Math.PI * t) * Math.min(40, d * 0.12);
      this.cursor.set({ x: c.x + (x - c.x) * t, y: c.y + (y - c.y) * t - lift, down: false });
      await this.sleep(16);
    }
  }

  private async tap(x: number, y: number): Promise<void> {
    this.cursor.set({ x, y, down: true });
    this.ring.set({ x, y, n: (this.ring()?.n ?? 0) + 1 });
    await this.sleep(140);
    this.cursor.set({ x, y, down: false });
  }

  /** What is under a point of the page, looking through the tour's own caption and tip. */
  private hitAt(x: number, y: number): HTMLElement | null {
    return (document.elementsFromPoint(x, y).find((e) => !e.closest('app-tour-overlay')) as HTMLElement | undefined) ?? null;
  }

  /**
   * Show a panel the step works in: one that was closed opens in the middle of the window, where the action is (the
   * layout is put back when the guide ends). Views stays where the pilot keeps it.
   */
  private async open(id: PanelId): Promise<void> {
    const was = this.layout.panels()[id];
    this.layout.setVisible(id, true);
    this.layout.raise(id);
    if (was.visible || id === 'views') return;
    await this.sleep(60); // let it render to measure it (a timer: animation frames stop in a background tab)
    const el = document.querySelector<HTMLElement>(`app-panel[data-id="${id}"]`);
    const r = el?.getBoundingClientRect();
    if (r && r.width) this.layout.moveTo(id, Math.max(8, Math.round((innerWidth - r.width) / 2)), Math.max(8, Math.round((innerHeight - r.height) / 2.4)));
  }

  /** Buttons, labels and inputs get a plain click; anything else (the map, the plan) the full pointer sequence. */
  private clickAt(el: HTMLElement, x: number, y: number): void {
    if (el.closest('button, a, label, input, select, summary')) {
      el.click();
      return;
    }
    const t = this.hitAt(x, y) ?? el;
    this.pointer(t, 'pointerdown', x, y, 1);
    this.pointer(t, 'pointerup', x, y, 0);
    t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  }

  private pointer(t: Element, type: string, x: number, y: number, buttons: number): void {
    t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }

  private async hook(h: Hook, arg?: string): Promise<void> {
    switch (h) {
      case 'panel':
        await this.open(arg as PanelId);
        return this.sleep(300);
      case 'list':
        if (this.studio.view() !== 'list') this.studio.back();
        return this.sleep(300);
      case 'closeBoxes':
        this.editor?.closeBoxes();
        return;
      case 'fakeGenerate':
        return this.fakeGenerate();
      case 'tool': {
        const el = await this.find(`tool-${arg}`);
        if (el) {
          const p = this.pointIn(el);
          await this.glide(p.x, p.y, el);
          await this.tap(p.x, p.y);
        }
        this.editor?.tool(arg ?? 'select');
        return this.sleep(200);
      }
      case 'select':
        this.editor?.select(arg ?? '');
        return this.sleep(300);
      case 'view':
        return;
      case 'ai': {
        // 'on' / 'off' show the chat without a model; anything else is the name of a scripted answer to send
        if (arg === 'on' || arg === 'off') {
          this.ai.demo.set(arg === 'on');
          return this.sleep(200);
        }
        const box = document.querySelector<HTMLTextAreaElement>('[data-tour~="ai-input"]');
        const text = box?.value || 'edit';
        if (box) box.value = '';
        await this.ai.send(text, AI_SCRIPTS[arg ?? ''] ?? '{}');
        return;
      }
      case 'demoLog': {
        const f = await this.demoFile(DEMO.log, 'btfl_demo.csv', 'text/csv');
        if (f) await this.flights.loadFiles([f]);
        return;
      }
      case 'demoVideo': {
        const f = await this.demoFile(DEMO.video, 'demo-flight.mp4', 'video/mp4');
        if (f) this.video.load(f);
        return this.sleep(f ? 800 : 0);
      }
      case 'autoSync': {
        for (let i = 0; i < 60 && !this.video.loaded(); i++) await this.sleep(100);
        if (this.video.loaded()) void this.video.autoSync(0, 60);
        return;
      }
      case 'play':
        this.playback.play();
        return;
      case 'pause':
        this.playback.pause();
        return;
    }
  }

  /** Stand-in for generating from map data: the ready Villetta example, opened in the editor like a fresh model. */
  private async fakeGenerate(): Promise<void> {
    this.site.generating.set(true);
    try {
      const res = await fetch(new URL(TOUR_BANDO.file, document.baseURI).toString());
      const spec = sanitizeSpec(await res.json());
      await this.sleep(1600);
      if (!spec) throw new Error('example');
      if (this.site.peek(TOUR_BANDO.id)) this.site.remove(TOUR_BANDO.id);
      spec.id = TOUR_BANDO.id;
      spec.name = TOUR_BANDO.name;
      spec.createdAt = Date.now();
      this.site.importJson(JSON.stringify(spec));
    } catch {
      this.toast.show('The example could not be downloaded; the tour goes on without it.');
      return;
    } finally {
      this.site.generating.set(false);
    }
    this.studio.edit(TOUR_BANDO.id);
    await this.sleep(700);
    this.editor?.model();
    await this.sleep(500);
  }

  /** The tour's demo media (a local folder that is never published); a note when it is missing. */
  private async demoFile(path: string, name: string, type: string): Promise<File | null> {
    try {
      const res = await fetch(new URL(path, document.baseURI).toString());
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error();
      return new File([await res.blob()], name, { type });
    } catch {
      this.toast.show('The demo flight could not be loaded: load your own here.');
      return null;
    }
  }
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
