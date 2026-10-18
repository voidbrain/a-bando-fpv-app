import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { AI_MODELS, AiService } from '../../services/ai.service';
import { SiteService } from '../../services/site.service';
import { FloatBox } from '../float-box';

const EXAMPLES: readonly string[] = [
  'Split it into 3 rooms with doors',
  'Add a door on the south wall and windows on the north wall',
  'Add a second floor',
  'Cut the north-east corner, 10 by 8 metres',
];

/** The chat window of the AI assistant: loads the in-browser model on request, then turns messages into edits. */
@Component({
  selector: 'app-assistant-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FloatBox],
  template: `
    <app-float-box fid="assistant" title="AI assistant" [x]="320" [y]="44" [w]="370" [h]="400">
      @if (ai.status() !== 'ready' && ai.status() !== 'loading') {
        <div class="seg">
          <button [class.on]="ai.provider() === 'browser'" (click)="ai.setProvider('browser')">In this browser</button>
          <button [class.on]="ai.provider() === 'server'" (click)="ai.setProvider('server')">Server / home PC</button>
        </div>
      }
      @if (ai.provider() === 'server' && (ai.status() === 'idle' || ai.status() === 'error')) {
        <div class="dim small">Any OpenAI-compatible server: Ollama or LM Studio on your PC (over HTTPS, e.g. Tailscale), a proxy on your hosting, or a cloud API. Your messages and the building list are sent to it.</div>
        <label class="f">address <input type="text" [value]="ai.server().url" placeholder="https://my-pc.tailnet.ts.net  or  https://site.it/ai-proxy.php" (change)="srv({ url: val($event) })" /></label>
        <label class="f">model <input type="text" [value]="ai.server().model" placeholder="qwen2.5:7b" (change)="srv({ model: val($event) })" /></label>
        <label class="f">token (optional) <input type="password" [value]="ai.server().token" autocomplete="off" (change)="srv({ token: val($event) })" /></label>
        @if (ai.status() === 'error') {
          <div class="err">{{ ai.error() }}</div>
        }
        <button class="btn primary" (click)="ai.connect()">Connect</button>
      } @else if (ai.provider() === 'browser' && !ai.supported) {
        <div class="dim">This browser has no WebGPU, which the in-browser model needs. Use a recent desktop Chrome or Edge, or Safari 26 or later, or switch to “Server / home PC”.</div>
      } @else if (ai.status() === 'idle' || ai.status() === 'error') {
        <div class="dim small">A small language model runs inside your browser (nothing is sent anywhere). The first load downloads the model once, then it is cached.</div>
        <label class="f">model
          <select [value]="ai.modelId()" (change)="pickModel($event)">
            @for (m of models; track m.id) {
              <option [value]="m.id" [selected]="m.id === ai.modelId()">{{ m.label }} (~{{ (m.vram / 1000).toFixed(1) }} GB GPU)</option>
            }
          </select>
        </label>
        @if (ai.status() === 'error') {
          <div class="err">{{ ai.error() }}</div>
        }
        <button class="btn primary" (click)="ai.load()">Load model</button>
      } @else if (ai.status() === 'loading') {
        <div class="dim small">{{ ai.progressText() }}</div>
        @if (ai.provider() === 'browser') {
          <div class="bar"><i [style.width.%]="ai.progress() * 100"></i></div>
          <div class="dim small">Keep this tab open. The first download can take several minutes.</div>
        }
      } @else {
        <div class="ctx dim small">{{ context() }}</div>
        <div class="msgs" #msgs>
          @if (ai.messages().length === 0) {
            <div class="dim small">Tell me what to change in the selected building, or name it. Try:</div>
            <div class="chips">
              @for (e of examples; track e) {
                <button class="chip" (click)="send(e)">{{ e }}</button>
              }
            </div>
          }
          @for (m of ai.messages(); track $index) {
            <div class="m" [class.me]="m.role === 'user'">
              @if (m.text) {
                <div>{{ m.text }}</div>
              }
              @for (d of m.done ?? []; track $index) {
                <div class="ok">✓ {{ d }}</div>
              }
              @for (x of m.errors ?? []; track $index) {
                <div class="bad">⚠ {{ x }}</div>
              }
            </div>
          }
          @if (ai.busy()) {
            <div class="m dim">thinking…</div>
          }
        </div>
        <div class="in">
          <textarea #box rows="2" placeholder="e.g. split into 2 rooms, add a door on the east wall" (keydown)="key($event, box)" [disabled]="ai.busy()"></textarea>
          <button class="btn primary" (click)="send(box.value); box.value = ''" [disabled]="ai.busy()">Send</button>
        </div>
        <div class="row2">
          <button class="btn" (click)="ai.undoLast()" [disabled]="!ai.canUndo()">Undo last AI change</button>
          <button class="btn" (click)="ai.clear()" [disabled]="ai.messages().length === 0">Clear chat</button>
          <span class="grow"></span>
          <button class="btn" (click)="ai.unload()" [title]="ai.provider() === 'browser' ? 'Free the GPU memory' : 'Disconnect'">{{ ai.provider() === 'browser' ? 'Unload' : 'Disconnect' }}</button>
        </div>
      }
    </app-float-box>
  `,
  styles: `
    .seg {
      display: inline-flex;
      align-self: flex-start;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }
    .seg button {
      background: none;
      border: 0;
      padding: 3px 9px;
      cursor: pointer;
      color: var(--dim);
    }
    .seg button.on {
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 700;
    }
    .f input {
      width: 100%;
    }
    .f {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .err,
    .bad {
      color: var(--warn);
      font-size: 12px;
    }
    .ok {
      color: var(--accent);
      font-size: 12px;
    }
    .bar {
      height: 8px;
      border-radius: 4px;
      background: #1c2a22;
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    .msgs {
      flex: 1 1 auto;
      min-height: 80px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .m {
      background: #17211b;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 5px 8px;
      font-size: 12.5px;
    }
    .m.me {
      align-self: flex-end;
      background: #223329;
      max-width: 90%;
    }
    .chips {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .chip {
      text-align: left;
      background: none;
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 4px 8px;
      cursor: pointer;
      color: inherit;
    }
    .chip:hover {
      border-color: var(--accent);
    }
    .in {
      display: flex;
      gap: 6px;
      align-items: stretch;
    }
    .in textarea {
      flex: 1;
      resize: none;
    }
    .row2 {
      display: flex;
      gap: 6px;
    }
  `,
})
export class AssistantBox {
  protected readonly ai = inject(AiService);
  private readonly site = inject(SiteService);
  protected readonly models = AI_MODELS;
  protected readonly examples = EXAMPLES;
  private readonly msgs = viewChild<ElementRef<HTMLElement>>('msgs');

  constructor() {
    effect(() => {
      this.ai.messages();
      this.ai.busy();
      queueMicrotask(() => {
        const el = this.msgs()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected context(): string {
    const b = this.site.editor.building();
    return b ? `Selected: ${b.name}` : `No building selected${this.site.editor.draft().buildings.length === 1 ? ' (only one: I will use it)' : ': name the building in your message'}`;
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected srv(patch: Partial<{ url: string; model: string; token: string }>): void {
    this.ai.saveServer({ ...this.ai.server(), ...patch });
  }

  protected pickModel(e: Event): void {
    this.ai.setModel((e.target as HTMLSelectElement).value);
  }

  protected send(text: string): void {
    void this.ai.send(text);
  }

  protected key(e: KeyboardEvent, box: HTMLTextAreaElement): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.ai.send(box.value);
      box.value = '';
    }
    e.stopPropagation(); // typing must not trigger the editor's Delete / Undo shortcuts
  }
}
