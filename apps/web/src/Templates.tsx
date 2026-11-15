import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, BookmarkPlus, LoaderCircle, Play, ShieldCheck, Trash2 } from 'lucide-react';
import type { CaseSpec } from '../../../packages/core/src/schema.ts';
import { api } from './api.ts';
import type { Lang } from './i18n.ts';

interface Slot { path: string; uses: string[] }
interface Template { id: string; name: string; description: string; appliesTo: string; tags: string[]; builtIn: boolean; createdAt: string; case: CaseSpec; slots: Slot[] }
interface Used { case: CaseSpec; targets: Record<string, string>; scopeChecked: boolean }

const download = (name: string, data: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const kindLabel = (spec: CaseSpec) => spec.schemaVersion === 2 ? spec.kind === 'cors_read' ? 'CORS' : spec.kind === 'function_read' || spec.boundary === 'role' ? 'Role' : spec.witness.writeProof ? 'Write' : 'Read' : spec.witness.writeProof ? 'Write' : 'Read';

/** Saves the current case as a reusable template. Accounts, targets and evidence are not included. */
export function SaveTemplate({ lang, spec, done }: { lang: Lang; spec: CaseSpec; done(template: Template): void }) {
  const t = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const [name, setName] = useState(spec.title), [appliesTo, setAppliesTo] = useState(''), [tags, setTags] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { done(await api<Template>('/api/templates', { caseId: spec.id, name: name.trim(), appliesTo: appliesTo.trim(), description: description.trim(), tags: tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 12) })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <div className="modal-body wizard-body">
      {error && <pre className="inline-error" role="alert">{error}</pre>}
      <p className="help-text">{t('Keep this case as a template and reuse it later on another target you are allowed to test. Accounts, target addresses, cookies, tokens and run evidence are not saved in the template.', 'Bu vakayı şablon olarak sakla ve daha sonra test etme iznin olan başka bir hedefte kullan. Hesaplar, hedef adresleri, cookie, token ve çalışma kanıtları şablona kaydedilmez.')}</p>
      <label>{t('Template name', 'Şablon adı')}<input aria-label="Template name" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
      <label>{t('Works on (optional)', 'Nerede işe yarar (isteğe bağlı)')}<input aria-label="Works on" value={appliesTo} maxLength={200} placeholder={t('e.g. apps built on the same SaaS or framework API', 'ör. aynı SaaS veya framework API’sini kullanan uygulamalar')} onChange={e => setAppliesTo(e.target.value)} /></label>
      <label>{t('Tags, comma separated (optional)', 'Etiketler, virgülle (isteğe bağlı)')}<input aria-label="Tags" value={tags} placeholder="idor, write, invoices" onChange={e => setTags(e.target.value)} /></label>
      <label>{t('Notes (optional)', 'Notlar (isteğe bağlı)')}<textarea aria-label="Notes" rows={3} value={description} maxLength={2000} onChange={e => setDescription(e.target.value)} /></label>
    </div>
    <div className="modal-footer"><span /><button data-testid="save-template-confirm" className="button primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? <LoaderCircle className="spin" size={15} /> : <BookmarkPlus size={15} />}{t('Save template', 'Şablonu kaydet')}</button></div>
  </>;
}

/** Template library: reuse a template on one target that the user types, with their own test accounts. */
export function TemplateLibrary({ lang, used }: { lang: Lang; used(result: Used): Promise<void> }) {
  const t = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const [items, setItems] = useState<Template[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({}), [paths, setPaths] = useState<Record<string, string>>({}), [title, setTitle] = useState('');
  const load = async () => { try { setItems(await api<Template[]>('/api/templates')); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const choose = (template: Template) => {
    setSelected(template); setError(''); setTitle(template.case.title);
    setTargets(Object.fromEntries(template.case.origins.map(origin => [origin.id, ''])));
    setPaths(Object.fromEntries(template.slots.map(slot => [slot.path, slot.path])));
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try { await api('/api/templates/import', { data: await file.text() }); await load(); } catch (e) { setError((e as Error).message); }
  };
  const remove = async (template: Template) => {
    if (!confirm(t(`Delete the template “${template.name}”? Cases created from it stay.`, `“${template.name}” şablonu silinsin mi? Ondan oluşturulan vakalar kalır.`))) return;
    try { await api(`/api/templates/${encodeURIComponent(template.id)}`, undefined, 'DELETE'); await load(); } catch (e) { setError((e as Error).message); }
  };
  const use = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { await used(await api<Used>(`/api/templates/${encodeURIComponent(selected.id)}/use`, { targets, title: title.trim() || undefined, paths })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (selected) return <>
    <div className="modal-body wizard-body">
      {error && <pre className="inline-error" role="alert">{error}</pre>}
      <p className="help-text">{t('Type the target yourself. ReproCase never picks or searches for targets. Use only a target in your program’s scope, with test accounts you created there.', 'Hedefi kendin yaz. ReproCase hedef seçmez ve aramaz. Sadece programının kapsamındaki bir hedefi, orada açtığın test hesaplarıyla kullan.')}</p>
      <div className="template-banner"><strong>{selected.name}</strong>{selected.appliesTo && <span>{selected.appliesTo}</span>}</div>
      {selected.case.origins.map(origin => <label key={origin.id}>{t(`Target address · ${origin.label}`, `Hedef adresi · ${origin.label}`)}<input aria-label={`Target address ${origin.id}`} value={targets[origin.id] ?? ''} placeholder="https://api.example.com" spellCheck={false} onChange={e => setTargets(old => ({ ...old, [origin.id]: e.target.value }))} /></label>)}
      <label>{t('Case title', 'Vaka başlığı')}<input aria-label="Case title" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <div className="template-paths">
        <div className="template-paths-head"><span>{t('Paths on the new target', 'Yeni hedefteki yollar')}</span><small>{t('Change a path only if this target’s API uses a different one. Keep the {placeholders}.', 'Sadece bu hedefin API’si farklı bir yol kullanıyorsa değiştir. {yer tutucuları} koru.')}</small></div>
        {selected.slots.map(slot => <label key={slot.path} className="template-path-row"><span className="mono">{slot.path}</span><input aria-label={`Path for ${slot.path}`} className="mono" value={paths[slot.path] ?? slot.path} spellCheck={false} onChange={e => setPaths(old => ({ ...old, [slot.path]: e.target.value }))} /><small>{slot.uses.join(' · ')}</small></label>)}
      </div>
      <p className="help-text"><ShieldCheck size={13} /> {t('If you saved a program, the target is checked against its scope now, and every request of the run is checked again. The new case is not approved yet: review it, connect your accounts, then approve and run.', 'Bir program kaydettiysen hedef şimdi kapsamına göre kontrol edilir; çalışmadaki her istek de yeniden kontrol edilir. Yeni vaka henüz onaylı değil: incele, hesaplarını bağla, sonra onaylayıp çalıştır.')}</p>
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={() => setSelected(null)}>{t('Back', 'Geri')}</button><button data-testid="use-template-confirm" className="button primary" disabled={busy || selected.case.origins.some(origin => !targets[origin.id]?.trim())} onClick={use}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{t('Create case on this target', 'Bu hedefte vaka oluştur')}</button></div>
  </>;

  return <div className="modal-body">
    {error && <pre className="inline-error" role="alert">{error}</pre>}
    <div className="template-toolbar"><p className="help-text">{t('Reuse a proven case on another target you are allowed to test. Save your own from a case with “Save as template”.', 'Kanıtlanmış bir vakayı test etme iznin olan başka bir hedefte yeniden kullan. Kendi şablonunu bir vakadaki “Şablon olarak kaydet” ile oluştur.')}</p>
      <label className="button secondary small"><ArrowUpFromLine size={14} />{t('Import file', 'Dosya içe aktar')}<input data-testid="template-import" type="file" accept=".json,application/json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
    {!items ? <p className="help-text"><LoaderCircle className="spin" size={14} /></p> : !items.length ? <p className="help-text">{t('No templates yet.', 'Henüz şablon yok.')}</p> :
      <div className="template-list">{items.map(template => <article key={template.id} className="template-card" data-testid="template-card">
        <div className="template-card-head"><strong>{template.name}</strong><span className="template-kind">{kindLabel(template.case)}</span>{template.builtIn && <span className="template-builtin">{t('Built-in', 'Hazır')}</span>}</div>
        {template.appliesTo && <p className="template-applies">{template.appliesTo}</p>}
        {!!template.tags.length && <div className="template-tags">{template.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
        <div className="template-card-actions">
          <button className="button primary small" data-testid="use-template" onClick={() => choose(template)}><Play size={13} />{t('Use on a target', 'Bir hedefte kullan')}</button>
          <button className="button secondary small" onClick={() => download(`${template.id}.reprocase-template.json`, Object.fromEntries(Object.entries(template).filter(([key]) => key !== 'builtIn' && key !== 'slots')))}><ArrowDownToLine size={13} />{t('Download', 'İndir')}</button>
          {!template.builtIn && <button className="icon-button tiny" aria-label={t('Delete template', 'Şablonu sil')} onClick={() => remove(template)}><Trash2 size={14} /></button>}
        </div>
      </article>)}</div>}
  </div>;
}
