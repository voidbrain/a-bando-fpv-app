import { Injectable, inject, signal } from '@angular/core';
import { MAP_IMAGE } from '../core/constants';
import { LayoutStore } from '../state/layout.store';
import { MapStore } from '../state/map.store';
import { ToastService } from './toast.service';

/** The image shown in the Map panel when the background is "satellite image". */
export interface MapImage {
  url: string;
  width: number;
  height: number;
  /** Image centre in the model frame (metres, before model scale). */
  centreX: number;
  centreZ: number;
  /** 'builtin': the shipped screenshot with a known orientation. 'north': a user image, assumed north-up. */
  base: 'builtin' | 'north';
}

const BUILTIN: MapImage = { url: MAP_IMAGE.url, width: MAP_IMAGE.width, height: MAP_IMAGE.height, centreX: MAP_IMAGE.centre.x, centreZ: MAP_IMAGE.centre.z, base: 'builtin' };

@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly store = inject(MapStore);
  private readonly layout = inject(LayoutStore);
  private readonly toast = inject(ToastService);
  readonly image = signal<MapImage>(BUILTIN);

  /** Replace the map with a user screenshot (paste, drop, or the Load map button). */
  loadFile(file: File | null | undefined): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => {
        this.image.set({ url, width: img.naturalWidth, height: img.naturalHeight, centreX: 0, centreZ: 0, base: 'north' });
        this.store.resetAlignment();
        this.store.setBackground('img');
        this.layout.setVisible('map', true);
        this.toast.show('Map image loaded (assumed north-up). Align it with scale / rotation / shift.');
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  }

  /** Rotation of image-up in the model frame for the built-in screenshot, degrees. */
  readonly builtinUpDeg = MAP_IMAGE.upAngle;
}
