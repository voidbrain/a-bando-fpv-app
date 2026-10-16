import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FlightService } from '../../services/flight.service';
import { FlightStore } from '../../state/flight.store';
import { PlaybackService } from '../../services/playback.service';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-flights-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="flights">
      <div class="row">
        <label class="btn">Upload log<input type="file" accept=".csv,.txt,.gpx,.json" multiple hidden (change)="upload($event)" /></label>
        <button class="btn" [disabled]="!store.count()" (click)="flights.clear()">Clear paths</button>
      </div>
      <div class="keep list">
        @for (f of store.flights(); track f.id) {
          <button class="item" [class.active]="f.id === store.activeId()" (click)="store.activate(f.id)">
            <b>{{ f.name }}</b>
            <span class="dim small mono">{{ f.stats }}</span>
          </button>
        } @empty {
          <div class="dim small">Drop a Betaflight Blackbox CSV, GPX or JSON log on the page (or Upload) to see the flight path.</div>
        }
      </div>
      @if (store.count()) {
        <div class="dim small">blue = slow → red = {{ topSpeed() }} km/h</div>
      }
    </app-panel>
  `,
  styles: `
    .list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 180px;
      overflow: auto;
    }
    .item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 3px 6px;
      cursor: pointer;
      &:hover {
        background: #27352c;
      }
      &.active {
        border-color: var(--accent);
      }
    }
  `,
})
export class FlightsPanel {
  protected readonly store = inject(FlightStore);
  protected readonly flights = inject(FlightService);
  protected readonly playback = inject(PlaybackService);
  protected readonly topSpeed = computed(() => (this.store.revision() >= 0 ? (this.flights.speedMax * 3.6).toFixed(0) : '0'));

  protected upload(e: Event): void {
    const input = e.target as HTMLInputElement;
    void this.flights.loadFiles(Array.from(input.files ?? []));
    input.value = '';
  }
}
