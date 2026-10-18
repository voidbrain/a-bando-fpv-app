import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatBody, chatUrl, serverChat } from './ai-server';

describe('ai server', () => {
  it('builds the endpoint from what people type', () => {
    expect(chatUrl('https://pc.tail1234.ts.net')).toBe('https://pc.tail1234.ts.net/v1/chat/completions');
    expect(chatUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    expect(chatUrl('https://x.it/ai-proxy.php')).toBe('https://x.it/ai-proxy.php');
    expect(chatUrl('https://x.it/v1/chat/completions')).toBe('https://x.it/v1/chat/completions');
    expect(chatUrl('  ')).toBe('');
  });

  it('asks for a schema first, then steps down when the server refuses', async () => {
    const modes: unknown[] = [];
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { response_format?: { type: string } };
      modes.push(body.response_format?.type ?? 'plain');
      if (body.response_format?.type === 'json_schema') return new Response('unsupported', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"reply":"ok","commands":[]}' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await serverChat({ url: 'https://h', model: 'm', token: 't' }, [{ role: 'user', content: 'hi' }]);
    expect(out).toContain('"reply"');
    expect(modes).toEqual(['json_schema', 'json_object']);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer t' });
  });

  it('reports a network / CORS failure in plain words and keeps the body small', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    await expect(serverChat({ url: 'https://h', model: 'm', token: '' }, [])).rejects.toThrow(/CORS/);
    expect(JSON.stringify(chatBody('m', [], 'plain')).length).toBeLessThan(200);
  });

  afterEach(() => vi.unstubAllGlobals());
});
