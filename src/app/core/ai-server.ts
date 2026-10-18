import { AI_SCHEMA } from './ai-prompt';

/** A server that speaks the OpenAI chat-completions protocol: Ollama, LM Studio, llama.cpp, a cloud API or a proxy. */
export interface ServerConfig {
  url: string;
  model: string;
  token: string;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * The chat-completions URL for what the person typed: a full endpoint or a `.php` proxy is used as is, a `.../v1`
 * base gets `/chat/completions`, a bare host (e.g. an Ollama address) gets `/v1/chat/completions`.
 */
export function chatUrl(input: string): string {
  const u = input.trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/.test(u) || /\.php$/i.test(u)) return u;
  if (/\/v1$/.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

/** Request body; servers differ in what structured output they accept, so the caller steps down: schema → object → plain. */
export function chatBody(model: string, messages: ChatMessage[], mode: 'schema' | 'object' | 'plain', maxTokens = 700): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages, temperature: 0.1, max_tokens: maxTokens, stream: false };
  if (mode === 'schema') body['response_format'] = { type: 'json_schema', json_schema: { name: 'site_edit', schema: AI_SCHEMA, strict: false } };
  else if (mode === 'object') body['response_format'] = { type: 'json_object' };
  return body;
}

/** One request to the server, stepping down the structured-output modes when it answers 400 / 422. Returns the text. */
export async function serverChat(cfg: ServerConfig, messages: ChatMessage[], maxTokens = 700, signal?: AbortSignal): Promise<string> {
  const url = chatUrl(cfg.url);
  if (!url) throw new Error('Enter the server address first.');
  let last = '';
  for (const mode of ['schema', 'object', 'plain'] as const) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
        body: JSON.stringify(chatBody(cfg.model, messages, mode, maxTokens)),
        signal,
      });
    } catch {
      throw new Error('Could not reach the server. Check the address, that it is HTTPS, and that it allows this site (CORS; for Ollama set OLLAMA_ORIGINS).');
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }
    last = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 400 && res.status !== 422) break;
  }
  throw new Error(last);
}
