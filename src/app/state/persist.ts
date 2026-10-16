import { effect, inject } from '@angular/core';
import { getState, type StateSource } from '@ngrx/signals';
import { StorageService } from '../services/storage.service';

/**
 * Persist a SignalStore's whole state to localStorage whenever it changes.
 * Must run in an injection context (call it from a `withHooks` factory).
 */
export function persistState<S extends object>(store: StateSource<S>, key: string, storage: StorageService = inject(StorageService)): void {
  effect(() => storage.write(key, getState(store)));
}

/** Initial state: defaults merged with whatever was saved. Call inside a `withState(() => ...)` factory. */
export function savedState<S extends object>(key: string, defaults: S, storage: StorageService = inject(StorageService)): S {
  return storage.read(key, defaults);
}
