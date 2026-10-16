import { Injectable } from '@angular/core';

/** localStorage with JSON, tolerant of private mode / quota errors / corrupt values. */
@Injectable({ providedIn: 'root' })
export class StorageService {
  read<T extends object>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? { ...fallback, ...(parsed as Partial<T>) } : fallback;
    } catch {
      return fallback;
    }
  }

  readRaw(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      /* storage unavailable or full: the app keeps working, just without memory */
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
