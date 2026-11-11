import { randomUUID } from 'node:crypto';
import { VERSION, efforts, providerInputSchema, type Effort, type ModelInfo, type Protocol, type ProviderId, type ProviderProfile } from '@reprocase/core';
import type { z } from 'zod';

export interface SecretVault { get(id: string): Promise<string | undefined>; set(id: string, value: string): Promise<void>; delete(id: string): Promise<void>; }
export const providerCatalog: { id: ProviderId; name: string; baseURL: string; protocol: Protocol; modelsURL?: string; docs: string }[] = [
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', protocol: 'responses', docs: 'https://developers.openai.com/api/reference/resources/models/methods/list' },
  { id: 'anthropic', name: 'Anthropic / Claude', baseURL: 'https://api.anthropic.com/v1', protocol: 'anthropic', docs: 'https://platform.claude.com/docs/en/api/models/list' },
  { id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'chat', modelsURL: 'https://generativelanguage.googleapis.com/v1beta/models', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', protocol: 'chat', docs: 'https://api-docs.deepseek.com/api/list-models/' },
  { id: 'opencode-go', name: 'OpenCode Go', baseURL: 'https://opencode.ai/inference/go/openai/v1', protocol: 'chat', modelsURL: 'https://opencode.ai/inference/go/v1/models', docs: 'https://opencode.ai/docs/console/go/' },
  { id: 'opencode-zen', name: 'OpenCode Zen / Console', baseURL: 'https://opencode.ai/inference/openai/v1', protocol: 'chat', modelsURL: 'https://opencode.ai/inference/v1/models', docs: 'https://opencode.ai/docs/console/api/inference/' },
  { id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', protocol: 'chat', docs: 'https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties' },
  { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', protocol: 'chat', docs: 'https://console.groq.com/docs/openai' },
  { id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1', protocol: 'chat', docs: 'https://docs.mistral.ai/api/endpoint/models' },
  { id: 'custom', name: 'Custom / local', baseURL: 'http://127.0.0.1:11434/v1', protocol: 'chat', docs: '' },
];
export function modelInfo(raw: any, providerId: ProviderId): ModelInfo | undefined {
  const id = String(raw.id ?? raw.name ?? '').replace(/^models\//, '');
  if (!id || id.length > 200 || /[\r\n]/.test(id) || raw.lifecycle === 'retired' || raw.archived === true) return;
  if (raw.supportedGenerationMethods && !raw.supportedGenerationMethods.includes('generateContent')) return;
  if (raw.capabilities?.completion_chat === false || raw.output_modalities && !raw.output_modalities.includes('text')) return;
  if (!raw.supportedGenerationMethods && /^(text-embedding|embedding|whisper|tts-|dall-e|gpt-image|omni-moderation|sora-|gemini-.*(embedding|image))/i.test(id)) return;
  let supported: string[] = raw.effort?.supported_levels ?? raw.supported_reasoning_efforts ?? raw.capabilities?.reasoning?.effort ?? raw.reasoning?.supported_efforts ?? raw.reasoning?.efforts ?? [];
  if (providerId === 'openrouter' && raw.reasoning?.supported_efforts === null) supported = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (!Array.isArray(supported)) supported = [];
  if (!supported.length && raw.capabilities?.effort) supported = efforts.filter(level => raw.capabilities.effort[level]?.supported === true);
  if (raw.reasoning?.mandatory) supported = supported.filter(level => level !== 'none');
  let source: ModelInfo['effortSource'] = supported.length ? 'metadata' : 'unknown';
  // Conservative documented family defaults where /models exposes no effort metadata.
  if (!supported.length && providerId === 'openai' && /^(gpt-[56](?:[.-]|$)|o[34](?:-|$))/.test(id) && !/pro|chat|realtime|audio|transcribe|search/.test(id)) { supported = ['low', 'medium', 'high']; source = 'documented'; }
  if (!supported.length && providerId === 'deepseek' && /^deepseek-(flash|v4)/.test(id)) { supported = ['none', 'low', 'high', 'max']; source = 'documented'; }
  if (!supported.length && raw.thinking === true && providerId === 'gemini') { supported = ['low', 'medium', 'high']; source = 'documented'; }
  return { id, name: String(raw.display_name ?? raw.displayName ?? raw.name ?? id).replace(/^models\//, '').slice(0, 200), efforts: [...new Set(supported.filter((value): value is Effort => efforts.includes(value as Effort)))], effortSource: source, supportsVision: !!(raw.modalities?.input?.some((v:string)=>v.startsWith('image')) || raw.input_modalities?.includes('image') || raw.architecture?.input_modalities?.includes('image') || raw.capabilities?.vision === true || raw.supportedGenerationMethods && /^gemini-/.test(id) || providerId==='openai'&&/^gpt-[456]/.test(id) || providerId==='anthropic'), ...(Number.isFinite(raw.context_window ?? raw.context_length ?? raw.inputTokenLimit ?? raw.limit?.context) ? { contextWindow: Number(raw.context_window ?? raw.context_length ?? raw.inputTokenLimit ?? raw.limit?.context) } : {}) };
}
export function endpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS for remote providers or HTTP on loopback, without URL credentials or query parameters.');
  return url.href.replace(/\/$/, '');
}
export class ProviderRegistry {
  private profiles = new Map<string, ProviderProfile>();
  private keys = new Map<string, string>();
  private busy = new Set<string>();
  constructor(private options: { fetch?: typeof fetch; vault?: SecretVault; save(profiles: ProviderProfile[]): void }) {}
  async restore(profiles: ProviderProfile[]) {
    for (const item of profiles) {
      const profile = { ...item, hasKey: false };
      this.profiles.set(item.id, profile);
      if (item.remembered && this.options.vault) { try { const key = await this.options.vault.get(item.id); if (key) { this.keys.set(item.id, key); profile.hasKey = true; } } catch { profile.error = 'Saved key could not be unlocked. Re-enter the API key.'; } }
    }
  }
  list() { return [...this.profiles.values()].map(item => structuredClone(item)); }
  get(id: string) { const item = this.profiles.get(id); if (!item) throw new Error('Provider profile not found'); return structuredClone(item); }
  key(id: string) { return this.keys.get(id); }
  knownSecrets() { return [...this.keys.values()]; }
  rememberingAvailable() { return !!this.options.vault; }
  private persist() { this.options.save(this.list().map(profile => ({ ...profile, hasKey: false }))); }
  private async locked<T>(id: string, task: () => Promise<T>): Promise<T> { if (this.busy.has(id)) throw Object.assign(new Error('This provider is being updated. Wait for that operation to finish.'), { statusCode: 409 }); this.busy.add(id); try { return await task(); } finally { this.busy.delete(id); } }
  async save(input: z.input<typeof providerInputSchema>) { const value = providerInputSchema.parse(input), id = value.id ?? `provider-${randomUUID()}`; return this.locked(id, () => this.saveProfile(value, id)); }
  private async saveProfile(input: z.input<typeof providerInputSchema>, nextId: string) {
    const value = providerInputSchema.parse(input), preset = providerCatalog.find(item => item.id === value.providerId)!;
    const previous = value.id ? this.get(value.id) : undefined;
    const baseURL = endpoint(value.providerId === 'custom' ? value.baseURL ?? preset.baseURL : preset.baseURL);
    const id = previous?.id ?? nextId;
    const same = previous?.baseURL === baseURL && previous.providerId === value.providerId;
    const key = value.apiKey || (same ? this.keys.get(id) : undefined);
    if (!key && value.providerId !== 'custom') throw new Error('Enter an API key for this provider');
    if (previous && !same) { this.keys.delete(id); await this.options.vault?.delete(id); }
    let remembered = false;
    if (key) {
      if (this.options.vault) { await this.options.vault.set(id, key); remembered = true; }
      this.keys.set(id, key);
    }
    const profile: ProviderProfile = { id, providerId: value.providerId, label: value.label ?? preset.name, baseURL, protocol: value.providerId === 'custom' ? value.protocol ?? 'chat' : preset.protocol, hasKey: !!key, remembered, models: same ? previous.models : [], ...(same && previous.modelsUpdatedAt ? { modelsUpdatedAt: previous.modelsUpdatedAt } : {}) };
    this.profiles.set(id, profile); this.persist(); return this.get(id);
  }
  async remove(id: string) { return this.locked(id, async () => { this.get(id); await this.options.vault?.delete(id); this.keys.delete(id); this.profiles.delete(id); this.persist(); }); }
  headers(profile: ProviderProfile, sessionId: string) {
    const key = this.keys.get(profile.id), headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': `reprocase/${VERSION}` };
    if (profile.protocol === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
    else if (key) headers.authorization = `Bearer ${key}`;
    if (new URL(profile.baseURL).hostname === 'opencode.ai') headers['x-opencode-session'] = sessionId;
    return headers;
  }
  async discover(id: string) { return this.locked(id, () => this.discoverModels(id)); }
  private async discoverModels(id: string) {
    const profile = this.get(id), preset = providerCatalog.find(item => item.id === profile.providerId)!;
    const start = new URL(preset.modelsURL ?? `${profile.baseURL}/models`);
    const headers = this.headers(profile, `discovery-${id}`);
    if (profile.providerId === 'gemini') { delete headers.authorization; if (this.key(id)) headers['x-goog-api-key'] = this.key(id)!; start.searchParams.set('pageSize', '1000'); }
    if (profile.protocol === 'anthropic') start.searchParams.set('limit', '100');
    const models = new Map<string, ModelInfo>();
    try {
      const url = new URL(start); let complete = false;
      for (let page = 0; page < 20; page++) {
        const response = await (this.options.fetch ?? fetch)(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
        const text = await response.text(); if (text.length > 12_000_000) throw new Error('Provider model catalog is too large');
        if (!response.ok) throw new Error(`Model discovery failed (${response.status}): ${text.slice(0, 1000)}`);
        const data = JSON.parse(text), items = data.data ?? data.models ?? (Array.isArray(data) ? data : undefined);
        if (!Array.isArray(items)) throw new Error('The provider did not return a model list. Use advanced settings to check its API protocol.');
        for (const raw of items) { const model = modelInfo(raw, profile.providerId); if (model) models.set(model.id, model); }
        if (data.nextPageToken) url.searchParams.set('pageToken', String(data.nextPageToken));
        else if (data.has_more && data.last_id) url.searchParams.set('after_id', String(data.last_id));
        else { complete = true; break; }
      }
      if (!complete) throw new Error('The provider catalog exceeded 20 pages; narrow its model list in advanced settings.');
      if (!models.size) throw new Error('No text generation models were returned by this provider');
      const serialized = JSON.stringify([...models.values()]);
      if (this.knownSecrets().some(key => serialized.includes(key))) throw new Error('Provider metadata contained a known credential and was rejected');
      const updated = { ...profile, models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)), modelsUpdatedAt: new Date().toISOString(), error: undefined };
      this.profiles.set(id, updated); this.persist(); return this.get(id);
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Model discovery failed';
      for (const key of this.knownSecrets()) message = message.split(key).join('[REDACTED]');
      this.profiles.set(id, { ...profile, error: message }); this.persist(); throw new Error(message);
    }
  }
}
