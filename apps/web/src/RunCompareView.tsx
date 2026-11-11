import { useEffect, useState } from 'react';
import { ArrowRight, GitCompareArrows, LoaderCircle } from 'lucide-react';
import type { RunComparison } from '../../../packages/core/src/compare.ts';
import type { RunResult } from '../../../packages/core/src/schema.ts';
import type { Lang } from './i18n.ts';
import { api, download } from './api.ts';

export function RunCompareView({ runs, lang }: { runs: RunResult[]; lang: Lang }) {
  const text = (en: string, tr: string) => lang === 'tr' ? tr : en;
  const [before, setBefore] = useState(runs[1]?.id ?? ''), [after, setAfter] = useState(runs[0]?.id ?? '');
  const [result, setResult] = useState<RunComparison | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let ignore = false; setResult(null); setError('');
    if (!before || !after) return;
    void api<RunComparison>(`/api/runs/compare?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`).then(value => { if (!ignore) setResult(value); }).catch(e => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, [before, after]);
  const verdict = (value: string) => ({ reproduced: text('Reproduced', 'Yeniden üretildi'), not_reproduced: text('Not reproduced', 'Yeniden üretilemedi'), inconclusive: text('Inconclusive', 'Sonuç belirsiz') })[value] ?? value;
  return <>
    <div className="modal-body compare-body">
      <p className="help-text">{text('Compare recorded observations from two finished runs. Fresh IDs and markers have already been redacted in the evidence.', 'Bitmiş iki çalışmanın kayıtlı gözlemlerini karşılaştır. Yeni ID ve işaret değerleri kanıtta zaten temizlenmiştir.')}</p>
      <div className="comparison-selectors">{[[before, setBefore, text('Before run', 'Önceki çalışma')], [after, setAfter, text('After run', 'Sonraki çalışma')]].map(([value, change, label], i) => <label key={i}>{String(label)}<select value={value as string} onChange={e => (change as (value: string) => void)(e.target.value)}>{runs.map(run => <option key={run.id} value={run.id}>{new Date(run.startedAt).toLocaleTimeString()} · r{run.caseRevision} · {verdict(run.verdict)} · {run.id.slice(-6)}</option>)}</select></label>)}</div>
      {error && <pre className="inline-error" role="alert">{error}</pre>}
      {!result && !error && <LoaderCircle className="spin" size={20} />}
      {result && <>
        <div className="compare-verdicts">{[result.before, result.after].map((run, i) => <div key={i} className={run.verdict}><span className="eyebrow">{i ? text('AFTER', 'SONRA') : text('BEFORE', 'ÖNCE')} · r{run.revision}</span><h3>{verdict(run.verdict)}</h3><code>{run.code}</code></div>)}<ArrowRight size={19} /></div>
        {!result.sameRevision && <div className="compare-warning" role="status">{text('Case revisions differ. The application is not the only variable that changed.', 'Vaka sürümleri farklı. Değişen tek etken uygulama değil.')}</div>}
        <div className="comparison-caption"><GitCompareArrows size={15} /><span>{result.changedSteps} / {result.steps.length} {text('steps differ', 'adım farklı')}</span></div>
        {!!result.checksChanged.length && <p className="help-text">{text('Changed prerequisite or witness checks', 'Değişen önkoşul veya kanıt kontrolleri')}: <code>{result.checksChanged.join(', ')}</code></p>}
        <div className="comparison-steps">{result.steps.map(step => <details key={step.id} open={step.changed} className={step.changed ? 'changed' : ''}><summary><strong>{step.label}</strong><span>{step.beforeHTTP ?? '—'} → {step.afterHTTP ?? '—'}</span><span className="pill">{step.changed ? text('Changed', 'Değişti') : step.limited ? text('Limited', 'Sınırlı') : text('Same', 'Aynı')}</span></summary><div className="comparison-step-body"><p>{step.beforeStatus ?? '—'} → {step.afterStatus ?? '—'}</p>{(step.beforeError || step.afterError) && <pre>{step.beforeError ?? '—'} → {step.afterError ?? '—'}</pre>}{!!step.checksChanged.length && <p>{text('Changed checks', 'Değişen kontroller')}: <code>{step.checksChanged.join(', ')}</code></p>}{step.fields.map(field => <div className="field-difference" key={field.pointer}><code className="field-pointer">{field.pointer}</code><div><span>{text('Before', 'Önce')}</span><pre>{field.before === undefined ? '—' : JSON.stringify(field.before, null, 2)}</pre></div><div><span>{text('After', 'Sonra')}</span><pre>{field.after === undefined ? '—' : JSON.stringify(field.after, null, 2)}</pre></div></div>)}</div></details>)}</div>
        <p className="help-text">{text('This compares stored evidence and sends no target traffic. It does not prove that every variant of a vulnerability is fixed.', 'Bu görünüm kayıtlı kanıtları karşılaştırır ve hedefe istek göndermez. Bir açığın tüm türlerinin giderildiğini kanıtlamaz.')}</p>
        {result.truncated && <p className="compare-warning">{text('Display limit reached. Inspect the original evidence for the full response bodies.', 'Görüntüleme sınırına ulaşıldı. Tam yanıtlar için özgün kanıtı incele.')}</p>}
      </>}
    </div>
    <div className="modal-footer"><span className="security-footnote">{text('Recorded evidence', 'Kayıtlı kanıt')}</span><button className="button secondary" disabled={!result} onClick={() => result && download(`${result.caseId}.comparison.json`, JSON.stringify(result, null, 2), 'application/json')}>{text('Download comparison', 'Karşılaştırmayı indir')}</button></div>
  </>;
}
