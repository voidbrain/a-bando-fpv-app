import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { SECTIONS, SNIPPETS, TOURS, playTime, tourBeats } from '../../core/tour';
import { TourService } from '../../services/tour.service';
import { uiResets } from '../../state/layout.store';
import { Panel } from '../panel/panel';

const CLOSED_KEY = 'abando-float-guide-closed';

/**
 * Guide me: the guided tours, then every step on its own in sections that fold like the Views panel's (closed ones
 * are remembered; Reset UI opens them again). Shown on the first visit; afterwards it is an ordinary panel. Hover tips
 * are switched by the `?` in any panel's title bar, or here.
 */
@Component({
  selector: 'app-guide-panel',
  imports: [Panel],
  template: `
    <app-panel id="guide">
      <div class="guide">
        <div class="sec">
          <div class="head">
            <button class="fold" [attr.aria-expanded]="isOpen('tours')" (click)="fold('tours')"><span class="chev">▾</span> Tours</button>
          </div>
          @if (isOpen('tours')) {
            @for (t of tours(); track t.id) {
              <div class="tour">
                <div class="grow">
                  <b>{{ t.title }}</b> <span class="dim small mono">~{{ t.min }} min</span>
                  <div class="dim small">{{ t.about }}</div>
                </div>
                <button class="btn primary" (click)="tour.playTour(t.tour)" [disabled]="!!tour.state()">▶ Play</button>
              </div>
            }
          }
        </div>
        @for (sec of sections; track sec.id) {
          <div class="sec">
            <div class="head">
              <button class="fold" [attr.aria-expanded]="isOpen(sec.id)" (click)="fold(sec.id)"><span class="chev">▾</span> {{ sec.title }}</button>
              <span class="dim small mono">{{ sec.snippets.length }}</span>
            </div>
            @if (isOpen(sec.id)) {
              @for (s of sec.snippets; track s.id) {
                <div class="clip">
                  <span class="grow">{{ s.title }}</span>
                  <button class="btn" (click)="tour.playSnippet(s)" [disabled]="!!tour.state()" [attr.aria-label]="'Play: ' + s.title" title="Play">▶</button>
                </div>
              }
            }
          </div>
        }
        <label class="opt" title="Hover a tool for a moment to see the step that explains it">
          <input type="checkbox" [checked]="tour.tips()" (change)="tour.setTips(checked($event))" /> Show tips on hover
        </label>
        <p class="dim small">The guide uses the real app on copies of the examples. Esc stops it.</p>
      </div>
    </app-panel>
  `,
  styles: `
    .guide {
      display: flex;
      flex-direction: column;
      overflow: auto;
      min-height: 0;
    }
    .sec {
      border-top: 1px solid var(--line);
      padding: 4px 0 4px;
    }
    .sec:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .fold {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: 0;
      padding: 2px 0;
      cursor: pointer;
      color: var(--dim);
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 600;
      text-align: left;
    }
    .fold .chev {
      display: inline-block;
      width: 10px;
      transition: transform 0.12s;
    }
    .fold[aria-expanded='false'] .chev {
      transform: rotate(-90deg);
    }
    .tour,
    .clip {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }
    .tour {
      padding: 6px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .clip .btn {
      padding: 2px 7px;
    }
    .opt {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    p {
      margin: 8px 0 0;
    }
  `,
})
export class GuidePanel {
  protected readonly tour = inject(TourService);
  protected readonly tours = computed(() => TOURS.map((t) => ({ ...t, tour: t, min: Math.max(1, Math.round(playTime(tourBeats(t).map((b) => b.beat)) / 60000)) })));
  protected readonly sections = SECTIONS.map((s) => ({ ...s, snippets: SNIPPETS.filter((x) => x.section === s.id) })).filter((s) => s.snippets.length);
  protected checked = (e: Event): boolean => (e.target as HTMLInputElement).checked;

  /** Folded sections, remembered. */
  private readonly closed = signal<ReadonlySet<string>>(loadClosed());
  protected isOpen = (key: string): boolean => !this.closed().has(key);
  protected fold(key: string): void {
    this.closed.update((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...n]));
      } catch {
        /* no storage */
      }
      return n;
    });
  }

  constructor() {
    effect(() => {
      if (uiResets() === 0) return;
      untracked(() => this.closed.set(new Set()));
    });
  }
}

function loadClosed(): ReadonlySet<string> {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
