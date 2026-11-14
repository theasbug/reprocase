import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpFromLine, Blocks, Bot, Braces, Check, CheckCheck,
  ChevronDown, ChevronRight, Circle, CircleCheck, CircleHelp, CircleStop, CircleX,
  Command, Copy, FileCode2, FileJson2, FlaskConical, Globe2, KeyRound, Layers3, Link2,
  LoaderCircle, LockKeyhole, Moon, MoreHorizontal, Network, Play, Plus, Radio, RefreshCw,
  Settings2, ShieldCheck, ShieldOff, Sparkles, Square, Sun, Terminal, Trash2, UserRound,
  Waypoints, X, Zap,
} from 'lucide-react';
import { caseSchema, type ActorSpec, type CaseSpec, type Identity, type MatrixResult, type ReproPackage, type RunResult, type StepResult, type StepSpec, type ValidationIssue } from '../../../packages/core/src/schema.ts';
import type { ReconEndpoint, ReconReport } from '../../../packages/core/src/recon.ts';
import type { CandidateResult } from '../../../packages/core/src/candidates.ts';
import { api, download, hasToken, setToken } from './api.ts';
import { words, type Lang, type Word } from './i18n.ts';
import { VERSION } from '../../../packages/core/src/version.ts';
import type { RunPlan } from '../../../packages/core/src/preflight.ts';
import { ProvidersSettings } from './ProvidersSettings.tsx';
import { HelpGuide } from './HelpGuide.tsx';
import { AIChat } from './AIChat.tsx';
import { BountyCenter } from './BountyCenter.tsx';
import { CaseWizard } from './CaseWizard.tsx';
import { QuickProof } from './QuickProof.tsx';
import { RunPlanView } from './RunPlanView.tsx';
import { RunCompareView } from './RunCompareView.tsx';

interface ActorStatus { id: string; caseId?: string; label?: string; mode: 'browser' | 'direct'; origin: string; connected: boolean; identity?: Identity; url?: string; error?: string }
interface State { version: string; cases: CaseSpec[]; actors: ActorStatus[]; runs: RunResult[]; targets?: Record<string, Record<string, string>>; demo: { origin: string; mode: 'vulnerable' | 'secure'; accounts?: unknown[] } | null; ai: { configured: boolean; provider?: 'openai' | 'compatible'; model?: string; baseURL?: string } }
interface Proposal { case: CaseSpec; baseRevision: number; explanation: string; warnings: string[] }
const emptyState: State = { version: VERSION, cases: [], actors: [], runs: [], demo: null, ai: { configured: false } };
const format = (value: unknown) => JSON.stringify(value, null, 2);
const readable = (value: unknown) => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const time = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const shortPath = (value?: string) => { try { return new URL(value!).pathname; } catch { return value ?? ''; } };

function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close(): void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); const el = dialog.current; return () => el?.close(); }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} aria-label={title}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={19} /></button></div>{children}
  </dialog>;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => sessionStorage.getItem('reprocase.lang') === 'tr' ? 'tr' : 'en');
  const t = (key: Word): string => words[lang][key];
  const [theme, setTheme] = useState(() => localStorage.getItem('reprocase.theme') ?? 'dark');
  const [state, setState] = useState<State>(emptyState);
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState<'overview' | 'specification' | 'timeline' | 'help'>('overview');
  const [selectedStep, setSelectedStep] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [authNeeded, setAuthNeeded] = useState(!hasToken());
  const [tokenInput, setTokenInput] = useState('');
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [approved, setApproved] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const savedRef = useRef<CaseSpec | undefined>(undefined);
  const dirty = useRef(false);
  const draftRef = useRef('');
  const generation = useRef(0);
  const saveLock = useRef(false);
  const [modal, setModal] = useState<'quickproof' | 'create' | 'plan' | 'compare' | 'matrix' | 'recon' | 'import' | 'export' | 'settings' | 'proposal' | 'traffic' | null>(null);
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);
  const [reconOrigin, setReconOrigin] = useState('');
  const [reconSource, setReconSource] = useState('');
  const [reconReport, setReconReport] = useState<ReconReport | null>(null);
  const [reconEndpoints, setReconEndpoints] = useState<ReconEndpoint[]>([]);
  const [planned, setPlanned] = useState<{ plan: RunPlan; requestedTargets: Record<string, string> } | null>(null);
  const [actorModal, setActorModal] = useState<ActorSpec | null>(null);
  const [loginMode, setLoginMode] = useState<'browser' | 'ai' | 'direct'>('browser');
  const [loginOrigin, setLoginOrigin] = useState('');
  const [loginData, setLoginData] = useState({ username: '', password: '', instructions: '', token: '', cookie: '' });
  const [browserStatus, setBrowserStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [traffic, setTraffic] = useState<Record<string, unknown>[]>([]);
  const [trafficSelection, setTrafficSelection] = useState<Set<number>>(new Set());
  const [importKind, setImportKind] = useState<'har' | 'http' | 'burp' | 'postman' | 'package' | 'arjun' | 'ffuf'>('har');
  const [candidates, setCandidates] = useState<CandidateResult | null>(null);
  const [quickProofSeed, setQuickProofSeed] = useState('');
  const [importText, setImportText] = useState('');
  const [pack, setPack] = useState<ReproPackage | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState('');
  const current = useMemo(() => { const parsed = caseSchema.safeParse(safeParse(draftText)); return parsed.success ? parsed.data : savedRef.current; }, [draftText]);
  const runs = state.runs.filter(run => run.caseId === selectedId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const run = runs.find(item => item.id === selectedRunId) ?? runs[0];
  const activeRun = runs.find(item => item.state === 'running');
  const actorStates = state.actors.filter(actor => !actor.caseId || actor.caseId === selectedId);
  const connectedCount = current?.actors.filter(actor => actorStates.some(status => status.id === actor.id && status.connected)).length ?? 0;
  const actorBase = actorModal && current ? `/api/cases/${current.id}/actors/${actorModal.id}` : '';
  const step = current?.steps.find(item => item.id === selectedStep) ?? current?.steps[0];

  const refresh = useCallback(async () => {
    try {
      const next = await api<State>('/api/state');
      setState({ ...emptyState, ...next }); setAuthNeeded(false);
      setSelectedId(id => id && next.cases.some(item => item.id === id) ? id : next.cases[0]?.id ?? '');
      return next;
    } catch (cause) { setError((cause as Error).message); if (!hasToken() || /unauthorized|token|401/i.test((cause as Error).message)) setAuthNeeded(true); return null; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 1800); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('reprocase.theme', theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; sessionStorage.setItem('reprocase.lang', lang); }, [lang]);
  useEffect(() => {
    const next = state.cases.find(item => item.id === selectedId);
    if (!next || dirty.current || saveLock.current) return;
    if (savedRef.current?.id === next.id && savedRef.current.revision === next.revision) return;
    const sameCase = savedRef.current?.id === next.id;
    savedRef.current = next; draftRef.current = format(next); setDraftText(draftRef.current); setSaveState('saved');
    setApproved(false); setSelectedStep(next.steps[0]?.id ?? '');
    setTargets(previous => Object.fromEntries(next.origins.map(origin => [origin.id,
      (sameCase ? previous[origin.id] : undefined)
      ?? state.targets?.[next.id]?.[origin.id]
      ?? state.actors.find(session => session.caseId === next.id && next.actors.some(actor => actor.id === session.id && actor.identity.origin === origin.id))?.origin
      ?? '',
    ])));
    void api<{ issues: ValidationIssue[] }>(`/api/cases/${next.id}/validate`).then(result => setIssues(result.issues)).catch(() => {});
  }, [state.cases, selectedId, state.demo]);

  const persist: () => Promise<void> = useCallback(async () => {
    if (saveLock.current || !dirty.current || !savedRef.current) return;
    const parsed = caseSchema.safeParse(safeParse(draftRef.current));
    if (!parsed.success) { setSaveState('error'); setSaveError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).slice(0, 4).join('\n')); return; }
    const gen = generation.current;
    saveLock.current = true; setSaveState('saving');
    try {
      const previous = savedRef.current;
      const result = await api<CaseSpec>(`/api/cases/${previous.id}`, { case: { ...parsed.data, id: previous.id, revision: previous.revision }, expectedRevision: previous.revision }, 'PUT');
      savedRef.current = result; setState(old => ({ ...old, cases: old.cases.map(item => item.id === result.id ? result : item) }));
      if (generation.current === gen) { dirty.current = false; draftRef.current = format(result); setDraftText(draftRef.current); setSaveState('saved'); setSaveError(''); }
      void api<{ issues: ValidationIssue[] }>(`/api/cases/${result.id}/validate`).then(value => setIssues(value.issues)).catch(() => {});
    } catch (cause) { setSaveState('error'); setSaveError((cause as Error).message); }
    finally {
      saveLock.current = false;
      if (dirty.current && generation.current !== gen) setTimeout(() => { void persist(); }, 100);
    }
  }, []);
  useEffect(() => { if (!dirty.current) return; const timer = setTimeout(() => { void persist(); }, 850); return () => clearTimeout(timer); }, [draftText, persist]);
  const editText = (text: string) => { draftRef.current = text; dirty.current = true; generation.current++; setDraftText(text); setSaveState('saving'); setApproved(false); };
  const editCase = (next: CaseSpec) => editText(format(next));
  const changeStep = (patch: Partial<StepSpec> | { request: Partial<StepSpec['request']> }) => {
    if (!current || !step) return;
    editCase({ ...current, steps: current.steps.map(item => item.id === step.id ? { ...item, ...patch, request: { ...item.request, ...(patch.request ?? {}) } } as StepSpec : item) });
  };
  const act = async (name: string, fn: () => Promise<void>) => { setBusy(name); setError(''); try { await fn(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(''); } };
  const loadDemo = () => act('demo', async () => {
    const result = await api<{ case?: CaseSpec; origin: string }>('/api/demo/start', { mode: 'vulnerable' });
    dirty.current = false; savedRef.current = undefined; setTargets({ api: result.origin });
    const next = await refresh(); setSelectedId(result.case?.id ?? next?.cases[0]?.id ?? ''); setTab('overview'); setSelectedRunId('');
  });
  const inspectPlan = () => act('plan', async () => {
    if (!current || dirty.current) return;
    const requestedTargets = { ...targets };
    const plan = await api<RunPlan>(`/api/cases/${current.id}/preflight`, { targets: requestedTargets, approvedRevision: current.revision });
    setPlanned({ plan, requestedTargets }); setModal('plan');
  });
  const planCurrent = !!planned && planned.plan.caseId === current?.id && planned.plan.revision === current?.revision && JSON.stringify(planned.requestedTargets) === JSON.stringify(targets) && !dirty.current;
  const startRun = () => act('run', async () => {
    if (!current || !approved || dirty.current) return;
    if (!planned || !planCurrent || !planned.plan.ready) throw new Error(lang === 'tr' ? 'Güncel çalışma planını tekrar incele.' : 'Inspect the current run plan again.');
    const result = await api<RunResult>(`/api/cases/${current.id}/run`, { targets: planned.plan.targets, approvedRevision: planned.plan.revision });
    setModal(null); setPlanned(null);
    setSelectedRunId(result.id); setState(old => ({ ...old, runs: [result, ...old.runs.filter(item => item.id !== result.id)] }));
    setTab('timeline'); setApproved(false); await refresh();
  });
  const isLeadKind = importKind === 'arjun' || importKind === 'ffuf';
  const findCandidates = () => act('import', async () => { setCandidates(await api<CandidateResult>('/api/candidates', { kind: importKind, data: importText })); });
  const importData = (data = importText, kind: string = importKind) => act('import', async () => {
    const result = await api<{ case: CaseSpec; warnings: string[] }>('/api/import', { kind, data });
    dirty.current = false; savedRef.current = undefined; setSelectedId(result.case.id); setNotice(result.warnings?.join(' · ') ?? '');
    setModal(null); setActorModal(null); setImportText(''); setCandidates(null); setTab('specification'); await refresh();
  });
  const openActor = (actor: ActorSpec) => { setActorModal(actor); setLoginMode('browser'); setLoginOrigin(targets[actor.identity.origin] ?? ''); setLoginData({ username: '', password: '', instructions: '', token: '', cookie: '' }); setBrowserStatus(''); setRecording(false); };
  const browserAction = (kind: string) => act(kind, async () => {
    if (kind === 'open') await api(`${actorBase}/browser`, { origin: loginOrigin });
    else if (kind === 'verify') { const result = await api(`${actorBase}/verify`, { targets: { ...targets, [actorModal!.identity.origin]: loginOrigin } }); setBrowserStatus(format(result)); }
    else if (kind === 'direct') { await api(`${actorBase}/direct`, { origin: loginOrigin, ...(loginData.token ? { token: loginData.token } : {}), ...(loginData.cookie ? { cookie: loginData.cookie } : {}) }); setLoginData(old => ({ ...old, token: '', cookie: '' })); }
    else if (kind === 'assist') {
      const existing = actorStates.find(item => item.id === actorModal?.id);
      if (!existing || existing.mode !== 'browser' || existing.origin !== new URL(loginOrigin).origin) await api(`${actorBase}/browser`, { origin: loginOrigin });
      const result = await api(`${actorBase}/assist`, { username: loginData.username, password: loginData.password, instructions: loginData.instructions });
      setLoginData(old => ({ ...old, password: '' })); setBrowserStatus(format(result));
    }
    else if (kind === 'snapshot') setBrowserStatus(format(await api(`${actorBase}/snapshot`)));
    else if (kind === 'recording') { await api(`${actorBase}/recording`, { enabled: !recording }); setRecording(!recording); }
    else if (kind === 'traffic') { const result = await api<{ entries: Record<string, unknown>[] }>(`${actorBase}/traffic`); setTraffic(result.entries); setTrafficSelection(new Set(result.entries.map((_, i) => i))); setModal('traffic'); }
    await refresh();
  });
  const openExport = () => act('export', async () => { if (!current) return; setPack(await api<ReproPackage>(`/api/cases/${current.id}/export${run ? `?runId=${run.id}` : ''}`)); setReviewed(false); setModal('export'); });
  const reportDownload = (kind: 'markdown' | 'html' | 'bounty' | 'hurl' | 'playwright') => act('report', async () => {
    if (!current) return;
    const text = await api<string>(`/api/cases/${current.id}/report?format=${kind}${run ? `&runId=${run.id}` : ''}`);
    const ext = kind === 'html' ? 'html' : kind === 'bounty' ? 'bounty.md' : kind === 'hurl' ? 'hurl' : kind === 'playwright' ? 'spec.ts' : 'md';
    download(`${current.id}.${ext}`, text, kind === 'html' ? 'text/html' : 'text/plain');
  });
  const runRoleMatrix = () => act('matrix', async () => {
    if (!current || !approved || dirty.current) return;
    const result = await api<MatrixResult>(`/api/cases/${current.id}/matrix`, { targets, approvedRevision: current.revision });
    setMatrixResult(result);
    await refresh();
  });
  const draftAllTraffic = () => act('import', async () => {
    if (!current) return;
    const result = await api<{ case: CaseSpec; warnings: string[] }>(`/api/cases/${current.id}/traffic/draft`, {});
    dirty.current = false; savedRef.current = undefined; setSelectedId(result.case.id); setNotice(result.warnings?.join(' · ') ?? '');
    setModal(null); setActorModal(null); setTab('specification'); await refresh();
  });
  const openRecon = () => {
    const firstOrigin = Object.values(targets).find(Boolean) ?? state.demo?.origin ?? '';
    if (!reconOrigin && firstOrigin) setReconOrigin(firstOrigin);
    setModal('recon');
  };
  const runReconProbe = () => act('recon', async () => {
    if (!reconOrigin.trim()) return;
    const report = await api<ReconReport>('/api/recon/probe', { origin: reconOrigin.trim() });
    setReconReport(report);
    setReconEndpoints(report.endpoints);
  });
  const runReconExtract = () => act('recon', async () => {
    if (!reconSource.trim()) return;
    const result = await api<{ endpoints: ReconEndpoint[] }>('/api/recon/extract', { sourceText: reconSource });
    setReconEndpoints(result.endpoints);
  });
  const draftFromRecon = (endpoint: ReconEndpoint) => act('recon', async () => {
    const result = await api<{ case: CaseSpec; warnings: string[] }>('/api/recon/draft-case', { endpoint, ...(reconOrigin.trim() ? { targetOrigin: reconOrigin.trim() } : {}) });
    dirty.current = false; savedRef.current = undefined; setSelectedId(result.case.id); setNotice(result.warnings?.join(' · ') ?? '');
    setModal(null); setTab('overview'); await refresh();
  });
  const makeProposal = () => act('ai', async () => { if (!current) return; const result = await api<Proposal>('/api/ai/propose', { caseId: current.id, prompt }); setProposal(result); setModal('proposal'); });
  const isBusy = !!busy;
  const phaseLabel = (phase: string) => t((['prepare', 'probe', 'verify', 'cleanup'].includes(phase) ? phase : 'identity') as Word);

  return <div className={`app-shell ${assistantOpen ? 'chat-mode' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="ReproCase"><div className="brand-mark"><Waypoints size={23} strokeWidth={2.1} /></div><span>repro<span className="brand-light">case</span><sup>α</sup></span></a>
      <div className="workspace-chip"><span className="status-dot" /><span>{t('local')}</span><LockKeyhole size={12} /></div>
      <button className="sidebar-nav active" onClick={() => { setTab('overview'); setAssistantOpen(false); }}><Layers3 size={17} />{t('workspace')}<span className="key-hint">⌘ 1</span></button>
      <div className="sidebar-label"><span>{t('cases')}</span><button data-testid="create-case" className="icon-button tiny" disabled={dirty.current || isBusy} aria-label={lang === 'tr' ? 'Yeni vaka oluştur' : 'Create a case'} onClick={() => setModal('create')}><Plus size={15} /></button></div>
      <div className="case-list">{state.cases.map(item => <button key={item.id} disabled={dirty.current || saveState === 'saving'} className={`case-link ${item.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setSelectedRunId(''); setTab('overview'); setAssistantOpen(false); }}><FileCode2 size={15} /><span>{item.title}</span><ChevronRight size={13} /></button>)}{!state.cases.length && <div className="no-cases">{lang === 'tr' ? 'İlk vakanı oluştur.' : 'Your first case starts here.'}</div>}</div>
      <button className="sidebar-import" data-testid="open-recon" onClick={openRecon}><Radio size={15} />{lang === 'tr' ? 'Bug Bounty Merkezi' : 'Bug Bounty Center'}</button>
      <button className="sidebar-import" onClick={() => setModal('import')}><ArrowUpFromLine size={15} />{t('import')}</button>
      <div className="sidebar-bottom"><div className="sidebar-foot-note"><ShieldCheck size={16} /><span>{t('openSource')}</span></div><div className="sidebar-foot-row"><span className="mono">v{state.version}</span><div><button className="icon-button tiny" aria-label="Language" onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}>{lang.toUpperCase()}</button><button className="icon-button tiny" aria-label="Toggle color theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button tiny" aria-label={t('aiSettings')} onClick={() => setModal('settings')}><Settings2 size={16} /></button></div></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><Blocks size={15} /><span>{t('local')}</span><ChevronRight size={13} /><strong>{assistantOpen ? 'AI Assistant' : current?.title ?? t('workspace')}</strong></div><div className="topbar-right"><button className="icon-button new-case-topbar" aria-label={lang === 'tr' ? 'Yeni vaka' : 'New case'} disabled={dirty.current || isBusy} onClick={() => setModal('create')}><Plus size={17} /></button><span className="privacy-label"><span className="status-dot" />127.0.0.1</span><button className={`assistant-toggle ${assistantOpen ? 'is-active' : ''}`} onClick={() => setAssistantOpen(true)}><Sparkles size={15} />{t('assistant')}</button></div></header>
      <div className="workbench-view" hidden={assistantOpen}>
      {error && <div className="alert alert-error" role="alert"><CircleX size={17} /><span>{error}</span><button className="icon-button tiny" onClick={() => setError('')} aria-label={t('close')}><X size={15} /></button></div>}
      {notice && <div className="alert alert-notice" role="status"><CircleHelp size={17} /><span>{notice}</span><button className="icon-button tiny" onClick={() => setNotice('')} aria-label={t('close')}><X size={15} /></button></div>}
      {saveState === 'error' && current && <div className="alert alert-error" role="alert"><CircleX size={17} /><span>{saveError}</span><button className="button secondary small" onClick={() => act('reload', async () => {
        const next = await api<CaseSpec>(`/api/cases/${savedRef.current!.id}`);
        dirty.current = false; generation.current++; savedRef.current = next; draftRef.current = format(next);
        setDraftText(draftRef.current); setSaveState('saved'); setSaveError(''); setApproved(false); await refresh();
      })}>{t('discardEdits')}</button></div>}
      {loading ? <div className="loading-screen"><LoaderCircle className="spin" size={24} />{t('loading')}</div> : authNeeded ? <div className="auth-screen"><div className="empty-symbol"><LockKeyhole size={28} /></div><h1>{t('authTitle')}</h1><p>{t('authHelp')}</p><label>{t('workspaceToken')}<input type="password" value={tokenInput} onChange={event => setTokenInput(event.target.value)} /></label><button className="button primary" onClick={() => { setToken(tokenInput); setTokenInput(''); void refresh(); }}>{t('unlock')}<ArrowRight size={16} /></button></div> : !current ? <section className="welcome">
        <span className="eyebrow"><span className="status-dot" /> REPRODUCIBLE BY DESIGN</span><h1>{t('emptyTitle')}</h1><p className="welcome-copy">{t('emptyBody')}</p>
        <div className="welcome-actions"><button data-testid="quick-proof" className="button primary large" onClick={() => { setQuickProofSeed(''); setModal('quickproof'); }}><Zap size={17} />{lang === 'tr' ? 'Hızlı kanıt' : 'Quick proof'}</button><button className="button secondary large" onClick={() => setModal('create')}><Plus size={17} />{lang === 'tr' ? 'Gelişmiş vaka' : 'Advanced case'}</button><button data-testid="load-demo" className="button secondary large" onClick={loadDemo} disabled={isBusy}>{busy === 'demo' ? <LoaderCircle className="spin" size={17} /> : <FlaskConical size={18} />}{t('loadDemo')}</button><button className="button secondary large" onClick={openRecon}><Radio size={17} />{lang === 'tr' ? 'Bug Bounty Merkezi' : 'Bug Bounty Center'}</button><button className="button secondary large" onClick={() => setModal('import')}><ArrowUpFromLine size={17} />{t('importCase')}</button></div><p className="demo-note"><LockKeyhole size={12} />{t('demoNote')}</p>
        <div className="welcome-flow">{[[UserRound, 'step1', 'step1Body'], [Network, 'step2', 'step2Body'], [ShieldCheck, 'step3', 'step3Body']].map(([Icon, title, body], index) => { const Component = Icon as typeof UserRound; return <div className="welcome-flow-card" key={index}><span className="flow-number">0{index + 1}</span><Component size={22} /><h3>{t(title as Word)}</h3><p>{t(body as Word)}</p></div>; })}</div>
        <div className="welcome-caption"><div className="tiny-chain"><Circle size={8} /><span /><Circle size={8} /><span /><CircleCheck size={12} /></div><span>{t('subtitle')}</span></div>
      </section> : <>
        <section className="case-heading"><div><div className="eyebrow"><span className="case-dot" />{lang === 'tr' ? 'YETKİLENDİRME ARAŞTIRMASI' : 'AUTHORIZATION INVESTIGATION'}<span className="slash">/</span><span className="mono">{current.id}</span></div><h1>{current.title}</h1><p>{current.description || t('subtitle')}</p></div><button className="button secondary" onClick={openExport} disabled={isBusy || !!activeRun || dirty.current}><ArrowDownToLine size={16} />{t('export')}</button></section>
        <div className="case-tabs"><div>{(['overview', 'specification', 'timeline'] as const).map(item => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item === 'overview' ? <Waypoints size={15} /> : item === 'specification' ? <Braces size={15} /> : <Radio size={15} />}{t(item)}{item === 'timeline' && !!runs.length && <span className="count">{runs.length}</span>}</button>)}<button className={tab==='help'?'active':''} onClick={()=>setTab('help')}><CircleHelp size={15}/>{lang==='tr'?'Kullanım kılavuzu':'User guide'}</button></div><span className={`save-status ${saveState}`} title={saveError}>{saveState === 'saving' ? <LoaderCircle className="spin" size={13} /> : saveState === 'saved' ? <CheckCheck size={14} /> : <CircleX size={14} />}{saveState === 'saving' ? t('saving') : saveState === 'saved' ? `${t('saved')} · r${savedRef.current?.revision ?? current.revision}` : t('errors')}</span></div>
        <div className={`workspace-content ${assistantOpen ? 'with-assistant' : ''}`}>
          <div className="primary-content">
            <section className="target-strip"><div className="target-label"><Globe2 size={16} /><span>{t('target')}</span></div>{current.origins.map(origin => <label className="target-input" key={origin.id}><span>{origin.id}</span><input aria-label={`${t('origin')} ${origin.id}`} value={targets[origin.id] ?? ''} placeholder="https://api.example.com" onChange={event => { setTargets(old => ({ ...old, [origin.id]: event.target.value })); setApproved(false); }} disabled={!!activeRun} /></label>)}<div className="target-end">{state.demo && <span className="demo-badge"><FlaskConical size={12} />{t('demo')}</span>}</div></section>
            {state.demo && <section className="demo-controls"><div><FlaskConical size={15} /><span>{t('demoControlHelp')}</span></div><div><button data-testid="fresh-identities" className="button text small" disabled={isBusy || !!activeRun} onClick={() => act('fresh', async () => { await api('/api/demo/bind', { caseId: current.id, fresh: true, authMode: 'cookie' }); await refresh(); setApproved(false); })}><RefreshCw size={14} className={busy === 'fresh' ? 'spin' : ''} />{t('fresh')}</button><button data-testid="secure-toggle" className={`mode-switch ${state.demo.mode}`} disabled={isBusy || !!activeRun} onClick={() => act('mode', async () => { await api('/api/demo/mode', { mode: state.demo!.mode === 'secure' ? 'vulnerable' : 'secure' }); await refresh(); setApproved(false); })}>{state.demo.mode === 'secure' ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}{t(state.demo.mode === 'secure' ? 'secure' : 'vulnerable')}<ChevronDown size={12} /></button></div></section>}
            {tab === 'help' && <HelpGuide lang={lang}/>}
        {tab === 'overview' && <>
              <div className="section-heading"><h2>{t('identities')}<span className="muted-count">{connectedCount}/{current.actors.length}</span></h2><span className="section-caption"><LockKeyhole size={12} />{lang === 'tr' ? 'Ayrı oturumlar' : 'Isolated sessions'}</span></div>
              <div className="actor-grid">{current.actors.map((actor, index) => { const session = actorStates.find(item => item.id === actor.id); return <article className="actor-card" key={actor.id} style={{ '--actor-color': actor.color } as React.CSSProperties}><div className="actor-card-top"><span className="actor-avatar"><UserRound size={20} /><span>{String.fromCharCode(65 + index)}</span></span><div><h3>{actor.label}</h3><span className="mono actor-id">{actor.id}</span></div><span className={`connection-pill ${session?.connected ? 'connected' : ''}`}><span />{session?.connected ? t('connected') : t('notConnected')}</span></div><div className="actor-identity"><div><span>{t('identity')}</span><strong title={readable(session?.identity?.id)}>{readable(session?.identity?.id)}</strong></div><div><span>{t('tenant')}</span><strong>{readable(session?.identity?.tenant)}</strong></div><div><span>{t('role')}</span><strong>{readable(session?.identity?.role ?? actor.expectedRole)}</strong></div></div><div className="actor-card-bottom"><span>{session?.mode === 'browser' ? <Globe2 size={12} /> : <KeyRound size={12} />}{session ? session.mode === 'browser' ? t('browser') : 'API' : t('noIdentity')}</span><button className="button secondary small" onClick={() => openActor(actor)} disabled={!!activeRun}>{session?.connected ? t('manage') : t('connect')}<ArrowRight size={13} /></button></div></article>; })}</div>
              <div className="investigation-grid"><section className="panel workflow-panel"><div className="panel-heading"><div><h2>{t('workflow')}</h2><p>{t('workflowHint')}</p></div><span className="pill mono">{current.steps.length} {lang === 'tr' ? 'adım' : 'steps'}</span></div><div className="step-list">{current.steps.map((item, index) => { const actor = current.actors.find(value => value.id === item.request.actor); const result = run?.steps.find(value => value.id === item.id); return <button className={`step-item ${step?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelectedStep(item.id)}><div className="step-track"><span className={`step-index ${result?.status ?? ''}`}>{result?.status === 'passed' ? <Check size={12} /> : result?.status === 'failed' ? <X size={12} /> : String(index + 1).padStart(2, '0')}</span>{index !== current.steps.length - 1 && <span className="step-line" />}</div><div className="step-content"><div><strong>{item.label}</strong><span className={`phase-pill ${item.phase}`}>{phaseLabel(item.phase)}</span></div><div className="step-request"><span className={`method ${item.request.method}`}>{item.request.method}</span><code>{item.request.path}</code></div></div><span className="step-actor" style={{ color: actor?.color }} title={actor?.label}><UserRound size={13} />{actor?.id ?? item.request.actor}</span><ChevronRight className="step-chevron" size={14} /></button>; })}</div>{step && <div className="step-editor"><div className="subsection-heading"><h3>{t('workflowEdit')}</h3><button className="button text small" onClick={() => setTab('specification')}><Braces size={13} />JSON</button></div><label>{t('label')}<input value={step.label} onChange={event => changeStep({ label: event.target.value })} /></label><div className="field-row"><label>{t('method')}<select value={step.request.method} onChange={event => changeStep({ request: { method: event.target.value as StepSpec['request']['method'] } })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(method => <option key={method}>{method}</option>)}</select></label><label className="grow">{t('path')}<input className="mono" value={step.request.path} onChange={event => changeStep({ request: { path: event.target.value } })} /></label></div><div className="field-row"><label className="grow">{t('actor')}<select value={step.request.actor} onChange={event => changeStep({ request: { actor: event.target.value } })}>{current.actors.map(actor => <option value={actor.id} key={actor.id}>{actor.label}</option>)}</select></label><label className="grow">{t('phase')}<select value={step.phase} onChange={event => changeStep({ phase: event.target.value as StepSpec['phase'] })}>{['prepare', 'probe', 'verify', 'cleanup'].map(phase => <option value={phase} key={phase}>{phaseLabel(phase)}</option>)}</select></label></div><div className="field-row"><label className="grow">{lang === 'tr' ? 'İçerik Türü' : 'Content Type'}<select value={step.request.contentType ?? 'json'} onChange={event => changeStep({ request: { contentType: event.target.value as StepSpec['request']['contentType'] } })}><option value="json">JSON</option><option value="graphql">GraphQL</option><option value="form">Form URL-Encoded</option><option value="multipart">Multipart Form</option></select></label><label className="grow">{lang === 'tr' ? 'Eşzamanlı İstek (Race)' : 'Concurrency (Race)'}<input type="number" min={1} max={25} value={step.concurrency?.count ?? 1} onChange={event => { const n = Number(event.target.value); changeStep({ concurrency: n >= 2 ? { count: Math.min(25, n), mode: step.concurrency?.mode ?? 'parallel' } : undefined }); }} /></label></div><div className="step-meta"><span><Link2 size={12} />{step.captures.length} {t('captures').toLowerCase()}</span><span><CheckCheck size={12} />{step.checks.length} {t('checks').toLowerCase()}</span></div></div>}</section>
              <div className="context-column"><section className="panel context-panel"><div className="panel-heading"><h2>{t('relationships')}</h2><Network size={16} /></div><div className="relation-graph">{current.resources.length ? current.resources.map(resource => { const owner = current.actors.find(actor => actor.id === resource.ownerActor); return <div className="relation-path" key={resource.id}><div className="relation-node" style={{ '--actor-color': owner?.color } as React.CSSProperties}><span className="relation-node-icon"><UserRound size={17} /></span><div><strong>{owner?.label ?? resource.ownerActor}</strong><span>{t('identity')}</span></div></div><div className="relation-edge"><span /><small>{t('ownedBy')}</small><span /><ChevronDown size={13} /></div><div className="relation-resource"><FileCode2 size={18} /><div><strong>{resource.label || resource.id}</strong><code>{resource.idRef}</code></div></div><div className="relation-foot"><RefreshCw size={11} />{t('createdAtRun')}</div></div>; }) : <div className="empty-context"><Network size={26} /><p>{lang === 'tr' ? 'Kaynak ilişkilerini vaka tanımına ekle.' : 'Add resource relationships in the case specification.'}</p></div>}</div><div className="context-check"><span className="check-icon"><Check size={11} /></span>{t('actorDistinct')}<span className="muted">{current.preconditions.length}</span></div><div className="context-check"><span className="check-icon"><Check size={11} /></span>{t('ownerProof')}<span className="muted">{current.resources.length}</span></div></section><section className="panel policy-panel"><div className="subsection-heading"><h3><ShieldCheck size={15} />{t('policy')}</h3></div><p>{current.policy.statement}</p><label className="checkbox-label"><input type="checkbox" checked={current.policy.acknowledged} onChange={event => editCase({ ...current, policy: { ...current.policy, acknowledged: event.target.checked } })} />{t('policyAck')}</label></section>{run && <section className={`panel latest-summary ${run.state === 'running' ? 'running' : run.verdict}`}><span className="eyebrow">{lang === 'tr' ? 'SON ÇALIŞMA' : 'LATEST RUN'}</span><div><VerdictIcon run={run} /><h3>{run.state === 'running' ? t('running') : t(run.verdict)}</h3></div><p>{run.reason}</p><button className="button text small" onClick={() => setTab('timeline')}>{t('showDetails')}<ArrowRight size={13} /></button></section>}</div></div>
            </>}
            {tab === 'specification' && <section className="panel specification-panel"><div className="panel-heading"><div><h2>{t('json')}</h2><p>{t('jsonHint')}</p></div><button className="button secondary small" onClick={() => { if (current) { editText(format(current)); void persist(); } }}><Braces size={13} />{lang === 'tr' ? 'Biçimlendir' : 'Format'}</button></div><textarea className="code-editor" aria-label={t('json')} spellCheck={false} value={draftText} onChange={event => editText(event.target.value)} />{saveError && <pre className="inline-error">{saveError}</pre>}<div className="validation-block"><div className="subsection-heading"><h3>{t('validation')}</h3><button className="button text small" onClick={() => act('validate', async () => { const result = await api<{ issues: ValidationIssue[] }>(`/api/cases/${current.id}/validate`); setIssues(result.issues); })}><RefreshCw size={13} />{t('validate')}</button></div>{issues.length ? issues.map((issue, index) => <div className={`validation-item ${issue.level}`} key={`${issue.path}-${index}`}><CircleHelp size={14} /><div><code>{issue.path}</code><span>{issue.message}</span></div></div>) : <div className="validation-ok"><CircleCheck size={15} />{t('noIssues')}</div>}</div></section>}
            {tab === 'timeline' && <div className="evidence-layout"><section className="panel evidence-panel">{run ? <><div className={`verdict-banner ${run.state === 'running' ? 'running' : run.verdict}`}><div className="verdict-symbol"><VerdictIcon run={run} /></div><div><span className="eyebrow">{run.state === 'running' ? 'LIVE' : t('reason').toUpperCase()}</span><h2>{run.state === 'running' ? t('running') : t(run.verdict)}</h2><p>{run.reason}</p></div><span className="mono verdict-code">{run.code}</span></div><div className="run-stats"><div><span>{t('requests')}</span><strong>{run.requests}</strong></div><div><span>{t('checks')}</span><strong>{[...run.checks, ...run.steps.flatMap(item => item.checks)].filter(check => check.passed).length}<small> / {[...run.checks, ...run.steps.flatMap(item => item.checks)].length}</small></strong></div><div><span>{t('elapsed')}</span><strong>{((Date.parse(run.finishedAt ?? new Date().toISOString()) - Date.parse(run.startedAt)) / 1000).toFixed(1)}<small>s</small></strong></div><div><span>{t('revision')}</span><strong>r{run.caseRevision}</strong></div></div><div className="run-checks">{run.checks.map((check, index) => <div className={`run-check ${check.passed ? 'passed' : 'failed'}`} key={`${check.id}-${index}`}>{check.passed ? <CircleCheck size={14} /> : <CircleX size={14} />}<span>{check.label}</span>{check.detail && <code>{check.detail}</code>}</div>)}</div><div className="execution-timeline">{run.steps.map((item, index) => <StepEvidence item={item} index={index} key={`${item.id}-${index}`} actors={current.actors} t={t} />)}</div>{run.cleanupErrors.length > 0 && <div className="alert alert-notice"><CircleHelp size={16} />{run.cleanupErrors.join(' · ')}</div>}</> : <div className="empty-evidence"><div className="empty-symbol"><Waypoints size={28} /></div><h2>{t('emptyRun')}</h2><p>{t('emptyRunBody')}</p><span className="mono small-muted">{current.id} · r{current.revision}</span></div>}</section><aside className="panel history-panel"><div className="panel-heading"><h2>{t('historical')}</h2><span className="pill mono">{runs.length}</span></div>{runs.length ? runs.map(item => <button key={item.id} className={`history-item ${run?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedRunId(item.id)}><VerdictIcon run={item} /><span><strong>{item.state === 'running' ? t('running') : t(item.verdict)}</strong><small>{time(item.startedAt)} · r{item.caseRevision}</small></span><ChevronRight size={13} /></button>) : <p className="history-empty">{t('noRuns')}</p>}</aside></div>}
            <div className="review-tools"><button data-testid="preview-plan" className="button secondary small" disabled={isBusy || dirty.current || !!activeRun} onClick={inspectPlan}><Network size={14} />{lang === 'tr' ? 'Çalışma planını incele' : 'Inspect run plan'}</button><button data-testid="compare-runs" className="button secondary small" disabled={runs.filter(r => r.state !== 'running').length < 2} onClick={() => setModal('compare')}><Layers3 size={14} />{lang === 'tr' ? 'Çalışmaları karşılaştır' : 'Compare runs'}</button><button data-testid="role-matrix" className="button secondary small" disabled={isBusy || dirty.current || !!activeRun} onClick={() => setModal('matrix')}><UserRound size={14} />{lang === 'tr' ? 'Rol matrisi' : 'Role matrix'}</button><button data-testid="recon-tools" className="button secondary small" disabled={isBusy} onClick={openRecon}><Radio size={14} />{lang === 'tr' ? 'Bug Bounty Merkezi & Araçlar' : 'Bug Bounty Center & Tools'}</button></div>
            <div className="run-dock"><label className="checkbox-label"><input type="checkbox" checked={approved} disabled={!!activeRun || dirty.current} onChange={event => setApproved(event.target.checked)} /><span>{t('approval')}</span></label>{activeRun ? <button className="button danger" onClick={() => act('cancel', async () => { await api(`/api/runs/${activeRun.id}/cancel`, {}); await refresh(); })}><Square size={14} />{t('cancel')}</button> : <button data-testid="run" className="button primary" onClick={inspectPlan} disabled={!approved || isBusy || dirty.current || !current.policy.acknowledged || current.origins.some(origin => !targets[origin.id])}><Play size={15} fill="currentColor" />{t('run')}<span className="button-shortcut">↵</span></button>}</div>
          </div>
        </div>
      </>}
      </div>
      {assistantOpen && error && <div className="chat-app-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
      {assistantOpen && <AIChat lang={lang} currentCase={current} back={() => setAssistantOpen(false)} settings={() => setModal('settings')} initialPrompt={aiInitialPrompt} onInitialPromptConsumed={() => setAiInitialPrompt('')} propose={(request, profileId, modelId) => { void act('ai', async () => { if (!current) return; await api('/api/providers/activate', { profileId, modelId }); const result = await api<Proposal>('/api/ai/propose', { caseId: current.id, prompt: request || 'Suggest a clearer case description while preserving all relationships.' }); setProposal(result); setModal('proposal'); }); }} />}
    </main>

    {modal === 'quickproof' && <Modal title={lang === 'tr' ? 'Hızlı kanıt' : 'Quick proof'} close={() => setModal(null)} wide><QuickProof lang={lang} initialVulnerable={quickProofSeed} created={async spec => { dirty.current = false; savedRef.current = undefined; setSelectedId(spec.id); setSelectedRunId(''); setApproved(false); setTab('overview'); setModal(null); await refresh(); }} /></Modal>}
    {modal === 'create' && <Modal title={lang === 'tr' ? 'Yeni vaka oluştur' : 'Create a case'} close={() => setModal(null)} wide><CaseWizard lang={lang} origin={state.demo?.origin} created={async spec => { dirty.current = false; savedRef.current = undefined; setSelectedId(spec.id); setSelectedRunId(''); setApproved(false); setTab('overview'); setModal(null); await refresh(); }} /></Modal>}
    {modal === 'plan' && planned && <Modal title={lang === 'tr' ? 'Çalışma ön kontrolü' : 'Run preflight'} close={() => setModal(null)} wide><RunPlanView plan={planned.plan} lang={lang} canRun={approved && planCurrent && !activeRun} busy={isBusy} start={startRun} />{(!approved || !planCurrent) && <p className="plan-approval-hint">{lang === 'tr' ? 'Bu pencereyi kapat, güncel vaka ve hedefleri onayla, ardından planı yeniden aç.' : 'Close this view, approve the current case and targets, then reopen the plan.'}</p>}</Modal>}
    {modal === 'compare' && <Modal title={lang === 'tr' ? 'Çalışmaları karşılaştır' : 'Compare runs'} close={() => setModal(null)} wide><RunCompareView lang={lang} runs={runs.filter(r => r.state !== 'running')} /></Modal>}
    {modal === 'matrix' && current && <Modal title={lang === 'tr' ? 'Çoklu Aktör Rol Matrisi' : 'Multi-Actor Role Matrix'} close={() => setModal(null)} wide><div className="modal-body"><p className="help-text">{lang === 'tr' ? 'Kaynak sahibi dışındaki tüm aktörleri bu vakanın erişim sınırına karşı sırayla test eder.' : 'Evaluates every non-owner actor in this case against the declared resource boundary.'}</p>{matrixResult && matrixResult.caseId === current.id ? <table className="matrix-table"><thead><tr><th>{t('actor')}</th><th>{t('role')}</th><th>{t('tenant')}</th><th>HTTP</th><th>{t('checks')}</th><th>Verdict</th></tr></thead><tbody>{matrixResult.cells.map(cell => <tr key={cell.actorId}><td><strong>{cell.actorLabel}</strong> (<code>{cell.actorId}</code>)</td><td>{readable(cell.role)}</td><td>{readable(cell.tenant)}</td><td className="mono">{cell.probeStatuses.join(', ') || '—'}</td><td>{cell.passedChecks}/{cell.totalChecks}</td><td><strong>{t(cell.verdict)}</strong></td></tr>)}</tbody></table> : <p className="help-text">{lang === 'tr' ? 'Vakayı onaylayıp matris çalıştırmasını başlat.' : 'Approve the case and run the role matrix.'}</p>}</div><div className="modal-footer"><span className="mono small-muted">{current.actors.length} {t('identities').toLowerCase()}</span><button className="button primary" disabled={!approved || isBusy || dirty.current || !current.policy.acknowledged} onClick={runRoleMatrix}><Play size={15} />{lang === 'tr' ? 'Matrisi Çalıştır' : 'Run Matrix'}</button></div></Modal>}
    {modal === 'recon' && <Modal title={lang === 'tr' ? 'Bug Bounty Komuta Merkezi (Tam Kapsamlı Keşif, Araçlar, Scope & CVSS v3.1)' : 'Bug Bounty Command Center (Full-Scope Recon, Tools, Scope & CVSS v3.1)'} close={() => setModal(null)} wide><BountyCenter lang={lang} currentCase={current} defaultOrigin={Object.values(targets).find(Boolean) ?? state.demo?.origin ?? reconOrigin} onCaseDrafted={async (spec, warnings) => { dirty.current = false; savedRef.current = undefined; setSelectedId(spec.id); setNotice(warnings.join(' · ')); setModal(null); setTab('overview'); await refresh(); }} onAskAi={promptText => { setModal(null); setAiInitialPrompt(promptText); setAssistantOpen(true); }} /></Modal>}
    {modal === 'import' && <Modal title={t('import')} close={() => setModal(null)} wide><div className="modal-body"><p className="help-text">{isLeadKind ? t('candidatesHelp') : t('importHelp')}</p><div className="segmented">{(['har', 'http', 'burp', 'postman', 'package', 'arjun', 'ffuf'] as const).map(kind => <button key={kind} className={kind === importKind ? 'active' : ''} onClick={() => { setImportKind(kind); setCandidates(null); }}>{kind === 'har' ? 'HAR' : kind === 'http' ? t('raw') : kind === 'burp' ? 'Burp XML' : kind === 'postman' ? 'Postman' : kind === 'arjun' ? 'Arjun' : kind === 'ffuf' ? 'ffuf' : t('package')}</button>)}</div><label className="file-drop"><ArrowUpFromLine size={22} /><span>{t('file')}</span><span className="mono">.har · .xml · .json · .txt</span><input type="file" accept=".har,.xml,.json,.txt,.http" onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(text => { setImportText(text); if (file.name.endsWith('.reprocase.json')) setImportKind('package'); else if (file.name.endsWith('.har')) setImportKind('har'); else if (file.name.endsWith('.xml')) setImportKind('burp'); else if (file.name.endsWith('.postman_collection.json')) setImportKind('postman'); setCandidates(null); }); }} /></label><label>{t('paste')}<textarea className="code-input" value={importText} placeholder={importKind === 'arjun' ? '{ "https://api.example.com/v1/orders": { "method": "GET", "params": ["order_id"], "headers": {} } }' : importKind === 'ffuf' ? '{ "results": [ { "url": "https://api.example.com/v1/users/1042", "status": 200, "input": { "FUZZ": "1042" } } ] }' : importKind === 'http' ? 'GET /api/documents/123 HTTP/1.1\nHost: api.example.com\n\nHTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id":"123"}' : importKind === 'burp' ? '<items><item><request>...</request><response>...</response></item></items>' : '{ … }'} onChange={event => { setImportText(event.target.value); setCandidates(null); }} spellCheck={false} /></label>{isLeadKind && candidates && <div className="candidate-results"><p className="help-text">{t('candidatesFound').replace('{n}', String(candidates.total))} {candidates.warnings.join(' ')}</p><div className="traffic-list">{candidates.candidates.length === 0 ? <p>{t('noCandidates')}</p> : candidates.candidates.map(c => <div key={c.index} className="traffic-entry candidate-entry"><span className={`candidate-score${c.score >= 3 ? ' strong' : c.score > 0 ? ' some' : ''}`} title={t('candidateScore')}>{c.score}</span><span className="method mono">{c.method}</span><div className="candidate-main"><code>{c.url}</code>{(c.reasons.length > 0 || c.status !== undefined) && <small>{[c.status !== undefined ? `HTTP ${c.status}` : '', ...c.reasons].filter(Boolean).join(' · ')}</small>}</div><button className="button small primary" disabled={isBusy} onClick={() => { setQuickProofSeed(c.raw.split('\r\n\r\n')[0]!.split('\r\n')[0]!); setModal('quickproof'); }}>{lang === 'tr' ? 'Hızlı kanıt' : 'Quick proof'}</button><button className="button small" disabled={isBusy} onClick={() => importData(c.raw, 'http')}>{t('createDraft')}</button></div>)}</div></div>}</div><div className="modal-footer"><span className="security-footnote"><LockKeyhole size={13} />{t('local')}</span><button className="button primary" disabled={!importText.trim() || isBusy} onClick={() => isLeadKind ? findCandidates() : importData()}>{busy === 'import' ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}{isLeadKind ? t('findCandidates') : t('importAction')}</button></div></Modal>}
    {actorModal && modal !== 'traffic' && <Modal title={`${t('connectTitle')} · ${actorModal.label}`} close={() => { setActorModal(null); setLoginData({ username: '', password: '', instructions: '', token: '', cookie: '' }); }}><div className="modal-body"><div className="segmented">{(['browser', 'ai', 'direct'] as const).map(mode => <button key={mode} className={loginMode === mode ? 'active' : ''} onClick={() => setLoginMode(mode)}>{t(mode === 'ai' ? 'aiLogin' : mode)}</button>)}</div><label>{t('origin')}<input value={loginOrigin} onChange={event => setLoginOrigin(event.target.value)} placeholder="https://app.example.com" /></label>{loginMode === 'browser' ? <><p className="help-text">{t('browserHelp')}</p><button className="button secondary full" disabled={isBusy || !loginOrigin} onClick={() => browserAction('open')}><Globe2 size={16} />{t('openBrowser')}</button></> : loginMode === 'ai' ? <><p className="help-text">{t('aiLoginHelp')}</p><div className="field-row"><label className="grow">{t('username')}<input autoComplete="off" value={loginData.username} onChange={event => setLoginData(old => ({ ...old, username: event.target.value }))} /></label><label className="grow">{t('password')}<input type="password" autoComplete="new-password" value={loginData.password} onChange={event => setLoginData(old => ({ ...old, password: event.target.value }))} /></label></div><label>{t('loginInstructions')}<textarea rows={3} value={loginData.instructions} onChange={event => setLoginData(old => ({ ...old, instructions: event.target.value }))} /></label><button className="button primary full" disabled={isBusy || !loginOrigin || !state.ai.configured} onClick={() => browserAction('assist')}><Sparkles size={15} />{t('assistLogin')}</button>{!state.ai.configured && <button className="button text" onClick={() => setModal('settings')}>{t('configureAI')}<ArrowRight size={13} /></button>}</> : <><p className="help-text">{t('directHelp')}</p><label>{t('token')}<input type="password" autoComplete="new-password" value={loginData.token} onChange={event => setLoginData(old => ({ ...old, token: event.target.value }))} /></label><div className="field-or">{lang === 'tr' ? 'veya' : 'or'}</div><label>{t('cookie')}<input type="password" autoComplete="new-password" value={loginData.cookie} onChange={event => setLoginData(old => ({ ...old, cookie: event.target.value }))} /></label><button className="button secondary full" disabled={isBusy || !loginOrigin || (!loginData.token && !loginData.cookie)} onClick={() => browserAction('direct')}><KeyRound size={15} />{t('connectDirect')}</button></>}
      <div className="session-tools"><button className="button secondary" disabled={isBusy || !loginOrigin} onClick={() => browserAction('verify')}><ShieldCheck size={15} />{t('verifyIdentity')}</button>{loginMode !== 'direct' && <button className="icon-button" title={t('snapshot')} aria-label={t('snapshot')} disabled={isBusy} onClick={() => browserAction('snapshot')}><RefreshCw size={16} /></button>}</div>{browserStatus && <pre className="session-output">{browserStatus}</pre>}{loginMode !== 'direct' && <div className="recording-section"><h3>{t('recording')}</h3><p className="help-text">{t('recordingHelp')}</p><div className="field-row"><button className={`button ${recording ? 'danger' : 'secondary'} small`} disabled={isBusy} onClick={() => browserAction('recording')}>{recording ? <Square size={12} /> : <Circle size={12} />}{t(recording ? 'stopRecording' : 'startRecording')}</button><button className="button text small" disabled={isBusy} onClick={() => browserAction('traffic')}>{t('viewTraffic')}<ArrowRight size={13} /></button></div></div>}</div></Modal>}
    {modal === 'traffic' && <Modal title={t('traffic')} close={() => setModal(null)} wide><div className="modal-body"><p className="help-text">{t('recordingHelp')}</p><div className="traffic-list">{traffic.length ? traffic.map((entry, index) => { const request = entry.request as Record<string, unknown> | undefined; return <label className="traffic-entry" key={index}><input type="checkbox" checked={trafficSelection.has(index)} onChange={event => setTrafficSelection(old => { const next = new Set(old); if (event.target.checked) next.add(index); else next.delete(index); return next; })} /><span className="method">{readable(request?.method)}</span><code>{readable(request?.url)}</code></label>; }) : <p>{t('noTraffic')}</p>}</div></div><div className="modal-footer"><span className="mono small-muted">{trafficSelection.size} / {traffic.length}</span><div className="field-row"><button className="button secondary small" disabled={isBusy} onClick={draftAllTraffic}>{lang === 'tr' ? 'Tüm Aktör Trafiğinden Vaka Üret' : 'Draft from all actors'}</button><button className="button primary" disabled={isBusy || !trafficSelection.size} onClick={() => importData(format({ log: { version: '1.2', creator: { name: 'ReproCase', version: state.version }, entries: traffic.filter((_, i) => trafficSelection.has(i)) } }), 'har')}><ArrowRight size={15} />{t('importTraffic')}</button></div></div></Modal>}
    {modal === 'export' && pack && <Modal title={t('exportTitle')} close={() => setModal(null)} wide><div className="modal-body"><p className="help-text">{t('exportHelp')}</p><div className="export-summary"><span><FileJson2 size={16} />{pack.case.id}.reprocase.json</span><span className="pill">schema v{pack.schemaVersion}</span></div>{pack.redactions.length > 0 && <div className="redaction-info"><ShieldCheck size={15} />{pack.redactions.join(' · ')}</div>}<pre className="package-preview">{format(pack)}</pre><label className="checkbox-label"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />{t('reviewed')}</label></div><div className="modal-footer"><div className="field-row"><button className="button text small" disabled={!reviewed || isBusy} onClick={() => reportDownload('markdown')}>{t('downloadMarkdown')}</button><button className="button text small" disabled={!reviewed || isBusy} onClick={() => reportDownload('html')}>{t('downloadHTML')}</button><button className="button text small" disabled={!reviewed || isBusy} onClick={() => reportDownload('bounty')}>{lang === 'tr' ? 'Bounty Raporu' : 'Bounty Report'}</button><button className="button text small" disabled={!reviewed || isBusy} onClick={() => reportDownload('hurl')}>{lang==='tr'?'Hurl istek taslağı':'Hurl request draft'} (.hurl)</button><button className="button text small" disabled={!reviewed || isBusy} onClick={() => reportDownload('playwright')}>Playwright (.spec.ts)</button></div><button className="button primary" disabled={!reviewed} onClick={() => download(`${pack.case.id}.reprocase.json`, format(pack))}><ArrowDownToLine size={15} />{t('downloadPackage')}</button></div></Modal>}
    {modal === 'settings' && <Modal title={t('aiSettings')} close={() => setModal(null)}><ProvidersSettings lang={lang} done={async () => { setModal(null); await refresh(); }} /></Modal>}
    {modal === 'proposal' && proposal && <Modal title={t('proposal')} close={() => setModal(null)} wide><div className="modal-body"><p className="help-text">{proposal.explanation}</p>{proposal.warnings?.map((warning, index) => <div className="redaction-info" key={index}><CircleHelp size={15} />{warning}</div>)}<pre className="package-preview">{format(proposal.case)}</pre></div><div className="modal-footer"><span className="mono small-muted">r{proposal.baseRevision}</span><button className="button primary" disabled={isBusy || proposal.baseRevision !== current?.revision} onClick={() => act('apply', async () => { if (!current) return; const result = await api<CaseSpec>(`/api/cases/${current.id}`, { case: proposal.case, expectedRevision: proposal.baseRevision }, 'PUT'); dirty.current = false; savedRef.current = undefined; setModal(null); setTab('specification'); setAssistantOpen(false); await refresh(); setSelectedId(result.id); })}><Check size={15} />{t('applyProposal')}</button></div></Modal>}
    {isBusy && <div className="activity-indicator" role="status"><LoaderCircle className="spin" size={14} /><span>{busy === 'ai' ? t('propose') : busy === 'demo' ? t('loadDemo') : lang === 'tr' ? 'İşleniyor…' : 'Working…'}</span></div>}
  </div>;
}

function safeParse(text: string) { try { return JSON.parse(text); } catch { return undefined; } }
function VerdictIcon({ run }: { run: RunResult }) { return run.state === 'running' ? <LoaderCircle className="spin" size={19} /> : run.verdict === 'reproduced' ? <CircleCheck size={19} /> : run.verdict === 'not_reproduced' ? <ShieldCheck size={19} /> : <CircleHelp size={19} />; }
function StepEvidence({ item, actors, index, t }: { item: StepResult; actors: ActorSpec[]; index: number; t(key: Word): string }) {
  const [expanded, setExpanded] = useState(item.status === 'failed');
  const actor = actors.find(value => value.id === item.actor);
  return <article className={`execution-step ${item.status}`}><button className="execution-step-head" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span className="execution-index">{item.status === 'passed' ? <Check size={14} /> : item.status === 'failed' ? <X size={14} /> : item.status === 'running' ? <LoaderCircle className="spin" size={14} /> : String(index + 1).padStart(2, '0')}</span><div><strong>{item.label}</strong><span className="mono">{item.request?.method} {shortPath(item.request?.url)}</span></div><span className="execution-actor" style={{ color: actor?.color }}>{actor?.label ?? item.actor}</span>{item.response && <span className={`http-status ${item.response.status >= 400 ? 'denied' : ''}`}>{item.response.status}</span>}<time>{time(item.startedAt)}</time>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{item.checks.length > 0 && <div className="step-checks">{item.checks.map((check, i) => <span className={check.passed ? 'passed' : 'failed'} key={`${check.id}-${i}`}>{check.passed ? <CircleCheck size={12} /> : <CircleX size={12} />}{check.label}</span>)}</div>}{item.error && <div className="execution-error">{item.error}</div>}{expanded && <div className="evidence-comparison"><div><div className="code-pane-heading">{t('request')}<span className="mono">{item.request?.method}</span></div><pre>{item.request ? format(item.request) : '—'}</pre></div><div><div className="code-pane-heading">{t('observed')}<span className="mono">{item.response?.status}</span></div><pre>{item.response ? format(item.response) : t('noResponse')}</pre></div></div>}</article>;
}
