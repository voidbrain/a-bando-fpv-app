// Parses a flight log off the main thread: a 30 MB Blackbox CSV takes seconds, the page stays responsive meanwhile.
import { parseLog } from '../core/flight/log-parser';

addEventListener('message', (e: MessageEvent<File>) => {
  void e.data.text().then(
    (text) => {
      try {
        const log = parseLog(text);
        const tel = log.tel;
        const transfer = tel ? [tel.t, tel.att, tel.rc, tel.mot, tel.gyro, tel.vbat].map((a) => a.buffer as ArrayBuffer) : [];
        postMessage({ log }, { transfer });
      } catch (err) {
        postMessage({ error: (err as Error).message });
      }
    },
    (err: unknown) => postMessage({ error: String(err) }),
  );
});
