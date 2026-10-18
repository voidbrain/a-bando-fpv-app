import { Injectable, inject, signal } from '@angular/core';
import type { MLCEngine } from '@mlc-ai/web-llm';
import { AI_SCHEMA, SYSTEM_PROMPT, buildContext, parseReply } from '../core/ai-prompt';
import { runCommands, type AiCommand } from '../core/ai-commands';
import { serverChat, type ChatMessage, type ServerConfig } from '../core/ai-server';
import { cloneSpec } from '../core/site-spec';
import { SiteService } from './site.service';

export interface AiModel {
  id: string;
  label: string;
  /** GPU memory the model needs (MB), from WebLLM's own model list. */
  vram: number;
}

/** Models offered, smallest to largest. All run fully in the browser (WebGPU); the first load downloads the weights. */
export const AI_MODELS: readonly AiModel[] = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B · light, fast, simple commands', vram: 1630 },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B · recommended', vram: 2505 },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', vram: 2264 },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B · better reasoning, slower', vram: 3432 },
  { id: 'Phi-4-mini-instruct-q4f16_1-MLC', label: 'Phi-4 mini 3.8B · best of the small ones, heavy', vram: 3438 },
  { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 7B · needs a strong GPU (5+ GB)', vram: 5107 },
];

export interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
  done?: string[];
  errors?: string[];
  /** What the model asked for (kept so follow-up questions see their own earlier answers). */
  raw?: AiCommand[];
}

const MODEL_KEY = 'abando-ai-model';
const PROVIDER_KEY = 'abando-ai-provider';
const SERVER_KEY = 'abando-ai-server';

/**
 * The assistant: a small language model running in the browser (WebLLM / WebGPU) that turns a chat message into a
 * batch of editor commands (see core/ai-commands). The model only ever picks commands; the app validates and runs
 * them as one undo step. The engine is loaded on demand in a separate chunk, so nothing is downloaded until the
 * person presses "Load model".
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly site = inject(SiteService);

  readonly open = signal(false);
  readonly supported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  readonly modelId = signal(AiService.storedModel());
  /** Where the model runs: in this browser (WebGPU), or on a server speaking the OpenAI chat protocol. */
  readonly provider = signal<'browser' | 'server'>(AiService.storedProvider());
  readonly server = signal<ServerConfig>(AiService.storedServer());
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly progress = signal(0);
  readonly progressText = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly messages = signal<ChatMsg[]>([]);
  /** True while the most recent model answer changed the site and nothing else has been edited since. */
  readonly canUndo = signal(false);

  private engine: MLCEngine | null = null;

  private static storedProvider(): 'browser' | 'server' {
    try {
      return localStorage.getItem(PROVIDER_KEY) === 'server' ? 'server' : 'browser';
    } catch {
      return 'browser';
    }
  }

  private static storedServer(): ServerConfig {
    try {
      const o = JSON.parse(localStorage.getItem(SERVER_KEY) ?? '{}') as Partial<ServerConfig>;
      return { url: o.url ?? '', model: o.model ?? 'qwen2.5:7b', token: o.token ?? '' };
    } catch {
      return { url: '', model: 'qwen2.5:7b', token: '' };
    }
  }

  private static storedModel(): string {
    try {
      const v = localStorage.getItem(MODEL_KEY);
      if (v && AI_MODELS.some((m) => m.id === v)) return v;
    } catch {
      /* no storage */
    }
    return 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
  }

  setProvider(p: 'browser' | 'server'): void {
    if (p === this.provider()) return;
    void this.unload();
    this.provider.set(p);
    this.error.set('');
    try {
      localStorage.setItem(PROVIDER_KEY, p);
    } catch {
      /* ignore */
    }
  }

  saveServer(cfg: ServerConfig): void {
    this.server.set(cfg);
    try {
      localStorage.setItem(SERVER_KEY, JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  }

  /** Check the server with a tiny request; ready on success. */
  async connect(): Promise<void> {
    this.status.set('loading');
    this.error.set('');
    this.progress.set(0);
    this.progressText.set('Contacting the server…');
    try {
      await serverChat(this.server(), [{ role: 'user', content: 'Reply with {"reply":"ok","commands":[]}' }], 20);
      this.status.set('ready');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.status.set('error');
    }
  }

  setModel(id: string): void {
    if (id === this.modelId()) return;
    this.modelId.set(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* ignore */
    }
    void this.unload();
  }

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'ready') return;
    this.status.set('loading');
    this.error.set('');
    this.progress.set(0);
    this.progressText.set('Starting…');
    try {
      const webllm = await import('@mlc-ai/web-llm');
      const id = this.modelId();
      if (!webllm.prebuiltAppConfig.model_list.some((m) => m.model_id === id)) throw new Error(`Model ${id} is not in this WebLLM version.`);
      this.engine = await webllm.CreateMLCEngine(id, {
        initProgressCallback: (r) => {
          this.progress.set(r.progress);
          this.progressText.set(r.text);
        },
      });
      this.status.set('ready');
    } catch (e) {
      this.engine = null;
      this.error.set(e instanceof Error ? e.message : String(e));
      this.status.set('error');
    }
  }

  async unload(): Promise<void> {
    const e = this.engine;
    this.engine = null;
    this.status.set('idle');
    this.progress.set(0);
    try {
      await e?.unload();
    } catch {
      /* already gone */
    }
  }

  /** Send one chat message: ask the model, run what it answers, record the outcome. */
  async send(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.busy() || this.status() !== 'ready') return;
    this.busy.set(true);
    const ed = this.site.editor;
    const spec = ed.draft();
    const sel = ed.selectedId();
    this.messages.update((m) => [...m, { role: 'user', text: t }]);
    try {
      const history = this.messages()
        .slice(-7, -1)
        .map((m) => (m.role === 'user' ? { role: 'user' as const, content: m.text } : { role: 'assistant' as const, content: JSON.stringify({ reply: m.text, commands: m.raw ?? [] }) }));
      const msgs: ChatMessage[] = [{ role: 'system', content: `${SYSTEM_PROMPT}\n\n${buildContext(spec, sel)}` }, ...history, { role: 'user', content: t }];
      const parsed = parseReply(await this.complete(msgs));
      const probe = cloneSpec(spec);
      const dry = runCommands(probe, parsed.commands, sel);
      if (dry.changed) {
        ed.commitSite((s) => {
          runCommands(s, parsed.commands, sel);
        });
        this.site.applyDraft();
      }
      this.canUndo.set(dry.changed);
      this.messages.update((m) => [...m, { role: 'ai', text: parsed.reply || (dry.changed ? 'Done.' : 'I could not do that.'), done: dry.done, errors: [...parsed.errors, ...dry.errors], raw: parsed.commands }]);
    } catch (e) {
      this.messages.update((m) => [...m, { role: 'ai', text: '', errors: [e instanceof Error ? e.message : String(e)] }]);
    } finally {
      this.busy.set(false);
    }
  }

  /** One model call on whichever provider is selected; returns the raw text. */
  private async complete(messages: ChatMessage[]): Promise<string> {
    if (this.provider() === 'server') return serverChat(this.server(), messages);
    if (!this.engine) throw new Error('The model is not loaded.');
    const qwen3 = /^Qwen3-/.test(this.modelId());
    const out = await this.engine.chat.completions.create({
      messages,
      temperature: 0.1,
      max_tokens: 700,
      response_format: { type: 'json_object', schema: JSON.stringify(AI_SCHEMA) },
      ...(qwen3 ? { extra_body: { enable_thinking: false } } : {}),
    });
    return out.choices[0]?.message?.content ?? '';
  }

  undoLast(): void {
    if (!this.canUndo()) return;
    this.site.editor.undo();
    this.site.applyDraft();
    this.canUndo.set(false);
  }

  clear(): void {
    this.messages.set([]);
    this.canUndo.set(false);
  }
}
