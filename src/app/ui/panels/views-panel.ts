import { Component, computed, inject } from '@angular/core';
import { CAMERA_VIEWS, SceneService } from '../../services/scene.service';
import { ToastService } from '../../services/toast.service';
import { LayoutStore } from '../../state/layout.store';
import { ViewStore } from '../../state/view.store';
import type { CameraView, MainSource } from '../../core/models';
import { checkedFrom } from '../dom';
import { Panel } from '../panel/panel';
import { PANELS, type PanelDef } from '../panel-defs';

/** The sections below the camera controls: one per kind of work, each with a show / hide-all box. */
const GROUPS: readonly { key: PanelDef['group']; title: string }[] = [
  { key: 'views', title: 'View panels' },
  { key: 'telemetry', title: 'Telemetry' },
  { key: 'simulator', title: 'Simulator' },
  { key: 'tools', title: 'Tools' },
];

@Component({
  selector: 'app-views-panel',
  imports: [Panel],
  styles: `
    h4 .all {
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
    }
  `,
  template: `
    <app-panel id="views">
      <h4>Main page</h4>
      <div class="row">
        @for (s of sources; track s.value) {
          <label class="check"><input type="radio" name="mainSel" [checked]="view.mainSource() === s.value" (change)="view.setMainSource(s.value)" /> {{ s.label }}</label>
        }
      </div>
      <h4>3D camera</h4>
      <div class="row">
        @for (v of cameras; track v) {
          <button class="btn" [class.on]="view.cameraView() === v" (click)="view.setCameraView(v)">{{ names[v] }}</button>
        }
      </div>
      <div class="row col">
        <label class="check"><input type="checkbox" [checked]="view.orbitFollow()" (change)="view.toggleOrbitFollow()" /> Orbit &amp; Top follow the drone (pan stops it; double-click recentres)</label>
        <label class="check"><input type="checkbox" [checked]="view.replayFollow()" (change)="view.toggleReplayFollow()" /> Chase &amp; FPV follow the replay</label>
      </div>
      <div class="row">
        <button class="btn" (click)="view.toggleRoof()">{{ view.roofHidden() ? 'Show roof' : 'Hide roof' }}</button>
        <button class="btn" [class.on]="view.xray()" (click)="toggleXray()">X-ray</button>
        <button class="btn" (click)="scene.resetCamera()">Reset</button>
      </div>
      @for (g of groups(); track g.key) {
        <h4>
          <label class="check all" [title]="'Show or hide every panel in ' + g.title">
            <input type="checkbox" [checked]="g.all" [indeterminate]="g.some && !g.all" (change)="setGroup(g.key, checked($event))" />
            {{ g.title }}
          </label>
        </h4>
        <div class="row">
          @for (p of g.panels; track p.id) {
            <label class="check"><input type="checkbox" [checked]="layout.panels()[p.id].visible" (change)="layout.setVisible(p.id, checked($event))" /> {{ short(p) }}</label>
          }
        </div>
      }
      <div class="row">
        <button class="btn" (click)="setAll(true)" title="Show every panel">Show all</button>
        <button class="btn" (click)="setAll(false)" title="Hide every panel but this one">Hide all</button>
        <button class="btn" (click)="resetLayout()" title="Every panel back to its first place, size and visibility">Reset UI</button>
      </div>
    </app-panel>
  `,
})
export class ViewsPanel {
  protected readonly view = inject(ViewStore);
  protected readonly layout = inject(LayoutStore);
  protected readonly scene = inject(SceneService);
  private readonly toast = inject(ToastService);
  protected readonly cameras = CAMERA_VIEWS;
  protected readonly names: Record<CameraView, string> = { orbit: 'Orbit', chase: 'Chase', fpv: 'FPV', top: 'Top' };
  protected readonly sources: readonly { value: MainSource; label: string }[] = [
    { value: '3d', label: '3D model' },
    { value: 'video', label: 'Video' },
  ];
  protected readonly checked = checkedFrom;
  protected readonly groups = computed(() => {
    const vis = this.layout.panels();
    return GROUPS.map((g) => {
      const panels = PANELS.filter((p) => p.group === g.key && p.id !== 'views');
      const shown = panels.filter((p) => vis[p.id].visible).length;
      return { ...g, panels, all: shown === panels.length, some: shown > 0 };
    }).filter((g) => g.panels.length);
  });

  /** Show or hide every panel of a section. */
  protected setGroup(key: PanelDef['group'], on: boolean): void {
    for (const p of PANELS) if (p.group === key && p.id !== 'views') this.layout.setVisible(p.id, on);
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
