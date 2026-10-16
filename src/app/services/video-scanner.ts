import { FRAME_H, FRAME_W, shiftXY, type VideoSample } from '../core/sync/features';

const PIXELS = FRAME_W * FRAME_H;
const MIN_FRAME_GAP = 0.04;

/**
 * Play a video at 3x from `from` to `to` seconds and measure, between consecutive 64x36 grayscale frames: how fast the
 * picture pans, how much it changes and how much brighter the sky half is than the ground half. Browser only.
 */
export async function scanVideo(video: HTMLVideoElement, from: number, to: number, onProgress: (t: number) => void): Promise<VideoSample[]> {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('canvas unavailable');
  const out: VideoSample[] = [];
  let prev: Uint8Array | null = null;
  let prevT = -1;
  let lastT = -1;

  if (from > 0) {
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = from;
    });
  }

  await new Promise<void>((resolve, reject) => {
    const schedule = (cb: (now: number, meta: { mediaTime: number }) => void): void => {
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(cb);
      else requestAnimationFrame(() => cb(0, { mediaTime: video.currentTime }));
    };
    const onFrame = (_now: number, meta: { mediaTime: number }): void => {
      const t = meta.mediaTime;
      if (t - lastT >= MIN_FRAME_GAP) {
        lastT = t;
        g.drawImage(video, 0, 0, FRAME_W, FRAME_H);
        const px = g.getImageData(0, 0, FRAME_W, FRAME_H).data;
        const cur = new Uint8Array(PIXELS);
        for (let i = 0; i < PIXELS; i++) cur[i] = (px[i * 4] as number) * 0.3 + (px[i * 4 + 1] as number) * 0.59 + (px[i * 4 + 2] as number) * 0.11;
        if (prev) {
          const dt = t - prevT;
          if (dt > 0.02) {
            let sum = 0;
            for (let i = 0; i < PIXELS; i++) sum += Math.abs(cur[i]! - prev[i]!);
            const mag = sum / PIXELS / 255;
            const [sx, sy] = shiftXY(prev, cur);
            let top = 0;
            let bottom = 0;
            for (let i = 0; i < PIXELS / 2; i++) top += cur[i]!;
            for (let i = PIXELS / 2; i < PIXELS; i++) bottom += cur[i]!;
            out.push({ t, pan: Math.hypot(sx, sy) / dt, diff: mag / dt, mag, tb: (top - bottom) / (PIXELS / 2) / 255 });
          }
        }
        prev = cur;
        prevT = t;
        onProgress(t);
      }
      if (t >= to || video.ended) {
        video.pause();
        resolve();
      } else schedule(onFrame);
    };
    video.onerror = () => reject(new Error('decode error while scanning'));
    video.playbackRate = 3;
    video.play().then(() => schedule(onFrame)).catch(reject);
  });
  return out;
}
