import { useEffect, useState } from 'react';
import { Check, CircleCheck, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ProviderId, ProviderProfile, Protocol } from '../../../packages/core/src/assistant.ts';
import type { Lang } from './i18n.ts';
import { api } from './api.ts';
export interface ProviderState { catalog: { id: ProviderId; name: string; baseURL: string; protocol: Protocol }[]; profiles: ProviderProfile[]; rememberKeys: boolean; }
export function ProvidersSettings({ lang, done }: { lang: Lang; done(): Promise<void> }) {
  const text = (en: string, tr: string) => lang === 'tr' ? tr : en;
  const [state, setState] = useState<ProviderState>({ catalog: [], profiles: [], rememberKeys: false });
  const [advanced, setAdvanced] = useState(false), [id, setId] = useState<string | undefined>();
  const [provider, setProvider] = useState<ProviderId>('openai'), [key, setKey] = useState('');
  const [baseURL, setBaseURL] = useState('http://127.0.0.1:11434/v1'), [protocol, setProtocol] = useState<Protocol>('chat');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = async () => setState(await api<ProviderState>('/api/providers'));
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); setError(''); setNotice(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); await load().catch(() => {}); } };
  const reset = () => { setId(undefined); setKey(''); setProvider('openai'); setAdvanced(false); setNotice(''); setError(''); };
  const save = () => run('save', async () => {
    const profile = await api<ProviderProfile>('/api/providers', { ...(id ? { id } : {}), providerId: advanced ? 'custom' : provider, ...(key ? { apiKey: key } : {}), ...(advanced ? { baseURL, protocol } : {}) });
    setKey(''); setId(profile.id);
    const discovered = await api<ProviderProfile>(`/api/providers/${profile.id}/discover`, {});
    setNotice(text(`${discovered.models.length} models discovered. Choose a model in AI Assistant.`, `${discovered.models.length} model bulundu. AI Assistant içinde bir model seçebilirsin.`));
  });
  return <><div className="modal-body provider-settings">
    <p className="help-text">{text('Connect a provider once. Its models appear automatically in every AI session.', 'Sağlayıcıyı bir kez bağla. Modelleri AI oturumlarında otomatik görünsün.')}</p>
    {!!state.profiles.length && <div className="connected-providers">{state.profiles.map(profile => <div key={profile.id}><KeyRound size={16} /><button className="provider-edit" onClick={() => { setId(profile.id); setProvider(profile.providerId); setAdvanced(profile.providerId === 'custom'); setBaseURL(profile.baseURL); setProtocol(profile.protocol); setKey(''); setError(''); setNotice(''); }}><strong>{profile.label}</strong><small>{profile.models.length} {text('models', 'model')} · {profile.hasKey ? text('Connected', 'Bağlı') : profile.providerId === 'custom' ? text('Local / custom', 'Yerel / özel') : text('Key required', 'Anahtar gerekli')}</small></button><button className="icon-button tiny" aria-label={`${text('Refresh models', 'Modelleri yenile')} ${profile.label}`} disabled={!!busy} onClick={() => void run('refresh', async () => { await api(`/api/providers/${profile.id}/discover`, {}); })}><RefreshCw size={14} /></button><button className="icon-button tiny" aria-label={`${text('Remove provider', 'Sağlayıcıyı kaldır')} ${profile.label}`} disabled={!!busy} onClick={() => void run('remove', async () => { await api(`/api/providers/${profile.id}`, undefined, 'DELETE'); if (id === profile.id) reset(); })}><Trash2 size={14} /></button></div>)}</div>}
    <div className="provider-mode"><div className="segmented"><button className={!advanced ? 'active' : ''} onClick={() => { setAdvanced(false); if (provider === 'custom') setProvider('openai'); }}>{text('Provider', 'Sağlayıcı')}</button><button className={advanced ? 'active' : ''} onClick={() => setAdvanced(true)}>{text('Advanced', 'Detaylı')}</button></div>{id && <button className="button text small" onClick={reset}><Plus size={13} />{text('Add another', 'Başka ekle')}</button>}</div>
    <form id="provider-form" onSubmit={e => { e.preventDefault(); void save(); }} className="provider-form">
      {!advanced ? <label>{text('Provider', 'Sağlayıcı')}<select aria-label={text('Provider', 'Sağlayıcı')} value={provider} onChange={e => { setProvider(e.target.value as ProviderId); setId(undefined); setKey(''); }}>{state.catalog.filter(item => item.id !== 'custom').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <><label>{text('API protocol', 'API protokolü')}<select aria-label={text('API protocol', 'API protokolü')} value={protocol} onChange={e => setProtocol(e.target.value as Protocol)}><option value="chat">OpenAI-compatible Chat Completions</option><option value="responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option></select></label><label>{text('API base URL', 'API adresi')}<input aria-label={text('API base URL', 'API adresi')} required value={baseURL} onChange={e => setBaseURL(e.target.value)} spellCheck={false} /></label></>}
      <label>{text('API key', 'API anahtarı')}<input aria-label={text('API key', 'API anahtarı')} type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={id ? text('Leave blank to keep this provider’s key', 'Bu sağlayıcının anahtarını korumak için boş bırak') : advanced ? text('Optional for local models', 'Yerel modeller için isteğe bağlı') : text('Paste your provider API key', 'Sağlayıcı API anahtarını yapıştır')} /></label>
    </form>
    <small className="field-hint">{state.rememberKeys ? text('Keys are saved using Windows encryption. Chat and case exports never include provider keys.', 'Anahtarlar Windows şifrelemesiyle saklanır. Sohbet ve vaka dışa aktarımları sağlayıcı anahtarını içermez.') : text('In the web app, keys remain in memory until the service closes.', 'Web uygulamasında anahtarlar servis kapanana kadar bellekte kalır.')}</small>
    {error && <pre className="inline-error" role="alert">{error}</pre>}{notice && <div className="redaction-info" role="status"><CircleCheck size={15} />{notice}</div>}
  </div><div className="modal-footer"><button className="button secondary" onClick={() => void done()}>{text('Done', 'Tamam')}</button><button className="button primary" type="submit" form="provider-form" disabled={!!busy || !state.catalog.length}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{text('Save & discover models', 'Kaydet ve modelleri bul')}</button></div></>;
}
