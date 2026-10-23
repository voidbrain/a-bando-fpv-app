import { Component, computed, inject } from '@angular/core';
import { SECTIONS, SNIPPETS, TOURS, playTime, tourBeats } from '../../core/tour';
import { TourService } from '../../services/tour.service';
import { Panel } from '../panel/panel';

/**
 * Guide me: the guided tours and every snippet on its own, grouped like the help pages (docs/guide). Shown on the first
 * visit; afterwards it is an ordinary panel (Views shows or hides it). A snippet can be recorded as a clip for the docs.
 */
@Component({
  selector: 'app-guide-panel',
  imports: [Panel],
  template: `
    <app-panel id="guide">
      <div class="guide">
        <h4>Tours</h4>
        @for (t of tours(); track t.id) {
          <div class="tour">
            <div class="grow">
              <b>{{ t.title }}</b> <span class="dim small mono">~{{ t.min }} min</span>
              <div class="dim small">{{ t.about }}</div>
            </div>
            <button class="btn primary" (click)="tour.playTour(t.tour)" [disabled]="!!tour.state()">▶ Play</button>
          </div>
        }
        <label class="opt" title="Hover a tool for a moment to see the snippet that explains it">
          <input type="checkbox" [checked]="tour.tips()" (change)="tour.setTips(checked($event))" /> Show tips on hover
        </label>
        @for (sec of sections; track sec.id) {
          <h4>{{ sec.title }}</h4>
          @for (s of sec.snippets; track s.id) {
            <div class="clip">
              <span class="grow">{{ s.title }}</span>
              <button class="btn" (click)="tour.playSnippet(s)" [disabled]="!!tour.state()" [attr.aria-label]="'Play: ' + s.title" title="Play">▶</button>
              <button class="btn" (click)="tour.record(s)" [disabled]="!!tour.state()" [attr.aria-label]="'Record a clip: ' + s.title" title="Record this snippet as a video clip (the browser asks to share this tab)">⏺</button>
            </div>
          }
        }
        <p class="dim small">The tour uses the real app on a copy of an example bando. Esc stops it.</p>
      </div>
    </app-panel>
  `,
  styles: `
    .guide {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: auto;
      min-height: 0;
    }
    h4 {
      margin: 8px 0 2px;
    }
    h4:first-child {
      margin-top: 0;
    }
    .tour,
    .clip {
      display: flex;
      align-items: center;
      gap: 6px;
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
      margin-top: 4px;
    }
    p {
      margin: 8px 0 0;
    }
  `,
})
export class GuidePanel {
  protected readonly tour = inject(TourService);
  protected readonly tours = computed(() => TOURS.map((t) => ({ ...t, tour: t, min: Math.max(1, Math.round(playTime(tourBeats(t).map((b) => b.beat)) / 60000)) })));
  protected readonly sections = SECTIONS.map((s) => ({ ...s, snippets: SNIPPETS.filter((x) => x.section === s.id) }));
  protected checked = (e: Event): boolean => (e.target as HTMLInputElement).checked;
}
