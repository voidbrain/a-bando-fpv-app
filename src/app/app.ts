import { Component, afterNextRender, effect, inject, untracked } from '@angular/core';
import { SHOWCASE, showcaseLink } from './core/tour';
import { I18nService } from './services/i18n.service';
import { TourService } from './services/tour.service';
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
import { WelcomePanel } from './ui/panels/welcome-panel';
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
    BlackboxPanel, VideoPanel, LivePanel, RenderPanel, HelpPanel, GuidePanel, WelcomePanel, ViewportPanel, VersionBadge, StudioPanel, ToastHost, TourOverlay,
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
    <app-welcome-panel />
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
    // a showcase link (?tour=showcase&lang=it): set the language, then the one-minute tour plays by itself
    const link = showcaseLink(location.search, location.hash);
    if (link) {
      const i18n = inject(I18nService), tour = inject(TourService);
      if (link.lang) i18n.set(link.lang);
      afterNextRender(() => setTimeout(() => void tour.playTour(SHOWCASE), 1200));
    }
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
