import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CAMERA_VIEWS, SceneService } from '../../services/scene.service';
import { ToastService } from '../../services/toast.service';
import { LayoutStore, uiResets } from '../../state/layout.store';
import { ViewStore } from '../../state/view.store';
import type { CameraView, MainSource } from '../../core/models';
import { Panel } from '../panel/panel';
import { PANELS, type PanelDef, type PanelId } from '../panel-defs';
import { ToolIcon } from '../studio/tool-icon';

/** The sections below the camera: one per kind of work (Telemetry split into the panels you use and the ones that show the flight). */
const GROUPS: readonly { key: string; title: string; subs: readonly { title: string; ids: readonly PanelId[] }[] }[] = [
  { key: 'views', title: 'View panels', subs: [{ title: '', ids: ids((p) => p.group === 'views') }] },
  {
    key: 'telemetry',
    title: 'Telemetry',
    subs: [
      { title: 'Controls', ids: ids((p) => p.group === 'telemetry' && p.sub !== 'views') },
      { title: 'Views', ids: ids((p) => p.group === 'telemetry' && p.sub === 'views') },
    ],
  },
  { key: 'simulator', title: 'Simulator', subs: [{ title: '', ids: ids((p) => p.group === 'simulator') }] },
  { key: 'tools', title: 'Tools', subs: [{ title: '', ids: ids((p) => p.group === 'tools') }] },
];
function ids(f: (p: PanelDef) => boolean): PanelId[] {
  return PANELS.filter((p) => p.id !== 'views' && f(p)).map((p) => p.id);
}

const CLOSED_KEY = 'abando-float-views-closed';
const CAMERA_ICON: Record<CameraView, string> = { orbit: 'camOrbit', chase: 'camChase', fpv: 'camFpv', top: 'camTop' };

/**
 * Views: what the main page shows, the 3D camera, and which panels are open. Sections fold like the inspector's; an eye
 * shows or hides one panel, the eye on a section all of its panels.
 */
@Component({
  selector: 'app-views-panel',
  imports: [Panel, ToolIcon],
  styles: `
    .top {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ib {
      display: inline-grid;
      place-items: center;
      padding: 3px 5px;
    }
    .sec {
      border-top: 1px solid var(--line);
      padding: 4px 0 2px;
      margin-top: 4px;
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
    .eye {
      background: none;
      border: 0;
      padding: 1px 2px;
      cursor: pointer;
      color: var(--dim);
      display: inline-grid;
      place-items: center;
    }
    .eye.on {
      color: var(--accent);
    }
    .sub {
      font-size: 10px;
      color: var(--dim);
      margin: 4px 0 1px;
    }
    .list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 6px;
    }
    .vis {
      display: flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: 0;
      padding: 1px 0;
      cursor: pointer;
      text-align: left;
      color: var(--dim);
      min-width: 0;
    }
    .vis.on {
      color: var(--text);
    }
    .vis.on app-tool-icon {
      color: var(--accent);
    }
    .vis span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vis app-tool-icon,
    .eye app-tool-icon {
      transform: scale(0.8);
    }
    .cams {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px;
      margin: 4px 0;
    }
    .lab {
      width: 46px;
      color: var(--dim);
      font-size: 10px;
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }
    .seg button {
      display: inline-grid;
      place-items: center;
      background: none;
      border: 0;
      padding: 3px 7px;
      cursor: pointer;
      color: var(--dim);
    }
    .seg button + button {
      border-left: 1px solid var(--line);
    }
    .seg button.on {
      background: var(--accent);
      color: var(--accent-ink);
    }
    .seg button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
  `,
  template: `
    <app-panel id="views">
      <div class="top">
        <span class="grow dim small">Panels</span>
        <button class="btn ib" (click)="setAll(true)" title="Show every panel" aria-label="Show every panel"><app-tool-icon name="eye" /></button>
        <button class="btn ib" (click)="setAll(false)" title="Hide every panel but this one" aria-label="Hide every panel but this one"><app-tool-icon name="eyeOff" /></button>
        <button class="btn ib" (click)="resetLayout()" title="Reset UI: every panel back to its first place, size and visibility" aria-label="Reset UI"><app-tool-icon name="resetLayout" /></button>
      </div>

      <div class="sec">
        <div class="head">
          <button class="fold" [attr.aria-expanded]="isOpen('main')" (click)="fold('main')"><span class="chev">▾</span> Main page</button>
        </div>
        @if (isOpen('main')) {
          <div class="row">
            @for (s of sources; track s.value) {
              <label class="check"><input type="radio" name="mainSel" [checked]="view.mainSource() === s.value" (change)="view.setMainSource(s.value)" /> {{ s.label }}</label>
            }
          </div>
        }
      </div>

      <div class="sec">
        <div class="head">
          <button class="fold" [attr.aria-expanded]="isOpen('camera')" (click)="fold('camera')"><span class="chev">▾</span> 3D camera</button>
        </div>
        @if (isOpen('camera')) {
          <!-- which camera the main page uses: one of four (a segmented switch) -->
          <div class="cams">
            <span class="lab">camera</span>
            <div class="seg" role="group" aria-label="Main page camera">
              @for (v of cameras; track v) {
                <button [class.on]="view.cameraView() === v" (click)="view.setCameraView(v)" [title]="camHint[v]" [attr.aria-label]="names[v]" [attr.aria-pressed]="view.cameraView() === v"><app-tool-icon [name]="camIcon[v]" /></button>
              }
            </div>
          </div>
          <!-- how the 3D is shown, whatever the camera: independent toggles, and the reset -->
          <div class="cams" role="group" aria-label="View options">
            <span class="lab">view</span>
            <button class="btn ib" [class.on]="follow()" (click)="toggleFollow()" [title]="followHint()" [attr.aria-label]="followHint()" [attr.aria-pressed]="follow()"><app-tool-icon name="follow" /></button>
            <button class="btn ib" [class.on]="view.roofHidden()" (click)="view.toggleRoof()" [title]="view.roofHidden() ? 'Roofs hidden: show them again' : 'Hide the roofs (see inside the buildings)'" aria-label="Hide roofs" [attr.aria-pressed]="view.roofHidden()"><app-tool-icon name="roof" /></button>
            <button class="btn ib" [class.on]="view.satGround()" (click)="view.toggleSatGround()" title="Satellite picture on the 3D ground (bandos with a place and real ground; imagery © Esri, Maxar)" aria-label="Satellite ground" [attr.aria-pressed]="view.satGround()"><app-tool-icon name="satellite" /></button>
            <button class="btn ib" [class.on]="view.xray()" (click)="toggleXray()" title="X-ray: whatever stands between the camera and the drone fades" aria-label="X-ray" [attr.aria-pressed]="view.xray()"><app-tool-icon name="xray" /></button>
            <button class="btn ib" (click)="scene.resetCamera()" title="Reset the camera" aria-label="Reset the camera"><app-tool-icon name="recentre" /></button>
          </div>
        }
      </div>

      @for (g of groups(); track g.key) {
        <div class="sec">
          <div class="head">
            <button class="fold" [attr.aria-expanded]="isOpen(g.key)" (click)="fold(g.key)"><span class="chev">▾</span> {{ g.title }}</button>
            <button class="eye" [class.on]="g.some" (click)="setGroup(g.ids, !g.all)" [title]="(g.all ? 'Hide every panel in ' : 'Show every panel in ') + g.title" [attr.aria-label]="(g.all ? 'Hide every panel in ' : 'Show every panel in ') + g.title" [attr.aria-pressed]="g.all ? true : g.some ? 'mixed' : false">
              <app-tool-icon [name]="g.all ? 'eye' : g.some ? 'eyeHalf' : 'eyeOff'" />
            </button>
          </div>
          @if (isOpen(g.key)) {
            @for (s of g.subs; track $index) {
              @if (s.title) { <div class="sub">{{ s.title }}</div> }
              <div class="list">
                @for (p of s.panels; track p.id) {
                  <button class="vis" [class.on]="layout.panels()[p.id].visible" (click)="layout.toggle(p.id)" [attr.aria-pressed]="layout.panels()[p.id].visible" [title]="(layout.panels()[p.id].visible ? 'Hide ' : 'Show ') + p.title">
                    <app-tool-icon [name]="layout.panels()[p.id].visible ? 'eye' : 'eyeOff'" /><span>{{ short(p) }}</span>
                  </button>
                }
              </div>
            }
          }
        </div>
      }
    </app-panel>
  `,
})
export class ViewsPanel {
  protected readonly view = inject(ViewStore);
  protected readonly layout = inject(LayoutStore);
  protected readonly scene = inject(SceneService);
  private readonly toast = inject(ToastService);
  protected readonly cameras = CAMERA_VIEWS;
  protected readonly camIcon = CAMERA_ICON;
  protected readonly names: Record<CameraView, string> = { orbit: 'Orbit', chase: 'Chase', fpv: 'FPV', top: 'Top' };
  protected readonly camHint: Record<CameraView, string> = {
    orbit: 'Orbit: turn around the drone or the bando (drag to turn, wheel to zoom)',
    chase: 'Chase: behind the drone',
    fpv: 'FPV: from the drone’s camera',
    top: 'Top: from above, north up',
  };
  protected readonly sources: readonly { value: MainSource; label: string }[] = [
    { value: '3d', label: '3D model' },
    { value: 'video', label: 'Video' },
  ];
  /** Follow means one thing per camera pair: Orbit & Top keep the drone in the middle, Chase & FPV ride along the replay. */
  private readonly orbitLike = computed(() => this.view.cameraView() === 'orbit' || this.view.cameraView() === 'top');
  protected readonly follow = computed(() => (this.orbitLike() ? this.view.orbitFollow() : this.view.replayFollow()));
  protected readonly followHint = computed(() =>
    this.orbitLike() ? 'Follow the drone (Orbit & Top; panning stops it, double-click recentres)' : 'Follow the replay (Chase & FPV)',
  );
  protected toggleFollow(): void {
    if (this.orbitLike()) this.view.toggleOrbitFollow();
    else this.view.toggleReplayFollow();
  }

  protected readonly groups = computed(() => {
    const vis = this.layout.panels();
    return GROUPS.map((g) => {
      const all = g.subs.flatMap((s) => s.ids);
      const shown = all.filter((id) => vis[id].visible).length;
      return { ...g, ids: all, subs: g.subs.map((s) => ({ title: s.title, panels: s.ids.map((id) => PANELS.find((p) => p.id === id)!) })), all: shown === all.length, some: shown > 0 };
    }).filter((g) => g.ids.length);
  });

  /** Folded sections, remembered (Reset UI opens them all again). */
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

  /** Show or hide every panel of a section. */
  protected setGroup(ids: readonly PanelId[], on: boolean): void {
    for (const id of ids) this.layout.setVisible(id, on);
  }

  /** Every panel at once; Views itself always stays, or there would be no way back. */
  protected setAll(on: boolean): void {
    for (const p of PANELS) if (p.id !== 'views') this.layout.setVisible(p.id, on);
  }

  protected short(p: PanelDef): string {
    return p.title.replace(' view', '').replace(' · north up', '');
  }

  protected toggleXray(): void {
    this.view.toggleXray();
    this.toast.show(this.view.xray() ? 'X-ray on: obstacles fade when they hide the drone' : 'X-ray off');
  }

  protected resetLayout(): void {
    this.layout.reset();
    this.toast.show('Layout reset');
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
