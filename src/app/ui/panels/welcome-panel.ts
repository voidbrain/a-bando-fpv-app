import { Component, ElementRef, effect, inject, signal, untracked, viewChildren } from '@angular/core';
import { SHOWCASE } from '../../core/tour';
import { StudioService } from '../../services/studio.service';
import { TourService } from '../../services/tour.service';
import { PanelPlacer } from '../../services/panel-placer.service';
import { LayoutStore } from '../../state/layout.store';
import type { PanelId } from '../panel-defs';
import { Panel } from '../panel/panel';

/** One of the three columns: what it is about, its short film, and where to start. */
interface Pillar {
  id: string;
  title: string;
  text: string;
  clip: string;
  links: readonly { label: string; open: readonly PanelId[]; list?: boolean }[];
}

const PILLARS: readonly Pillar[] = [
  {
    id: 'build',
    title: 'Build',
    text: 'Create a bando, find the place on the map and generate it in 3D from OpenStreetMap and the real ground. Reshape the buildings, ruin them, sculpt the terrain, drop towers and gates from the library, and let the AI do the details.',
    clip: 'welcome/build.webm',
    links: [{ label: 'Open the bandos', open: ['studio'], list: true }],
  },
  {
    id: 'fly',
    title: 'Fly',
    text: 'Drop your Blackbox log and your DVR: they sync themselves, and the drone flies its real line through the model, with sticks, motors, attitude and four cameras in step. No flight yet? Fly the place in the simulator with your radio.',
    clip: 'welcome/fly.webm',
    links: [
      { label: 'Load a log', open: ['flights', 'timeline'] },
      { label: 'Load a video', open: ['video', 'timeline'] },
      { label: 'Simulator', open: ['simulator', 'radio', 'help', 'speed', 'attitude'] },
    ],
  },
  {
    id: 'share',
    title: 'Share',
    text: 'Export a bando with its address, or hidden: no coordinates, no map, no street names, so only the model travels. Render the replay as an MP4 up to 4K, keep everything in one backup, or open the examples.',
    clip: 'welcome/share.webm',
    links: [
      { label: 'Examples', open: ['studio'], list: true },
      { label: 'Render', open: ['render'] },
    ],
  },
];

/**
 * Welcome: what OpenBando is for (Build, Fly, Share), in three columns with a short film each (the column in focus plays, the others rest),
 * and a button that plays the welcome tour (the showcase). Shown on a first visit over the empty world; closing it brings Views.
 */
@Component({
  selector: 'app-welcome-panel',
  imports: [Panel],
  template: `
    <app-panel id="welcome">
      <div class="welcome">
        <header>
          <h2>OpenBando</h2>
          <p class="tag">Build, Fly, Share.</p>
          <p class="dim">Your bandos in 3D, and your flights back inside them.</p>
        </header>
        <div class="cols">
          @for (p of pillars; track p.id) {
            <section class="col" [class.on]="focus() === p.id" (mouseenter)="focus.set(p.id)" (focusin)="focus.set(p.id)" (click)="focus.set(p.id)" [attr.data-tour]="'welcome-' + p.id">
              <div class="film">
                <video #film [src]="p.clip" [attr.data-id]="p.id" muted loop playsinline preload="auto" [attr.aria-label]="p.title"></video>
              </div>
              <h3>{{ p.title }}</h3>
              <p>{{ p.text }}</p>
              <div class="links">
                @for (l of p.links; track l.label) {
                  <button class="btn" (click)="go(l.open, !!l.list); $event.stopPropagation()">{{ l.label }} <span aria-hidden="true">→</span></button>
                }
              </div>
            </section>
          }
        </div>
        <footer>
          <button class="btn primary" (click)="showcase()" data-tour="welcome-tour">▶ Watch <span translate="no">Welcome</span></button>
          <button class="btn" (click)="go(['guide'], false)">Guide me</button>
          <span class="grow"></span>
          <span class="dim small">No account needed. Your logs, videos and places stay on this computer.</span>
        </footer>
      </div>
    </app-panel>
  `,
  styles: `
    .welcome {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 4px 6px 2px;
    }
    header h2 {
      margin: 0;
      font-size: 26px;
      letter-spacing: 0.01em;
    }
    header p {
      margin: 4px 0 0;
      font-size: 14px;
    }
    header .tag {
      margin-top: 2px;
      font-size: 18px;
      font-weight: 600;
      color: var(--accent);
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    @media (max-width: 760px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      cursor: default;
      transition:
        border-color 0.2s,
        background 0.2s;
    }
    .col.on {
      border-color: var(--accent);
      background: rgba(183, 237, 131, 0.05);
    }
    .film {
      aspect-ratio: 16 / 10;
      border-radius: 6px;
      overflow: hidden;
      background: radial-gradient(circle at 50% 40%, #26352c, #111a14);
    }
    .film video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      opacity: 0.55;
      transition: opacity 0.3s;
    }
    .col.on .film video {
      opacity: 1;
    }
    h3 {
      margin: 2px 0 0;
      font-size: 17px;
    }
    .col p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      flex: 1;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    footer {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .grow {
      flex: 1;
    }
  `,
})
export class WelcomePanel {
  protected readonly pillars = PILLARS;
  private readonly layout = inject(LayoutStore);
  private readonly studio = inject(StudioService);
  private readonly tour = inject(TourService);
  private readonly placer = inject(PanelPlacer);
  /** The column in focus: its film plays. */
  protected readonly focus = signal('build');

  private readonly films = viewChildren<ElementRef<HTMLVideoElement>>('film');

  constructor() {
    // the film in focus plays, the others rest
    effect(() => {
      const id = this.focus();
      for (const f of this.films()) {
        const v = f.nativeElement;
        if (v.dataset['id'] === id) void v.play().catch(() => undefined);
        else v.pause();
      }
    });
    // closing Welcome (its ×, Views, a link) brings the Views panel: the way to everything else
    let was = untracked(() => this.layout.panels().welcome.visible);
    effect(() => {
      const on = this.layout.panels().welcome.visible;
      if (was && !on && !this.tour.state()) untracked(() => this.layout.setVisible('views', true));
      was = on;
    });
  }


  /** A link: close Welcome, open the panels for that job (the Bandos panel on its list) side by side, on top. */
  protected go(open: readonly PanelId[], list: boolean): void {
    if (list && this.studio.view() !== 'list') this.studio.back();
    this.layout.setVisible('welcome', false);
    void this.placer.open(open);
  }

  protected showcase(): void {
    void this.tour.playTour(SHOWCASE);
  }
}
