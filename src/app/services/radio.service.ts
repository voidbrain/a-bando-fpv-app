import { Injectable, inject, signal } from '@angular/core';
import { readPilotInput, pickGamepad, type HeldKeys, type RadioReading, type PadLike } from '../core/radio/radio-input';
import { RadioStore } from '../state/radio.store';
import type { RadioMapping } from '../core/radio/radio-input';

/** Keyboard + gamepad / radio transmitter (e.g. RadioMaster Zorro over USB) as a single pilot input. */
@Injectable({ providedIn: 'root' })
export class RadioService {
  private readonly mapping = inject(RadioStore);
  private readonly keysDown: Record<string, boolean | undefined> = {};
  /** Name of the connected controller, or null. */
  readonly padName = signal<string | null>(null);
  /** Set once the first controller shows up so the radio panel can open itself. */
  readonly firstSeen = signal(false);
  /** Raw axes of the connected controller (hot data for the radio panel's live bars). */
  axes: readonly number[] = [];

  constructor() {
    addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      this.keysDown[e.code] = true;
      if (/^Arrow|Space/.test(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => (this.keysDown[e.code] = false));
    addEventListener('blur', () => Object.keys(this.keysDown).forEach((k) => (this.keysDown[k] = false)));
  }

  get keys(): HeldKeys {
    return this.keysDown;
  }

  /** Current pilot command. Call once per frame. */
  read(): RadioReading {
    const pad = this.currentPad();
    this.axes = pad?.axes ?? [];
    const name = pad?.id ?? null;
    if (name !== this.padName()) {
      this.padName.set(name);
      if (name) this.firstSeen.set(true);
    }
    return readPilotInput(this.keysDown, pad, this.snapshot());
  }

  snapshot(): RadioMapping {
    return {
      roll: this.mapping.roll(), pitch: this.mapping.pitch(), thr: this.mapping.thr(), yaw: this.mapping.yaw(),
      arm: this.mapping.arm(), mode: this.mapping.mode(), spring: this.mapping.spring(), rate: this.mapping.rate(), expo: this.mapping.expo(),
    };
  }

  isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && /INPUT|SELECT|TEXTAREA/.test(t.tagName);
  }

  private currentPad(): PadLike | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    return pickGamepad<Gamepad>(Array.from(navigator.getGamepads()));
  }
}
