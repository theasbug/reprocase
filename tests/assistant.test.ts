import { afterEach, describe, expect, it } from 'vitest';
import { ProviderRegistry, modelInfo } from '../packages/ai/src/providers.ts';
import { sse, streamChat } from '../packages/ai/src/chat.ts';
import { createServer } from '../apps/server/src/server.ts';
import { AIManager } from '../packages/ai/src/index.ts';
import { createExampleCase } from '@reprocase/core';

const models = { data: [{ id: 'reasoning-model', name: 'Reasoning model', capabilities: { reasoning: { effort: ['low', 'high'] } } }, { id: 'basic-model', name: 'Basic model' }] };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function events(items: any[], delay = 0, crlf = false) {
  const encoder = new TextEncoder(); let i = 0;
  return new Response(new ReadableStream({ async pull(controller) { if (delay) await new Promise(r => setTimeout(r, delay)); if (i < items.length) controller.enqueue(encoder.encode('data: ' + JSON.stringify(items[i++]) + (crlf ? '\r\n\r\n' : '\n\n'))); else controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
const chatEvents = (text: string) => events([{ choices: [{ delta: { content: text }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
async function registry(fetcher: typeof fetch) { const registry = new ProviderRegistry({ fetch: fetcher, save: () => {} }); const profile = await registry.save({ providerId: 'custom', baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'provider-key-private' }); return { registry, profile: await registry.discover(profile.id) }; }
let server: Awaited<ReturnType<typeof createServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe('provider discovery and credentials', () => {
  it('uses preset endpoints instead of user-supplied overrides, and never persists keys with profile metadata', async () => {
    let saved = ''; const urls: string[] = [];
    const providers = new ProviderRegistry({ save: value => { saved = JSON.stringify(value); }, fetch: async (url, options) => { urls.push(String(url)); expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-openai-key'); return json(models); } });
    const profile = await providers.save({ providerId: 'openai', apiKey: 'private-openai-key', baseURL: 'https://attacker.invalid' });
    await providers.discover(profile.id);
    expect(urls).toEqual(['https://api.openai.com/v1/models']); expect(saved).not.toContain('private-openai-key'); expect(JSON.stringify(providers.list())).not.toContain('private-openai-key');
    expect(() => providers.get('missing')).toThrow();
  });
  it('does not transfer a saved key when changing provider/endpoint and restores only from a vault', async () => {
    const secret = new Map<string, string>(); let profiles: any[] = [];
    const vault = { get: async (id: string) => secret.get(id), set: async (id: string, key: string) => { secret.set(id, key); }, delete: async (id: string) => { secret.delete(id); } };
    const original = new ProviderRegistry({ vault, save: data => { profiles = data; } });
    const profile = await original.save({ providerId: 'openai', apiKey: 'private-restored-key' });
    const restored = new ProviderRegistry({ vault, save: () => {} }); await restored.restore(profiles);
    expect(restored.key(profile.id)).toBe('private-restored-key'); expect(restored.get(profile.id).remembered).toBe(true);
    await expect(restored.save({ id: profile.id, providerId: 'deepseek' })).rejects.toThrow('API key');
    expect(restored.key(profile.id)).toBe('private-restored-key');
    await restored.save({ id: profile.id, providerId: 'custom', baseURL: 'http://127.0.0.1:1234/v1' }); expect(restored.key(profile.id)).toBeUndefined();
    const memory = new ProviderRegistry({ save: () => {} }); await memory.restore(profiles); expect(memory.get(profile.id).hasKey).toBe(false);
  });
  it('paginates Gemini with its key header and keeps pagination on the trusted endpoint', async () => {
    const urls: URL[] = [];
    const providers = new ProviderRegistry({ save: () => {}, fetch: async (url, options) => { urls.push(new URL(String(url))); expect(new Headers(options?.headers).get('x-goog-api-key')).toBe('google-private-key'); expect(new Headers(options?.headers).has('authorization')).toBe(false); return json(urls.length === 1 ? { models: [{ name: 'models/gemini-text', supportedGenerationMethods: ['generateContent'], thinking: true }], nextPageToken: 'next/https://wrong.invalid' } : { models: [{ name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }] }); } });
    const profile = await providers.save({ providerId: 'gemini', apiKey: 'google-private-key' }); const result = await providers.discover(profile.id);
    expect(result.models.map(m => m.id)).toEqual(['gemini-text']); expect(urls[1].origin).toBe(urls[0].origin); expect(urls[1].searchParams.get('pageToken')).toBe('next/https://wrong.invalid');
  });
  it('uses capability metadata for reasoning levels and excludes known non-text models', () => {
    expect(modelInfo(models.data[0], 'opencode-go')!.efforts).toEqual(['low', 'high']);
    expect(modelInfo({ id: 'claude', capabilities: { effort: { low: { supported: true }, high: { supported: false } } } }, 'anthropic')!.efforts).toEqual(['low']);
    expect(modelInfo({ id: 'deepseek', effort: { supported_levels: ['low', 'max', 'invented'] } }, 'deepseek')!.efforts).toEqual(['low', 'max']);
    expect(modelInfo({ id: 'text-embedding-3-small' }, 'openai')).toBeUndefined();
    expect(modelInfo({ id: 'openai/model', reasoning: { supported_efforts: ['none', 'high'], mandatory: true } }, 'openrouter')!.efforts).toEqual(['high']);
  });
  it('redacts echoed provider keys on discovery failures', async () => {
    const providers = new ProviderRegistry({ save: () => {}, fetch: async () => json({ error: 'private-provider-error' }, 401) });
    const profile = await providers.save({ providerId: 'custom', apiKey: 'private-provider-error' });
    await expect(providers.discover(profile.id)).rejects.toThrow('[REDACTED]'); expect(JSON.stringify(providers.list())).not.toContain('private-provider-error');
  });
  it('prevents stale discovery from overwriting a provider changed in another window', async () => {
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const providers = new ProviderRegistry({ save: () => {}, fetch: async () => { await held; return json(models); } });
    const profile = await providers.save({ providerId: 'custom', baseURL: 'http://127.0.0.1:11434/v1', apiKey: 'old-endpoint-key' });
    const pending = providers.discover(profile.id);
    await expect(providers.save({ id: profile.id, providerId: 'custom', baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'new-endpoint-key' })).rejects.toThrow('being updated');
    await expect(providers.remove(profile.id)).rejects.toThrow('being updated');
    release(); await pending;
    expect(providers.get(profile.id).baseURL).toContain('11434'); expect(providers.key(profile.id)).toBe('old-endpoint-key');
  });
});
describe('streaming conversational adapters', () => {
  it('handles UTF-8, CRLF split between chunks, comments, and the done sentinel', async () => {
    const bytes = new TextEncoder().encode(': comment\r\ndata: {"text":"Türkçe"}\r\n\r\ndata: [DONE]\r\n\r\n'); let index = 0;
    const response = new Response(new ReadableStream({ pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close(); } }));
    const output = []; for await (const item of sse(response)) output.push(item); expect(output).toEqual([{ text: 'Türkçe' }]);
  });
  it.each(['chat', 'responses', 'anthropic'] as const)('streams %s using its native reasoning field and completion marker', async protocol => {
    const { registry: providers, profile } = await registry(async () => json(models)); let body: any;
    const chunks = protocol === 'chat' ? [{ choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }] : protocol === 'responses' ? [{ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed' }] : [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }, { type: 'message_stop' }];
    const result = await streamChat(providers, { ...profile, protocol }, 'reasoning-model', 'high', 'session-test', [{ id: 'u', role: 'user', content: 'Hi', createdAt: '', status: 'complete' }], new AbortController().signal, () => {}, async (_url, init) => { body = JSON.parse(String(init?.body)); return events(chunks); });
    expect(result).toBe('Hello'); expect(protocol === 'chat' ? body.reasoning_effort : protocol === 'responses' ? body.reasoning.effort : body.output_config.effort).toBe('high');
  });
  it('rejects truncated streams instead of marking the reply complete', async () => {
    const { registry: providers, profile } = await registry(async () => json(models));
    await expect(streamChat(providers, profile, 'basic-model', 'auto', 'test', [], new AbortController().signal, () => {}, async () => events([{ choices: [{ delta: { content: 'Partial' } }] }]))).rejects.toThrow('completion');
  });
  it('uses the native Claude tool protocol for reviewable case proposals', async () => {
    const spec = createExampleCase(); let body: any;
    const ai = new AIManager({ fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return json({ content: [{ type: 'tool_use', id: 'tool-1', name: 'propose_case', input: { caseJson: JSON.stringify(spec), explanation: 'Reviewed', warnings: [] } }] }); } });
    ai.configure({ provider: 'anthropic', apiKey: 'claude-private-key', model: 'claude-test' });
    expect((await ai.propose(spec, 'Review')).case).toEqual(spec); expect(body.tools[0].input_schema.type).toBe('object'); expect(body.tool_choice.type).toBe('tool');
  });
});
describe('shared persisted chat service', () => {
  it('streams through authenticated API, retains the conversation and redacts keys before storage and delivery', async () => {
    const bodies: any[] = []; server = await createServer({ memory: true, port: 0, providerFetch: async (url, init) => { if (String(url).includes('/models')) return json(models); bodies.push(JSON.parse(String(init?.body))); return chatEvents('Plan: keep provider-key-private secret. Use fresh resources.'); } });
    const headers = { authorization: `Bearer ${server.token}` };
    const profile = await server.service.providers.save({ providerId: 'custom', baseURL: 'http://127.0.0.1:9999/v1', apiKey: 'provider-key-private' }); await server.service.providers.discover(profile.id);
    expect((await server.app.inject({ method: 'POST', url: '/api/chats', payload: {} })).statusCode).toBe(401);
    const chat = (await server.app.inject({ method: 'POST', url: '/api/chats', headers, payload: {} })).json();
    const send = async (content: string) => { const result = await server!.app.inject({ method: 'POST', url: `/api/chats/${chat.id}/messages`, headers, payload: { profileId: profile.id, modelId: 'reasoning-model', reasoning: 'high', content, attachments: [{ name: 'plan.md', content: 'Implement with provider-key-private' }] } }); expect(result.statusCode).toBe(200); for (let i = 0; i < 100 && server!.service.chats.get(chat.id).messages.at(-1)?.status === 'streaming'; i++) await new Promise(r => setTimeout(r, 2)); };
    await send('Please read provider-key-private'); await send('And the next step?');
    const result = server.service.chats.get(chat.id);
    expect(result.messages).toHaveLength(4); expect(result.messages.at(-1)?.status).toBe('complete');
    expect(JSON.stringify(result)).not.toContain('provider-key-private'); expect(JSON.stringify(bodies)).not.toContain('provider-key-private'); expect(bodies[1].messages).toHaveLength(4);
    expect(server.service.chats.list()[0].title).toContain('[REDACTED]');
  });
  it('rejects unsupported reasoning before any inference and keeps model discovery separate from generation', async () => {
    let requests = 0; server = await createServer({ memory: true, port: 0, providerFetch: async () => { requests++; return json(models); } });
    const profile = await server.service.providers.save({ providerId: 'custom' }); await server.service.providers.discover(profile.id); const chat = server.service.chats.create();
    expect(() => server!.service.chats.send(chat.id, { profileId: profile.id, modelId: 'basic-model', reasoning: 'high', content: 'Hi' })).toThrow('advertise');
    expect(requests).toBe(1); expect(server.service.chats.get(chat.id).messages).toHaveLength(0);
  });
  it('cancels one in-flight request and does not retry it', async () => {
    let requests = 0; server = await createServer({ memory: true, port: 0, providerFetch: async (url, init) => {
      if (String(url).includes('/models')) return json(models); requests++;
      return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    } });
    const profile = await server.service.providers.save({ providerId: 'custom' }); await server.service.providers.discover(profile.id); const chat = server.service.chats.create();
    server.service.chats.send(chat.id, { profileId: profile.id, modelId: 'basic-model', content: 'Wait' });
    server.service.chats.send(chat.id, { profileId: profile.id, modelId: 'basic-model', content: 'A queued follow-up' });
    expect(server.service.chats.get(chat.id).messages.at(-1)?.status).toBe('queued');
    server.service.chats.cancel(chat.id); await server.service.chats.close();
    expect(requests).toBe(1); expect(server.service.chats.get(chat.id).messages.at(-1)?.status).toBe('cancelled');
  });
});
