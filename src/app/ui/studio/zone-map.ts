import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import type { LocationInfo } from '../../core/site-spec';
import { SiteService, MAX_HALF_EXTENT } from '../../services/site.service';
import { StudioService, type Zone } from '../../services/studio.service';

const INSET = 0.08; // the framed zone is the visible map minus this margin on every side
const STREET = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const M_LAT = 111132;

/**
 * A real, pannable map. The dashed frame is the area that will be turned into the 3D model: drag the map under it and
 * zoom to choose what it covers. The frame always keeps the map's own aspect ratio (it is the map minus a margin), so
 * what you see is what gets generated; the readout shows its size in metres.
 */
@Component({
  selector: 'app-zone-map',
  imports: [FormsModule],
  host: { class: 'zm' },
  template: `
    <div #el class="map"></div>
    <div class="frame" [style.inset.%]="inset"></div>
    <div class="search">
      <input type="text" [(ngModel)]="query" placeholder="Search a place or lat,lon" (keydown.enter)="search()" aria-label="Search a place" />
      <button class="btn" (click)="search()" [disabled]="searching()">Go</button>
      <select [value]="studio.basemap()" (change)="setBase($event)" aria-label="Map style">
        <option value="street">Street</option>
        <option value="sat">Satellite</option>
      </select>
    </div>
    @if (hits().length) {
      <div class="hits">
        @for (h of hits(); track h.lat + ',' + h.lon) {
          <button (click)="pick(h)" [title]="h.label">{{ h.label }}</button>
        }
      </div>
    }
    <div class="read" [class.warn]="studio.tooBig()">
      @if (studio.zone(); as z) {
        {{ round(z.halfE * 2) }} × {{ round(z.halfN * 2) }} m
        @if (studio.tooBig()) { · too large: only {{ max * 2 }} m will be used — zoom in }
      }
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      flex: 1 1 auto;
      min-height: 220px;
      border-radius: 6px;
      overflow: hidden;
      background: #0a0f0c;
    }
    .map {
      position: absolute;
      inset: 0;
    }
    .frame {
      position: absolute;
      z-index: 500;
      pointer-events: none;
      border: 2px dashed var(--accent);
      box-shadow: 0 0 0 9999px rgba(8, 14, 10, 0.5);
    }
    .search {
      position: absolute;
      z-index: 1100;
      top: 8px;
      left: 8px;
      right: 8px;
      display: flex;
      gap: 6px;
    }
    .search input {
      flex: 1;
    }
    .hits {
      position: absolute;
      z-index: 1100;
      top: 40px;
      left: 8px;
      right: 8px;
      max-height: 40%;
      overflow: auto;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
    }
    .hits button {
      background: none;
      border: 0;
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 5px 8px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      &:hover {
        background: #31443a;
      }
    }
    .read {
      position: absolute;
      z-index: 1100;
      left: 50%;
      bottom: 12px;
      transform: translateX(-50%);
      background: rgba(10, 16, 12, 0.85);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 2px 10px;
      font: 600 12px var(--mono);
      pointer-events: none;
      white-space: nowrap;
    }
    .read.warn {
      color: var(--warn);
      border-color: var(--warn);
    }
  `,
})
export class ZoneMap {
  protected readonly studio = inject(StudioService);
  private readonly site = inject(SiteService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly el = viewChild.required<ElementRef<HTMLElement>>('el');

  protected readonly inset = INSET * 100;
  protected readonly max = MAX_HALF_EXTENT;
  protected readonly round = Math.round;
  protected query = '';
  protected readonly hits = signal<LocationInfo[]>([]);
  protected readonly searching = signal(false);

  private map: L.Map | null = null;
  private tiles: L.TileLayer | null = null;

  constructor() {
    afterNextRender(() => this.init());
    effect(() => {
      const base = this.studio.basemap();
      this.applyBase(base);
    });
  }

  private init(): void {
    const host = this.el().nativeElement;
    const st = this.studio.start();
    const map = L.map(host, { zoomControl: true, minZoom: 15, maxZoom: 19, zoomSnap: 0.25, attributionControl: true }).setView([st.lat, st.lon], st.zoom);
    this.map = map;
    this.applyBase(this.studio.basemap());
    map.on('move zoom resize', () => this.emit());
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      this.emit();
    });
    ro.observe(host);
    this.emit();
    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      map.remove();
      this.map = null;
    });
  }

  private applyBase(base: 'street' | 'sat'): void {
    const map = this.map;
    if (!map) return;
    this.tiles?.remove();
    this.tiles =
      base === 'sat'
        ? L.tileLayer(SAT, { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' })
        : L.tileLayer(STREET, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    this.tiles.addTo(map);
  }

  /** Recompute the framed zone (centre + half extents in metres) from the current view. */
  private emit(): void {
    const map = this.map;
    if (!map) return;
    const size = map.getSize();
    if (size.x < 40 || size.y < 40) return;
    const ix = size.x * INSET, iy = size.y * INSET;
    const tl = map.containerPointToLatLng([ix, iy]);
    const br = map.containerPointToLatLng([size.x - ix, size.y - iy]);
    const lat = (tl.lat + br.lat) / 2;
    const lon = (tl.lng + br.lng) / 2;
    const zone: Zone = {
      lat,
      lon,
      halfE: (Math.abs(br.lng - tl.lng) / 2) * 111320 * Math.cos((lat * Math.PI) / 180),
      halfN: (Math.abs(tl.lat - br.lat) / 2) * M_LAT,
    };
    this.studio.zone.set(zone);
  }

  protected setBase(e: Event): void {
    this.studio.basemap.set((e.target as HTMLSelectElement).value === 'sat' ? 'sat' : 'street');
  }

  protected async search(): Promise<void> {
    if (!this.query.trim()) return;
    this.searching.set(true);
    try {
      const hits = await this.site.search(this.query, 6);
      if (hits.length === 1) this.pick(hits[0]!);
      else this.hits.set(hits);
    } finally {
      this.searching.set(false);
    }
  }

  protected pick(h: LocationInfo): void {
    this.hits.set([]);
    this.map?.setView([h.lat, h.lon], Math.max(this.map.getZoom(), 17));
    if (this.studio.isNew() && this.studio.name() === 'New bando') this.studio.name.set(h.label.split(',')[0]!.trim() || 'New bando');
  }
}
