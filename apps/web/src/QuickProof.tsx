import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, KeyRound, LoaderCircle, Search, ShieldCheck, Sparkles } from 'lucide-react';
import type { CaseSpec } from '../../../packages/core/src/schema.ts';
import type { QuickProofKind } from '../../../packages/core/src/proofs.ts';
import { api } from './api.ts';
import type { Lang } from './i18n.ts';

type Actor = 'owner' | 'researcher';
type AuthKind = 'browser' | 'header' | 'token' | 'cookie';
interface Status { id: string; origin: string; owner: null | { connected: boolean; identity?: Record<string, unknown>; error?: string }; researcher: Status['owner']; identity: null | { path: string; idPointer: string; tenantPointer?: string; sameTenant: boolean } }
interface IdentityResult { found: boolean; tried: { path: string; owner: number; researcher: number }[]; message?: string; identity?: { path: string; idPointer: string; tenantPointer?: string; rolePointer?: string; roles?: string[]; sameTenant: boolean; fields: { pointer: string; a: unknown; b?: unknown }[] } }
interface Observed { case: CaseSpec; notes: string[]; learned: { identity: { path: string; idPointer: string; tenantPointer?: string }; objectPath: string; idField: string; ownerField?: string; ownerSource?: string; markerField: string; csrf: null | { path: string; header: string }; boundary: string }; preview: { owner: number; other: number; otherSawObject: boolean } }

/**
 * Quick Proof: bind two accounts, paste two requests, get a reviewable case.
 * The user never types a JSON Pointer; corrections are made by picking a field.
 */
export function QuickProof({ lang, initialVulnerable = '', created }: { lang: Lang; initialVulnerable?: string; created(spec: CaseSpec): Promise<void> }) {
  const t = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const [page, setPage] = useState(0), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [origin, setOrigin] = useState(''), [session, setSession] = useState<Status | null>(null);
  const [auth, setAuth] = useState<Record<Actor, { kind: AuthKind; name: string; value: string }>>({ owner: { kind: 'header', name: 'Authorization', value: '' }, researcher: { kind: 'header', name: 'Authorization', value: '' } });
  const [identity, setIdentity] = useState<IdentityResult | null>(null), [customPath, setCustomPath] = useState('');
  const [createReq, setCreateReq] = useState(''), [vulnReq, setVulnReq] = useState(initialVulnerable), [observed, setObserved] = useState<Observed | null>(null);
  const [opened, setOpened] = useState<Record<Actor, boolean>>({ owner: false, researcher: false });
  useEffect(() => () => { if (session?.id) void api(`/api/quickproof/${session.id}/cancel`, {}).catch(() => {}); }, [session?.id]);
  const [kind, setKind] = useState<QuickProofKind>('authorization');
  const [readReq, setReadReq] = useState(''), [field, setField] = useState('');
  const [correction, setCorrection] = useState<{ message: string; fields: { pointer: string; label: string }[]; read: boolean } | null>(null);
  const changeKind = (next: QuickProofKind) => { setKind(next); setSession(null); setIdentity(null); setOpened({ owner: false, researcher: false }); if (next === 'cors_read') setAuth(old => ({ ...old, owner: { ...old.owner, kind: 'browser' } })); };
  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } };

  const connect = () => run('connect', async () => {
    let s = session;
    if (!s || s.origin !== new URL(origin.trim()).origin) s = await api<Status>('/api/quickproof', { origin: origin.trim(), kind });
    const needsLogin: Actor[] = [];
    for (const actor of kind === 'cors_read' ? ['owner'] as const : ['owner', 'researcher'] as const) {
      const a = auth[actor];
      if (a.kind === 'browser') {
        if (!opened[actor] || s!.id !== session?.id) { s = await api<Status>(`/api/quickproof/${s!.id}/browser`, { actor }); setOpened(old => ({ ...old, [actor]: true })); needsLogin.push(actor); }
        continue;
      }
      if (!a.value.trim()) throw new Error(actor === 'owner' ? t('Add the first account’s credential.', 'Birinci hesabın bilgisini ekle.') : t('Add the second account’s credential.', 'İkinci hesabın bilgisini ekle.'));
      const body = a.kind === 'cookie' ? { cookie: a.value.trim() } : a.kind === 'token' ? { token: a.value.trim().replace(/^Bearer\s+/i, '') } : { header: { name: a.name.trim(), value: a.value.trim() } };
      s = await api<Status>(`/api/quickproof/${s!.id}/connect`, { actor, ...body });
    }
    setSession(s);
    if (needsLogin.length) throw new Error(t('A browser window opened for each “Sign in” account. Sign in there with the test account, then press “Connect & identify” again.', '“Giriş yap” seçilen her hesap için bir tarayıcı penceresi açıldı. Orada test hesabıyla giriş yap, sonra “Bağla ve tanı”ya tekrar bas.'));
    const found = await api<IdentityResult>(`/api/quickproof/${s!.id}/identity`, {});
    setIdentity(found);
    if (found.found) setPage(1);
  });
  const detect = (input: { path?: string; idPointer?: string; tenantPointer?: string; rolePointer?: string }) => run('identity', async () => {
    const found = await api<IdentityResult>(`/api/quickproof/${session!.id}/identity`, { ...(identity?.identity && !input.path ? { path: identity.identity.path } : {}), ...input });
    setIdentity(found);
    if (found.found) setPage(1);
  });
  const observe = () => run('observe', async () => {
    const result = await api<Observed & { status: 'ready' | 'needs_input'; message: string; fields: { pointer: string; label: string }[]; read: boolean }>(`/api/quickproof/${session!.id}/observe`, { ...(createReq && kind !== 'cors_read' ? { create: createReq } : {}), vulnerable: vulnReq, ...(readReq ? { read: readReq } : {}), ...(field ? { field } : {}) });
    if (result.status === 'needs_input') { setCorrection(result); return; }
    setObserved(result); setCorrection(null); setPage(3);
  });

  const steps = [t('Accounts', 'Hesaplar'), t('Identity', 'Kimlik'), t('Requests', 'İstekler'), t('Result', 'Sonuç')];
  const credential = (actor: Actor, label: string) => {
    const a = auth[actor], set = (patch: Partial<typeof a>) => setAuth(old => ({ ...old, [actor]: { ...old[actor], ...patch } }));
    return <fieldset className="qp-account"><legend>{label}</legend>
      <div className="segmented small">{(kind === 'cors_read' ? ['browser'] as const : ['browser', 'header', 'token', 'cookie'] as const).map(k => <button key={k} type="button" className={a.kind === k ? 'active' : ''} onClick={() => set({ kind: k })}>{k === 'browser' ? t('Sign in', 'Giriş yap') : k === 'header' ? t('Header', 'Başlık') : k === 'token' ? 'Bearer' : 'Cookie'}</button>)}</div>
      {a.kind === 'browser' && <small className="field-hint">{opened[actor] ? t('Window opened. Sign in there, then continue.', 'Pencere açıldı. Orada giriş yap, sonra devam et.') : t('ReproCase opens a separate browser window where you sign in normally. Nothing to copy.', 'ReproCase ayrı bir tarayıcı penceresi açar, normal şekilde giriş yaparsın. Kopyalamak gerekmez.')}</small>}
      {a.kind === 'header' && <input aria-label={`${label} header name`} value={a.name} onChange={e => set({ name: e.target.value })} placeholder="Authorization" spellCheck={false} />}
      {a.kind !== 'browser' && <input aria-label={`${label} credential`} type="password" value={a.value} onChange={e => set({ value: e.target.value })} placeholder={a.kind === 'cookie' ? 'session=…' : a.kind === 'token' ? 'eyJhbGciOi…' : 'Bearer eyJ… / Token …'} spellCheck={false} autoComplete="off" />}
    </fieldset>;
  };

  return <>
    <div className="wizard-progress">{steps.map((label, i) => <div className={page === i ? 'active' : page > i ? 'done' : ''} key={label}><span>{page > i ? <Check size={12} /> : i + 1}</span>{label}</div>)}</div>
    <div className="modal-body wizard-body quick-proof">
      {error && <pre className="inline-error" role="alert">{error}</pre>}

      {page === 0 && <>
        <label>{t('What do you want to prove?', 'Neyi doğrulamak istiyorsun?')}<select aria-label="Proof type" value={kind} disabled={!!busy} onChange={e => changeKind(e.target.value as QuickProofKind)}><option value="authorization">{t('Access between accounts (read or write)', 'Hesaplar arası erişim (okuma veya yazma)')}</option><option value="role">{t('Role / operation authorization', 'Rol / işlem yetkisi')}</option><option value="cors_read">{t('CORS: private data readable by another site', 'CORS: başka sitenin özel veriyi okuyabilmesi')}</option></select></label>
        <p className="help-text">{kind === 'cors_read' ? t('Use one test account you control. Sign in in the separate browser window; no credentials are copied into the shared case.', 'Kontrol ettiğin tek test hesabını kullan. Ayrı tarayıcı penceresinde giriş yap; paylaşılan vakaya oturum bilgisi kopyalanmaz.') : t('Use two test accounts you control on the target. Copy each account’s session from your browser DevTools (Network → any API request → Request headers). Credentials stay on this computer and are never copied into a shared case.', 'Hedefte kontrol ettiğin iki test hesabını kullan. Her hesabın oturumunu tarayıcıdaki DevTools’tan kopyala (Network → herhangi bir API isteği → Request headers). Bilgiler bu bilgisayarda kalır, paylaşılan vakaya asla kopyalanmaz.')}</p>
        <label>{t('Target API', 'Hedef API')}<input aria-label="Target API" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://api.example.com" spellCheck={false} /></label>
        <div className="qp-accounts">{credential('owner', kind === 'cors_read' ? t('Signed-in account', 'Oturum açılan hesap') : t('Account A · owns the object', 'Hesap A · nesnenin sahibi'))}{kind !== 'cors_read' && credential('researcher', t('Account B · tries to access it', 'Hesap B · erişmeyi dener'))}</div>
        {kind === 'cors_read' && <p className="help-text">{t('Sign in in the browser. Real cookie attributes and browser CORS rules are preserved; no Bearer token is copied into the cross-site request.', 'Tarayıcıda giriş yap. Gerçek cookie özellikleri ve tarayıcı CORS kuralları korunur; siteler arası isteğe Bearer token kopyalanmaz.')}</p>}
        <div className="redaction-info"><ShieldCheck size={15} />{t('Next, ReproCase sends a few GET requests (such as /me or /api/v1/profile) with the connected accounts to find who they are. Scope and rate limits apply.', 'Sonraki adımda ReproCase, hesapların kim olduğunu bulmak için bağlanan hesaplarla birkaç GET isteği gönderir (/me, /api/v1/profile gibi). Kapsam ve hız sınırları uygulanır.')}</div>
        {identity && !identity.found && <div className="qp-miss"><p className="help-text">{identity.message}</p>{identity.tried.length > 0 && <table className="qp-fields"><thead><tr><th>{t('Tried', 'Denenen')}</th><th>A</th><th>B</th></tr></thead><tbody>{identity.tried.map(row => <tr key={row.path}><td className="mono">GET {row.path}</td><td className="mono">{row.owner}</td><td className="mono">{row.researcher}</td></tr>)}</tbody></table>}{identity.tried.some(row => row.owner === 401 || row.researcher === 401) && <p className="help-text">{t('HTTP 401 means the session was not accepted: check that the credential is current and sent in the right header.', 'HTTP 401, oturumun kabul edilmediği anlamına gelir: bilginin güncel olduğunu ve doğru başlıkla gönderildiğini kontrol et.')}</p>}<div className="qp-inline"><input aria-label="Identity path" value={customPath} onChange={e => setCustomPath(e.target.value)} placeholder="/api/v2/account" spellCheck={false} /><button className="button secondary" disabled={!customPath.trim() || !!busy} onClick={() => detect({ path: customPath.trim() })}><Search size={14} />{t('Try this path', 'Bu yolu dene')}</button></div></div>}
      </>}

      {page === 1 && identity?.identity && <>
        <p className="help-text">{t('ReproCase compared both accounts and found who they are. If a field is wrong, pick the right one below.', 'ReproCase iki hesabı karşılaştırıp kim olduklarını buldu. Bir alan yanlışsa aşağıdan doğrusunu seç.')}</p>
        <div className="wizard-review">
          <div><span>{t('Identity endpoint', 'Kimlik uç noktası')}</span><strong className="mono">GET {identity.identity.path}</strong></div>
          <div><span>{t('Boundary', 'Sınır')}</span><strong>{kind === 'role' ? `${identity.identity.roles?.join(' → ') ?? t('Select the role field below', 'Aşağıdan rol alanını seç')}: A ${t('may act; B must be denied', 'işlemi yapabilir; B reddedilmeli')}` : kind === 'cors_read' ? 'CORS' : identity.identity.tenantPointer && !identity.identity.sameTenant ? t('Different organizations (cross-tenant)', 'Farklı organizasyonlar (cross-tenant)') : t('Different users (cross-user)', 'Farklı kullanıcılar (cross-user)')}</strong></div>
        </div>
        <table className="qp-fields"><thead><tr><th>{t('Field', 'Alan')}</th><th>A</th>{kind !== 'cors_read' && <th>B</th>}<th>{t('Account ID', 'Hesap ID')}</th><th>{t('Organization', 'Organizasyon')}</th>{kind === 'role' && <th>{t('Role', 'Rol')}</th>}</tr></thead>
          <tbody>{identity.identity.fields.map(f => <tr key={f.pointer} className={f.pointer === identity.identity!.idPointer || f.pointer === identity.identity!.tenantPointer ? 'chosen' : ''}>
            <td className="mono">{f.pointer}</td><td className="mono">{String(f.a)}</td>{kind !== 'cors_read' && <td className="mono">{String(f.b ?? '')}</td>}
            <td><input type="radio" name="qp-id" aria-label={`Use ${f.pointer} as account ID`} checked={f.pointer === identity.identity!.idPointer} disabled={!!busy || String(f.a) === String(f.b)} onChange={() => detect({ idPointer: f.pointer })} /></td>
            <td><input type="radio" name="qp-tenant" aria-label={`Use ${f.pointer} as organization`} checked={f.pointer === identity.identity!.tenantPointer} disabled={!!busy} onChange={() => detect({ tenantPointer: f.pointer })} /></td>
            {kind === 'role' && <td><label><input type="radio" name="qp-role" aria-label={`Use ${f.pointer} as role`} checked={f.pointer === identity.identity!.rolePointer} disabled={!!busy} onChange={() => detect({ rolePointer: f.pointer })} />{t('Role', 'Rol')}</label></td>}
          </tr>)}</tbody></table>
        {identity.identity.tenantPointer && <button className="link-button" disabled={!!busy} onClick={() => detect({ tenantPointer: '' })}>{t('These accounts have no organization field', 'Bu hesapların organizasyon alanı yok')}</button>}
      </>}

      {page === 2 && <>
        <p className="help-text">{t('Paste the request from Burp or DevTools (raw HTTP or METHOD URL). For object writes, also paste the creation request. Captured authentication headers are ignored; your connected accounts are used.', 'Burp veya DevTools’tan isteği yapıştır (ham HTTP ya da METHOD URL). Nesne yazmaları için oluşturma isteğini de ekle. Yakalanan kimlik doğrulama başlıkları dikkate alınmaz; bağladığın hesaplar kullanılır.')}</p>
        {kind !== 'cors_read' && <label>{t('1 · Create a disposable object as A', '1 · A ile silinebilir bir nesne oluştur')}{kind === 'role' && <small>{t('Optional for read-only role tests', 'Salt okuma rol testi için isteğe bağlı')}</small>}<textarea aria-label="Create request" className="code-input compact-code" value={createReq} onChange={e => setCreateReq(e.target.value)} spellCheck={false} placeholder={'POST /api/v1/notes HTTP/1.1\nContent-Type: application/json\n\n{"text":"hello"}'} /></label>}
        <label>{t('2 · The request to test (GET, PATCH, PUT or POST)', '2 · Test edilecek istek (GET, PATCH, PUT veya POST)')}<textarea aria-label="Vulnerable request" className="code-input compact-code" value={vulnReq} onChange={e => setVulnReq(e.target.value)} spellCheck={false} placeholder="PATCH /api/v1/notes/3f1c…" /></label>
        {correction && <div className="qp-miss" role="status"><p>{correction.message}</p>{correction.fields.length > 0 && <label>{t('Field to change', 'Değişecek alan')}<select aria-label="Mutation field" value={field} onChange={e => setField(e.target.value)}><option value="">{t('Choose a field', 'Bir alan seç')}</option>{correction.fields.map(f => <option key={f.pointer} value={f.pointer}>{f.label}</option>)}</select></label>}{correction.read && <label>{t('Owner read request', 'Sahibin okuma isteği')}<textarea aria-label="Owner read request" value={readReq} onChange={e => setReadReq(e.target.value)} placeholder="GET /api/notes/123" /></label>}</div>}
        <div className="redaction-info"><ShieldCheck size={15} />{kind === 'cors_read' ? t('This step checks the signed-in and anonymous baselines. The final run tests whether another site can read the private data.', 'Bu adım oturumlu ve anonim kontrolleri yapar. Son çalıştırma, başka sitenin özel veriyi okuyup okuyamadığını test eder.') : t('Object tests create disposable data and clean it up. Write learning performs one authorized calibration; the final run uses a separate control object and test object. Read-only role tests create no data.', 'Nesne testleri geçici veri oluşturup temizler. Yazma öğrenmesi tek yetkili kontrol değişikliği yapar; son çalıştırma ayrı kontrol ve test nesneleri kullanır. Salt okuma rol testi veri oluşturmaz.')}</div>
      </>}

      {page === 3 && observed && <>
        <div className={`qp-preview ${observed.preview.otherSawObject ? 'hit' : 'miss'}`}>
          <Sparkles size={18} />
          <div><strong>{observed.case.schemaVersion === 2 ? t('The controlled proof is ready to run.', 'Kontrollü kanıt çalıştırılmaya hazır.') : observed.preview.otherSawObject ? t('Account B could read account A’s new object.', 'B hesabı, A’nın yeni nesnesini okuyabildi.') : t(`Account B got HTTP ${observed.preview.other}.`, `B hesabı HTTP ${observed.preview.other} aldı.`)}</strong>
            <span>{t('The draft is ready. The verdict comes from a new run with live controls, not from this learning step.', 'Taslak hazır. Hüküm bu öğrenme adımından değil, canlı kontrollerle yapılan yeni çalıştırmadan gelir.')}</span></div>
        </div>
        <div className="wizard-review">
          <div><span>{t('Identity', 'Kimlik')}</span><strong className="mono">GET {observed.learned.identity.path} → {observed.learned.identity.idPointer}{observed.learned.identity.tenantPointer ? `, ${observed.learned.identity.tenantPointer}` : ''}</strong></div>
          <div><span>{t('Object', 'Nesne')}</span><strong className="mono">{observed.learned.objectPath}</strong></div>
          <div><span>{t('New ID / owner', 'Yeni ID / sahip')}</span><strong className="mono">{observed.learned.idField} / {observed.learned.ownerField}</strong></div>
          <div><span>{t('Unique marker in', 'Benzersiz işaret alanı')}</span><strong className="mono">{observed.learned.markerField}</strong></div>
          <div><span>CSRF</span><strong className="mono">{observed.learned.csrf ? `${observed.learned.csrf.path} → ${observed.learned.csrf.header}` : t('not needed', 'gerekmiyor')}</strong></div>
        </div>
        {observed.notes.length > 0 && <ul className="qp-notes">{observed.notes.map(n => <li key={n}>{n}</li>)}</ul>}
        <p className="help-text">{t('Next: read the access policy, approve it, and run. The verdict comes from the run, not from this preview.', 'Sıradaki: erişim politikasını oku, onayla ve çalıştır. Hüküm bu ön izlemeden değil, çalıştırmadan gelir.')}</p>
      </>}
    </div>
    <div className="modal-footer">
      <button className="button secondary" disabled={page === 0 || !!busy || page === 3} onClick={() => { setPage(page - 1); setError(''); }}><ArrowLeft size={15} />{t('Back', 'Geri')}</button>
      {page === 0 && <button data-testid="qp-connect" className="button primary" disabled={!origin.trim() || !!busy} onClick={connect}>{busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}{t('Connect & identify', 'Bağla ve tanı')}</button>}
      {page === 1 && <button data-testid="qp-identity-ok" className="button primary" disabled={!!busy} onClick={() => setPage(2)}>{t('Looks right', 'Doğru görünüyor')}<ArrowRight size={15} /></button>}
      {page === 2 && <button data-testid="qp-observe" className="button primary" disabled={(kind === 'authorization' && !createReq.trim()) || !vulnReq.trim() || !!busy} onClick={observe}>{busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}{t('Learn & build the case', 'Öğren ve vakayı oluştur')}</button>}
      {page === 3 && observed && <button data-testid="qp-open" className="button primary" onClick={() => void created(observed.case)}>{t('Open the case', 'Vakayı aç')}<ArrowRight size={15} /></button>}
    </div>
  </>;
}
