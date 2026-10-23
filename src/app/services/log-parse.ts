import { parseLog, type ParsedLog } from '../core/flight/log-parser';

/** Parse a log file in a Web Worker (the main thread stays free); where workers are missing (tests), right here. */
export function parseLogFile(file: File): Promise<ParsedLog> {
  if (typeof Worker === 'undefined') return file.text().then(parseLog);
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./log-parse.worker', import.meta.url), { type: 'module' });
    const done = (): void => w.terminate();
    w.onmessage = (e: MessageEvent<{ log?: ParsedLog; error?: string }>) => {
      done();
      if (e.data.log) resolve(e.data.log);
      else reject(new Error(e.data.error ?? 'could not read the log'));
    };
    w.onerror = (e) => {
      done();
      e.preventDefault();
      // a worker that cannot start (old browser, strict hosting): parse here instead
      file.text().then(parseLog).then(resolve, reject);
    };
    w.postMessage(file);
  });
}
