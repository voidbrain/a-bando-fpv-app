import { Injectable, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly toast = inject(ToastService);

  save(filename: string, data: BlobPart | Blob, type = 'application/octet-stream'): void {
    try {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      this.toast.show('Download unavailable here');
    }
  }
}
