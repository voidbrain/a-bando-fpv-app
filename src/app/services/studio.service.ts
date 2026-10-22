import { Service, computed, inject, signal } from '@angular/core';
import type { SiteSpec } from '../core/site-spec';
import { MAX_HALF_EXTENT, SiteService } from './site.service';
import { ToastService } from './toast.service';

/** The map zone as drawn on screen: centre and half extents in metres (east-west, north-south). */
export interface Zone {
  lat: number;
  lon: number;
  halfE: number;
  halfN: number;
  rotDeg?: number;
}

/** Where the zone map starts: a centre and a Leaflet zoom level. */
export interface MapStart {
  lat: number;
  lon: number;
  zoom: number;
}

const DEFAULT_START: MapStart = { lat: 45.6669, lon: 12.2431, zoom: 17 }; // Treviso, until the user searches somewhere

/**
 * The Bandos workflow: pick a bando from the list, or create / edit one on the zone map. The panel shows either the
 * list or the zone editor; this service holds which, what is being edited and the zone currently framed on the map.
 */
@Service()
export class StudioService {
  private readonly site = inject(SiteService);
  private readonly toast = inject(ToastService);

  readonly view = signal<'list' | 'zone'>('list');
  /** The bando being edited; null while creating a new one. */
  readonly editingId = signal<string | null>(null);
  readonly name = signal('New bando');
  readonly start = signal<MapStart>(DEFAULT_START);
  /** Written by the map on every pan / zoom / resize. */
  readonly zone = signal<Zone | null>(null);
  readonly basemap = signal<'street' | 'sat' | 'off'>('street');
  /** Opacity of the map under the model (0.2 – 1). */
  readonly mapOpacity = signal(1);
  /** Which editor tab a freshly opened bando starts on, and the half extents of its stored area (metres). */
  readonly initialMode = signal<'area' | 'model'>('area');
  readonly startHalf = signal<{ e: number; n: number; rot?: number } | null>(null);
  readonly busy = this.site.generating;

  readonly isNew = computed(() => this.editingId() === null);
  readonly tooBig = computed(() => {
    const z = this.zone();
    return !!z && (z.halfE > MAX_HALF_EXTENT || z.halfN > MAX_HALF_EXTENT);
  });

  /** Start a new bando on the map (at the last known location). */
  create(): void {
    const last = this.site.active();
    const hasLoc = last.origin.lat !== 0 || last.origin.lon !== 0;
    this.editingId.set(null);
    this.name.set('New bando');
    this.start.set(hasLoc ? { lat: last.origin.lat, lon: last.origin.lon, zoom: 17 } : DEFAULT_START);
    this.startHalf.set(null);
    this.initialMode.set('area');
    this.zone.set(null);
    this.view.set('zone');
  }

  /** Open a bando on the zone map: its stored zone, or its origin when it predates zones. */
  edit(id: string): void {
    const spec = this.site.peek(id);
    if (!spec) return;
    if (this.site.active().id !== id) this.site.useStored(id);
    this.editingId.set(id);
    this.name.set(spec.name);
    this.start.set(startFor(spec));
    this.startHalf.set(spec.zone ? { e: spec.zone.halfE, n: spec.zone.halfN, rot: spec.zone.rotDeg ?? 0 } : null);
    this.initialMode.set(spec.buildings.length > 0 && spec.bearingDeg === 0 ? 'model' : 'area');
    this.zone.set(null);
    this.view.set('zone');
  }

  /** Load a bando into the 3D scene without leaving the list. */
  open(id: string): void {
    this.site.useStored(id);
  }

  back(): void {
    if (this.editingId()) this.site.saveDraft();
    this.view.set('list');
  }

  /** Build (or rebuild) the 3D model from the framed zone. */
  async generate(): Promise<void> {
    const z = this.zone();
    if (!z) {
      this.toast.show('Move the map to frame the area first.');
      return;
    }
    const id = this.editingId();
    const existing = id ? this.site.peek(id) : null;
    if (existing && existing.buildings.length > 0 && !confirm('Regenerating replaces this bando\'s model, including your manual edits. Continue?')) return;
    const label = this.name().trim() || 'New bando';
    const spec = await this.site.generate(
      { label, lat: z.lat, lon: z.lon },
      { area: { halfE: z.halfE, halfN: z.halfN, rotDeg: z.rotDeg ?? 0 }, keep: existing ? { id: existing.id, name: label, createdAt: existing.createdAt } : { name: label } },
    );
    if (spec) this.editingId.set(spec.id);
  }
}

function startFor(spec: SiteSpec): MapStart {
  if (spec.zone) {
    // choose a zoom at which the stored zone fits a typical panel: ~ 2 * halfE metres across 420 px
    const mpp = (spec.zone.halfE * 2) / 320;
    const zoom = Math.round(Math.log2((156543.03 * Math.cos((spec.zone.lat * Math.PI) / 180)) / mpp));
    return { lat: spec.zone.lat, lon: spec.zone.lon, zoom: Math.min(19, Math.max(15, zoom)) };
  }
  return { lat: spec.origin.lat, lon: spec.origin.lon, zoom: 17 };
}
