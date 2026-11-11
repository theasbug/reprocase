import { CircleCheck, CircleHelp, LockKeyhole, Network, Play } from 'lucide-react';
import type { RunPlan } from '../../../packages/core/src/preflight.ts';
import type { Lang } from './i18n.ts';

export function RunPlanView({ plan, lang, canRun, busy, start }: { plan: RunPlan; lang: Lang; canRun: boolean; busy: boolean; start(): void }) {
  const text = (en: string, tr: string) => lang === 'tr' ? tr : en;
  return <>
    <div className="modal-body plan-body">
      <div className={`plan-summary ${plan.ready ? 'ready' : ''}`}><Network size={23} /><div><h3>{plan.ready ? text('Ready for live verification', 'Canlı doğrulamaya hazır') : text('Resolve these gaps before running', 'Çalıştırmadan önce eksikleri tamamla')}</h3><p>{text('No target requests have been sent. Live identity checks still run when you start.', 'Hedefe istek gönderilmedi. Başlattığında kimlikler canlı olarak tekrar doğrulanır.')}</p></div><span className="pill mono">r{plan.revision}</span></div>
      <div className="plan-counts">{[[plan.totals.reads, text('Read steps', 'Okuma adımı')], [plan.totals.writes, text('Write steps', 'Yazma adımı')], [plan.totals.identityChecks, text('Identity checks', 'Kimlik kontrolü')], [`≤ ${plan.totals.maximumPlannedRequests}`, text('Planned requests', 'Planlanan istek')]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="plan-targets">{Object.entries(plan.targets).map(([alias, origin]) => <div key={alias}><span>{alias}</span><code>{origin}</code></div>)}</div>
      <div className="plan-accounts">{plan.accounts.map(actor => <div key={actor.id} className={actor.bound && actor.originMatches ? 'bound' : ''}><LockKeyhole size={15} /><strong>{actor.label}</strong><span>{!actor.bound ? text('Not connected', 'Bağlı değil') : !actor.originMatches ? text('Different origin', 'Farklı kaynak') : actor.verifiedPreviously ? text('Previously verified', 'Önceden doğrulandı') : text('Awaiting identity check', 'Kimlik kontrolü bekliyor')}</span></div>)}</div>
      {!!plan.issues.length && <div>{plan.issues.map((issue, i) => <div className={`validation-item ${issue.level}`} key={i}><CircleHelp size={14} /><div><code>{issue.path}</code><span>{issue.message}</span></div></div>)}</div>}
      <h3>{text('Declared request order', 'Tanımlı istek sırası')}</h3>
      <div className="plan-steps">{plan.steps.map((step, index) => <article key={step.id}><div className="plan-step-heading"><span className="plan-number">{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><span className={`effect-pill ${step.effect}`}>{step.effect === 'write' ? text('Changes data', 'Veri değiştirir') : text('Read', 'Okuma')}</span></div><div className="plan-request"><span className={`method ${step.method}`}>{step.method}</span><code>{step.path}</code><span className="pill mono">{step.actor}</span></div>{!!step.dependencies.length && <p className="plan-dependencies">{text('Depends on', 'Bağımlı olduğu adımlar')}: <code>{step.dependencies.join(', ')}</code></p>}{!!step.produces.length && <p className="plan-dependencies">{text('Captures', 'Çıkarılan değerler')}: <code>{step.produces.join(', ')}</code></p>}</article>)}</div>
      <p className="help-text">{text('The request estimate includes identity rechecks and cleanup. A failed prerequisite can stop the run earlier. Budget', 'İstek tahmini kimlik kontrollerini ve temizliği içerir. Başarısız önkoşul çalışmayı erken durdurabilir. Bütçe')}: {plan.totals.requestBudget}.</p>
    </div>
    <div className="modal-footer"><span className="security-footnote"><CircleCheck size={14} />{text('Only the displayed revision and origins', 'Yalnızca gösterilen sürüm ve kaynaklar')}</span><button data-testid="confirm-run" className="button primary" disabled={!plan.ready || !canRun || busy} onClick={start}><Play size={15} />{text('Run reviewed plan', 'İncelenen planı çalıştır')}</button></div>
  </>;
}
