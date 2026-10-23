/**
 * What went wrong when the browser refused to keep something, and what the pilot can do about it. Pure.
 */
export type StorageProblem = 'quota' | 'denied' | 'interrupted' | 'other';

/** The kind of a storage error (a DOMException from IndexedDB or localStorage, or anything else). */
export function storageProblem(e: unknown): StorageProblem {
  const name = (e as { name?: unknown } | null)?.name;
  const code = (e as { code?: unknown } | null)?.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
  if (name === 'SecurityError' || name === 'NotAllowedError' || name === 'InvalidAccessError') return 'denied';
  if (name === 'AbortError' || name === 'InvalidStateError' || name === 'TransactionInactiveError') return 'interrupted';
  return 'other';
}

/** The message shown once a write fails: what happened, and the way out (a backup file keeps everything). */
export function storageAdvice(p: StorageProblem): string {
  switch (p) {
    case 'quota':
      return 'The browser’s storage for this site is full: recent changes are kept only until this tab closes. Back up all (Bandos panel), then delete bandos you do not need or free space in the browser.';
    case 'denied':
      return 'This browser does not let OpenBando keep data (a private window, or storage blocked for this site): changes last only until this tab closes. Back up all (Bandos panel) to keep them.';
    case 'interrupted':
      return 'A change could not be saved (the browser interrupted the write). It is still here: save again, or Back up all (Bandos panel) to be safe.';
    default:
      return 'A change could not be saved in the browser. It is still here until this tab closes: Back up all (Bandos panel) to keep it.';
  }
}
