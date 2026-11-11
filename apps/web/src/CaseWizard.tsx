import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FilePlus2, ShieldCheck } from 'lucide-react';
import { authoringSchema, buildCase, type AuthoringInput } from '../../../packages/core/src/authoring.ts';
import type { CaseSpec } from '../../../packages/core/src/schema.ts';
import { api } from './api.ts';
import type { Lang } from './i18n.ts';

export function CaseWizard({ lang, origin = '', created }: { lang: Lang; origin?: string; created(spec: CaseSpec): Promise<void> }) {
  const tr = lang === 'tr', text = (en: string, turkish: string) => tr ? turkish : en;
  const [page, setPage] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(origin), [body, setBody] = useState('{\n  "title": "Controlled test resource",\n  "marker": "Controlled baseline"\n}');
  const [writeBody, setWriteBody] = useState('{\n  "title": "Controlled change"\n}'), [csrf, setCsrf] = useState(false);
  const [form, setForm] = useState({
    title: '', policy: '', kind: 'read', boundary: 'cross_tenant', identityPath: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '', expectedRole: '',
    createPath: '/documents', idResponsePointer: '/id', ownerResponsePointer: '/ownerId', tenantResponsePointer: '/tenant', ownershipSource: 'creation', readPath: '/documents/{resource}', markerRequestPointer: '/marker', markerResponsePointer: '/marker',
    csrfPath: '/csrf', csrfPointer: '/csrf', csrfHeader: 'x-csrf-token', cleanup: true, cleanupPath: '/documents/{resource}', writePath: '/documents/{resource}', writeMethod: 'PATCH', writeMutationPointer: '/title', writeResponsePointer: '/title',
  });
  const set = (key: string, value: string | boolean) => setForm(old => ({ ...old, [key]: value }));
  const field = (key: keyof typeof form, label: string, hint?: string) => <label>{label}<input aria-label={label} value={String(form[key])} onChange={e => set(key, e.target.value)} spellCheck={false} />{hint && <small className="field-hint">{hint}</small>}</label>;
  const settings = (): AuthoringInput => authoringSchema.parse({
    title: form.title, policy: form.policy, kind: form.kind, boundary: form.boundary,
    identityPath: form.identityPath, idPointer: form.idPointer, ...(form.tenantPointer ? { tenantPointer: form.tenantPointer } : {}), ...(form.rolePointer ? { rolePointer: form.rolePointer } : {}), ...(form.expectedRole ? { expectedRole: form.expectedRole } : {}),
    createPath: form.createPath, createBody: JSON.parse(body), idResponsePointer: form.idResponsePointer, ownerResponsePointer: form.ownerResponsePointer, ...(form.tenantResponsePointer ? { tenantResponsePointer: form.tenantResponsePointer } : {}), ownershipSource: form.ownershipSource,
    readPath: form.readPath, markerRequestPointer: form.markerRequestPointer, markerResponsePointer: form.markerResponsePointer,
    ...(csrf ? { csrf: { path: form.csrfPath, pointer: form.csrfPointer, header: form.csrfHeader } } : {}),
    cleanup: form.cleanup, ...(form.cleanup ? { cleanupPath: form.cleanupPath } : {}),
    ...(form.kind === 'write' ? { writePath: form.writePath, writeMethod: form.writeMethod, writeBody: JSON.parse(writeBody), writeMutationPointer: form.writeMutationPointer, writeResponsePointer: form.writeResponsePointer } : {}),
  });
  const next = () => {
    setError('');
    if (page === 0 && (!form.title.trim() || !form.policy.trim())) { setError(text('Add a title and the expected access policy.', 'Başlık ve beklenen erişim politikasını yaz.')); return; }
    if (page === 1) { try { const result = buildCase(settings()); const errors = result.issues.filter(i => i.level === 'error' && i.path !== 'policy.acknowledged'); if (errors.length) throw new Error(errors.map(i => `${i.path}: ${i.message}`).join('\n')); } catch (e) { setError((e as Error).message); return; } }
    setPage(page + 1);
  };
  const submit = async () => {
    setBusy(true); setError('');
    try { const result = await api<{ case: CaseSpec }>('/api/cases/build', { settings: settings(), ...(target.trim() ? { targetOrigin: target.trim() } : {}) }); await created(result.case); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <div className="wizard-progress">{[text('Policy & identities', 'Politika ve hesaplar'), text('Resource & proof', 'Kaynak ve kanıt'), text('Review draft', 'Taslağı incele')].map((label, i) => <div className={page === i ? 'active' : page > i ? 'done' : ''} key={label}><span>{page > i ? <Check size={12} /> : i + 1}</span>{label}</div>)}</div>
    <div className="modal-body wizard-body">
      {error && <pre className="inline-error" role="alert">{error}</pre>}
      {page === 0 && <>
        <p className="help-text">{text('Describe a boundary between two test accounts. Endpoint examples below match the controlled lab; map them to your application.', 'İki test hesabı arasındaki güvenlik sınırını tanımla. Örnek alanlar yerel laboratuvara uygun; kendi uygulamana göre düzenle.')}</p>
        {field('title', text('Case title', 'Vaka başlığı'))}
        <label>{text('Expected access policy', 'Beklenen erişim politikası')}<textarea value={form.policy} onChange={e => set('policy', e.target.value)} rows={3} placeholder={text('Only the resource owner may read this private document.', 'Bu özel belgeyi yalnızca kaynak sahibi okuyabilir.')} /></label>
        <div className="wizard-grid"><label>{text('Violation to observe', 'Gözlenecek ihlal')}<select aria-label={text('Violation to observe', 'Gözlenecek ihlal')} value={form.kind} onChange={e => set('kind', e.target.value)}><option value="read">{text('Read another account’s content', 'Başka hesabın içeriğini okuma')}</option><option value="write">{text('Change another account’s resource', 'Başka hesabın kaynağını değiştirme')}</option></select></label><label>{text('Security boundary', 'Güvenlik sınırı')}<select aria-label={text('Security boundary', 'Güvenlik sınırı')} value={form.boundary} onChange={e => { set('boundary', e.target.value); if (e.target.value === 'cross_user') { set('tenantPointer', ''); set('tenantResponsePointer', ''); } else { set('tenantPointer', '/tenant'); set('tenantResponsePointer', '/tenant'); } }}><option value="cross_tenant">{text('Different accounts and tenants', 'Farklı hesap ve kurumlar')}</option><option value="cross_user">{text('Different accounts', 'Farklı hesaplar')}</option></select></label></div>
        <label>{text('Target API origin (optional)', 'Hedef API kaynağı (isteğe bağlı)')}<input value={target} onChange={e => setTarget(e.target.value)} placeholder="https://api.example.com" /><small className="field-hint">{text('Saved locally, outside the shareable case. Creating a draft sends no traffic.', 'Yerel olarak saklanır, paylaşılabilir vakaya eklenmez. Taslak oluşturmak ağ isteği göndermez.')}</small></label>
        <h3>{text('Live identity endpoint', 'Canlı kimlik uç noktası')}</h3>
        <div className="wizard-grid">{field('identityPath', text('Identity path', 'Kimlik yolu'))}{field('idPointer', text('Account ID pointer', 'Hesap ID işaretçisi'))}{field('tenantPointer', text('Tenant pointer (optional)', 'Kurum işaretçisi (isteğe bağlı)'))}{field('rolePointer', text('Role pointer (optional)', 'Rol işaretçisi (isteğe bağlı)'))}{field('expectedRole', text('Expected role (optional)', 'Beklenen rol (isteğe bağlı)'))}</div>
      </>}
      {page === 1 && <>
        <p className="help-text">{text('A new resource is created for every run. JSON Pointers select fields, and {resource} binds the new ID in paths.', 'Her çalışmada yeni bir kaynak oluşturulur. JSON Pointer alanları seçer; yollardaki {resource}, yeni ID’ye bağlanır.')}</p>
        <div className="wizard-grid">{field('createPath', text('Create path · POST', 'Oluşturma yolu · POST'))}{field('idResponsePointer', text('Created ID pointer', 'Yeni ID işaretçisi'))}</div>
        <label>{text('Creation body (JSON object)', 'Oluşturma gövdesi (JSON nesnesi)')}<textarea className="code-input compact-code" spellCheck={false} value={body} onChange={e => setBody(e.target.value)} /></label>
        <div className="wizard-grid">{field('readPath', text('Resource read path · GET', 'Kaynak okuma yolu · GET'))}<label>{text('Ownership observed from', 'Sahipliğin gözleneceği yanıt')}<select aria-label={text('Ownership observed from', 'Sahipliğin gözleneceği yanıt')} value={form.ownershipSource} onChange={e => set('ownershipSource', e.target.value)}><option value="creation">{text('Creation response', 'Oluşturma yanıtı')}</option><option value="owner_read">{text('Owner’s resource read', 'Sahibin kaynak okuması')}</option></select></label>{field('ownerResponsePointer', text('Resource owner pointer', 'Kaynak sahibi işaretçisi'))}{field('tenantResponsePointer', text('Resource tenant pointer (optional)', 'Kaynak kurum işaretçisi (isteğe bağlı)'))}</div>
        {form.kind === 'read' ? <div className="wizard-grid">{field('markerRequestPointer', text('Fresh marker in creation body', 'Oluşturma gövdesinde yeni işaret'))}{field('markerResponsePointer', text('Observed marker pointer', 'Gözlenen işaretin işaretçisi'))}</div> : <>
          <div className="wizard-grid">{field('writePath', text('Controlled change path', 'Kontrollü değişiklik yolu'))}<label>{text('Change method', 'Değişiklik yöntemi')}<select aria-label={text('Change method', 'Değişiklik yöntemi')} value={form.writeMethod} onChange={e => set('writeMethod', e.target.value)}>{['PATCH', 'PUT', 'POST'].map(m => <option key={m}>{m}</option>)}</select></label>{field('writeMutationPointer', text('Fresh marker in mutation body', 'Değişiklik gövdesinde yeni işaret'))}{field('writeResponsePointer', text('Field in independent owner reads', 'Bağımsız sahip okumalarındaki alan'))}</div>
          <label>{text('Change body (JSON object)', 'Değişiklik gövdesi (JSON nesnesi)')}<textarea className="code-input compact-code" value={writeBody} onChange={e => setWriteBody(e.target.value)} spellCheck={false} /></label>
          <div className="redaction-info"><ShieldCheck size={15} />{text('The owner reads the field before and after the attempt. A successful write response alone is insufficient.', 'Sahip alanı denemeden önce ve sonra okur. Başarılı yazma yanıtı tek başına yeterli değildir.')}</div>
        </>}
        <label className="checkbox-label"><input type="checkbox" checked={csrf} onChange={e => setCsrf(e.target.checked)} />{text('Fetch a separate CSRF token for each writing account', 'Yazma yapan her hesap için ayrı CSRF değeri al')}</label>
        {csrf && <div className="wizard-grid">{field('csrfPath', text('CSRF path · GET', 'CSRF yolu · GET'))}{field('csrfPointer', text('CSRF response pointer', 'CSRF yanıt işaretçisi'))}{field('csrfHeader', text('CSRF request header', 'CSRF istek başlığı'))}</div>}
        <label className="checkbox-label"><input type="checkbox" checked={form.cleanup} onChange={e => set('cleanup', e.target.checked)} />{text('Delete the newly created resource after the run', 'Çalışma sonunda yeni oluşturulan kaynağı sil')}</label>
        {form.cleanup && field('cleanupPath', text('Cleanup path · DELETE', 'Temizlik yolu · DELETE'))}
      </>}
      {page === 2 && <>
        <div className="wizard-review-icon"><FilePlus2 size={28} /></div><h3>{form.title}</h3><p className="help-text">{form.policy}</p>
        <div className="wizard-review"><div><span>{text('Accounts', 'Hesaplar')}</span><strong>Resource owner → Researcher</strong></div><div><span>{text('Proof', 'Kanıt')}</span><strong>{form.kind === 'read' ? text('Fresh content read by the other account', 'Diğer hesap yeni içeriği okur') : text('Owner verifies a controlled state change', 'Sahip kontrollü durum değişikliğini doğrular')}</strong></div><div><span>{text('Resource', 'Kaynak')}</span><code>POST {form.createPath} → GET {form.readPath}</code></div><div><span>{text('Cleanup', 'Temizlik')}</span><strong>{form.cleanup ? `DELETE ${form.cleanupPath}` : text('Not configured', 'Tanımlanmadı')}</strong></div></div>
        <p className="help-text">{text('The draft starts unapproved. Review the policy in the investigation view, connect two test accounts, then inspect the run plan. No requests are sent when this draft is created.', 'Taslak onaysız başlar. Araştırma görünümünde politikayı incele, iki test hesabını bağla ve çalışma planını kontrol et. Taslak oluşturulurken istek gönderilmez.')}</p>
      </>}
    </div>
    <div className="modal-footer"><button className="button secondary" disabled={page === 0 || busy} onClick={() => { setPage(page - 1); setError(''); }}><ArrowLeft size={15} />{text('Back', 'Geri')}</button>{page < 2 ? <button className="button primary" onClick={next}>{text('Continue', 'Devam')}<ArrowRight size={15} /></button> : <button data-testid="create-draft" className="button primary" disabled={busy} onClick={() => void submit()}><FilePlus2 size={15} />{text('Create draft', 'Taslak oluştur')}</button>}</div>
  </>;
}
