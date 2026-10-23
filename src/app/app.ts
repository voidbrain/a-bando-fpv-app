import { Component, effect, inject, untracked } from '@angular/core';
import { FlightService } from './services/flight.service';
import { FrameLoopService } from './services/frame-loop.service';
import { RadioService } from './services/radio.service';
import { ShortcutsService } from './services/shortcuts.service';
import { FlightStore } from './state/flight.store';
import { LayoutStore } from './state/layout.store';
import { AttitudePanel } from './ui/panels/attitude-panel';
import { BlackboxPanel } from './ui/panels/blackbox-panel';
import { CompassPanel } from './ui/panels/compass-panel';
import { FlightsPanel } from './ui/panels/flights-panel';
import { HelpPanel } from './ui/panels/help-panel';
import { GuidePanel } from './ui/panels/guide-panel';
import { TourOverlay } from './ui/tour-overlay';
import { LivePanel } from './ui/panels/live-panel';
import { PathPanel } from './ui/panels/path-panel';
import { RadioPanel } from './ui/panels/radio-panel';
import { RenderPanel } from './ui/panels/render-panel';
import { SimulatorPanel } from './ui/panels/simulator-panel';
import { SpeedPanel } from './ui/panels/speed-panel';
import { TimelinePanel } from './ui/panels/timeline-panel';
import { VideoPanel } from './ui/panels/video-panel';
import { ViewportPanel } from './ui/panels/viewport-panel';
import { ViewsPanel } from './ui/panels/views-panel';
import { Stage } from './ui/stage/stage';
import { StudioPanel } from './ui/studio/studio-panel';
import { VersionBadge } from './ui/version-badge';
import { ToastHost } from './ui/toast-host';

/** Root: the full-page stage plus every floating panel. Panels hide themselves; nothing here holds state. */
@Component({
  selector: 'app-root',
  imports: [
    Stage, ViewsPanel, FlightsPanel, SimulatorPanel, RadioPanel, TimelinePanel, SpeedPanel, AttitudePanel, CompassPanel, PathPanel,
    BlackboxPanel, VideoPanel, LivePanel, RenderPanel, HelpPanel, GuidePanel, ViewportPanel, VersionBadge, StudioPanel, ToastHost, TourOverlay,
  ],
  template: `
    <app-stage />
    <app-version-badge />
    <app-views-panel />
    <app-flights-panel />
    <app-simulator-panel />
    <app-radio-panel />
    <app-timeline-panel />
    <app-speed-panel />
    <app-attitude-panel />
    <app-compass-panel />
    <app-path-panel />
    <app-studio-panel />
    <app-blackbox-panel />
    <app-video-panel />
    <app-live-panel />
    <app-render-panel />
    <app-help-panel />
    <app-guide-panel />
    <app-viewport-panel type="orbit" />
    <app-viewport-panel type="chase" />
    <app-viewport-panel type="fpv" />
    <app-viewport-panel type="top" />
    <app-toast-host />
    <app-tour-overlay />
  `,
})
export class App {
  private readonly layout = inject(LayoutStore);
  private readonly flightStore = inject(FlightStore);
  private readonly flights = inject(FlightService);
  private readonly radio = inject(RadioService);
  private openedRadio = false;

  constructor() {
    inject(ShortcutsService).bind();
    inject(FrameLoopService).start();

    // A log with Blackbox telemetry opens the Blackbox panel.
    effect(() => {
      const active = this.flightStore.activeId();
      untracked(() => {
        if (active && this.flights.active?.tel) this.layout.setVisible('blackbox', true);
      });
    });
    // The radio panel opens itself the first time a controller is seen.
    effect(() => {
      if (this.radio.firstSeen() && !this.openedRadio) {
        this.openedRadio = true;
        untracked(() => this.layout.setVisible('radio', true));
      }
    });
  }
}
