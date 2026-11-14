import { useState } from 'react';
import { CheckCheck, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { CaseSpec } from '../../../packages/core/src/schema.ts';
import { api } from './api.ts';
import type { Lang } from './i18n.ts';

type Kind = 'header' | 'token' | 'cookie';
interface Result { case: CaseSpec; remapped: null | { path: string; idPointer: string; tenantPointer?: string }; identities: Record<string, unknown> }

/** Triager shortcut: one origin, one credential per account, automatic identity mapping. */
export function VerifyOnSite({ lang, spec, initialOrigin = '', done }: { lang: Lang; spec: CaseSpec; initialOrigin?: string; done(result: Result, origin: string): Promise<void> }) {
  const t = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const [origin, setOrigin] = useState(initialOrigin), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [creds, setCreds] = useState<Record<string, { kind: Kind; name: string; value: string }>>(Object.fromEntries(spec.actors.map(a => [a.id, { kind: 'header' as Kind, name: 'Authorization', value: '' }])));
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const accounts = Object.fromEntries(spec.actors.map(a => {
        const c = creds[a.id]!;
        if (!c.value.trim()) throw new Error(t(`Add a credential for ${a.label}.`, `${a.label} için oturum bilgisini ekle.`));
        return [a.id, c.kind === 'cookie' ? { cookie: c.value.trim() } : c.kind === 'token' ? { token: c.value.trim() } : { header: { name: c.name.trim(), value: c.value.trim() } }];
      }));
      await done(await api<Result>(`/api/cases/${encodeURIComponent(spec.id)}/verify-on-site`, { origin: origin.trim(), accounts }), origin.trim());
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <div className="modal-body wizard-body quick-proof">
      {error && <pre className="inline-error" role="alert">{error}</pre>}
      <p className="help-text">{t('Re-run this report against your own site with your own test accounts. If your identity endpoint differs from the reporter’s, ReproCase finds it and saves a new case revision. No JSON editing needed.', 'Bu raporu kendi sitende, kendi test hesaplarınla tekrar çalıştır. Kimlik uç noktan raporlayanınkinden farklıysa ReproCase onu bulur ve yeni bir vaka revizyonu kaydeder. JSON düzenlemek gerekmez.')}</p>
      <label>{t('Your API origin', 'API adresin')}<input aria-label="Your API origin" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://api.yourcompany.com" spellCheck={false} /></label>
      <div className="qp-accounts">{spec.actors.map(a => {
        const c = creds[a.id]!, set = (patch: Partial<typeof c>) => setCreds(old => ({ ...old, [a.id]: { ...old[a.id]!, ...patch } }));
        return <fieldset className="qp-account" key={a.id}><legend>{a.label}</legend>
          <div className="segmented small">{(['header', 'token', 'cookie'] as const).map(k => <button key={k} type="button" className={c.kind === k ? 'active' : ''} onClick={() => set({ kind: k })}>{k === 'header' ? t('Header', 'Başlık') : k === 'token' ? 'Bearer' : 'Cookie'}</button>)}</div>
          {c.kind === 'header' && <input aria-label={`${a.label} header name`} value={c.name} onChange={e => set({ name: e.target.value })} spellCheck={false} />}
          <input aria-label={`${a.label} credential`} type="password" value={c.value} onChange={e => set({ value: e.target.value })} autoComplete="off" spellCheck={false} />
        </fieldset>;
      })}</div>
      <div className="redaction-info"><ShieldCheck size={15} />{t('Only GET identity requests are sent now. The case itself runs after you review the reporter’s policy and approve.', 'Şu anda yalnızca kimlik için GET istekleri gönderilir. Vakanın kendisi, raporlayanın politikasını inceleyip onayladıktan sonra çalışır.')}</div>
    </div>
    <div className="modal-footer"><span className="security-footnote"><CheckCheck size={13} />{t('Credentials stay on this computer.', 'Oturum bilgileri bu bilgisayarda kalır.')}</span>
      <button data-testid="verify-on-site" className="button primary" disabled={!origin.trim() || busy} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}{t('Connect & verify', 'Bağla ve doğrula')}</button></div>
  </>;
}
