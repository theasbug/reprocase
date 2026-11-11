import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, Bot, Braces, Check, CircleCheck, CircleHelp, CircleX,
  FileCode2, Globe2, KeyRound, LoaderCircle, Plus, Radio, ShieldAlert,
  ShieldCheck, Sparkles, Terminal, Trash2,
} from 'lucide-react';
import type {
  BountyFinding,
  BountyProgram,
  CaseSpec,
  CvssMetrics,
  CvssResult,
  DiscoveredAsset,
  JsBundleAnalysisResult,
  JwtAnalysisResult,
  ReconEndpoint,
  ScopeCheckResult,
  SecurityAuditPackResult,
  TrafficAuditResult,
} from '@reprocase/core';
import { calculateCvss31 } from '../../../packages/core/src/bounty.ts';
import type { Lang } from './i18n.ts';
import { api, download } from './api.ts';

interface ToolchainState {
  builtInModules: Array<{ id: string; name: string; ready: boolean }>;
  externalTools: Array<{ name: string; category: string; installed: boolean; path?: string; installHint: string }>;
}

export function BountyCenter({
  lang,
  currentCase,
  defaultOrigin,
  onCaseDrafted,
  onAskAi,
}: {
  lang: Lang;
  currentCase?: CaseSpec;
  defaultOrigin?: string;
  onCaseDrafted: (spec: CaseSpec, warnings: string[]) => void;
  onAskAi: (prompt: string) => void;
}) {
  const tr = lang === 'tr';
  const [section, setSection] = useState<'scope' | 'recon' | 'toolkit' | 'findings'>('recon');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Programs & Scope state
  const [programs, setPrograms] = useState<BountyProgram[]>([]);
  const [findings, setFindings] = useState<BountyFinding[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [progRate,setProgRate]=useState(10),[progHeaders,setProgHeaders]=useState('');
  const [progName, setProgName] = useState('');
  const [progPlatform, setProgPlatform] = useState<BountyProgram['platform']>('hackerone');
  const [progInScope, setProgInScope] = useState('');
  const [progOutScope, setProgOutScope] = useState('');
  const [scopeTarget, setScopeTarget] = useState(defaultOrigin || 'https://api.example.com/v1/users');
  const [scopeResult, setScopeResult] = useState<ScopeCheckResult | null>(null);

  // Recon & Attack Surface state
  const [domainInput, setDomainInput] = useState('');
  const [assets, setAssets] = useState<DiscoveredAsset[]>([]);
  const [originInput, setOriginInput] = useState(defaultOrigin || '');
  const [auditPack, setAuditPack] = useState<SecurityAuditPackResult | null>(null);
  const [jsInput, setJsInput] = useState('');
  const [jsResult, setJsResult] = useState<JsBundleAnalysisResult | null>(null);
  const [candidates, setCandidates] = useState<ReconEndpoint[]>([]);

  // Built-in Toolkit state
  const [jwtInput, setJwtInput] = useState('');
  const [jwtResult, setJwtResult] = useState<JwtAnalysisResult | null>(null);
  const [trafficInput, setTrafficInput] = useState('');
  const [trafficResult, setTrafficResult] = useState<TrafficAuditResult | null>(null);
  const [toolchain, setToolchain] = useState<ToolchainState | null>(null);

  // CVSS v3.1 & Findings state
  const [cvssMetrics, setCvssMetrics] = useState<CvssMetrics>({ AV: 'N', AC: 'L', PR: 'L', UI: 'N', S: 'U', C: 'H', I: 'L', A: 'N' });
  const cvss: CvssResult = calculateCvss31(cvssMetrics);
  const [findTitle, setFindTitle] = useState('');
  const [findCategory, setFindCategory] = useState('idor_bola');
  const [findCwe, setFindCwe] = useState('CWE-639: Authorization Bypass Through User-Controlled Key');
  const [findEndpoint, setFindEndpoint] = useState('');
  const [findSummary, setFindSummary] = useState('');
  const [findImpact, setFindImpact] = useState('');

  const loadState = async () => {
    const s = await api<{ programs: BountyProgram[]; findings: BountyFinding[] }>('/api/bounty/state');
    setPrograms(s.programs);
    setFindings(s.findings);
    if (!selectedProgramId && s.programs[0]) setSelectedProgramId(s.programs[0].id);
  };

  useEffect(() => {
    void loadState().catch(e => setError((e as Error).message));
    void api<ToolchainState>('/api/bounty/toolchain').then(setToolchain).catch(() => {});
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const saveProgram = () =>
    run('save-prog', async () => {
      const saved = await api<BountyProgram>('/api/bounty/programs', {
        maxRps:progRate,...(progHeaders.trim()?{customHeaders:JSON.parse(progHeaders)}:{}),
        name: progName.trim() || 'Target Program',
        platform: progPlatform,
        inScope: progInScope.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        outOfScope: progOutScope.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      });
      setProgName('');setProgHeaders('');
      setSelectedProgramId(saved.id);
      await loadState();
      setNotice(tr ? 'Bug bounty programı ve kapsam kuralları kaydedildi.' : 'Bug bounty program and scope rules saved.');
    });

  const testScope = () =>
    run('scope', async () => {
      const res = await api<ScopeCheckResult>('/api/bounty/scope-check', {
        target: scopeTarget,
        ...(selectedProgramId ? { programId: selectedProgramId } : {}),
      });
      setScopeResult(res);
    });

  const runSubdomainDiscovery = () =>
    run('assets', async () => {
      const res = await api<{ baseDomain: string; assets: DiscoveredAsset[] }>('/api/bounty/assets', {
        domain: domainInput,
        ...(selectedProgramId ? { programId: selectedProgramId } : {}),
      });
      setAssets(res.assets);
    });

  const runOriginAudit = (target = originInput) =>
    run('audit-pack', async () => {
      const res = await api<SecurityAuditPackResult>('/api/bounty/security-pack', {
        origin: target,
        ...(selectedProgramId ? { programId: selectedProgramId } : {}),
      });
      setAuditPack(res);
      setCandidates(res.endpoints);
    });

  const runJsAnalysis = () =>
    run('js', async () => {
      const res = await api<JsBundleAnalysisResult>('/api/bounty/js-audit', { jsSource: jsInput });
      setJsResult(res);
      setCandidates(res.endpoints);
    });

  const draftCase = (endpoint: ReconEndpoint) =>
    run('draft', async () => {
      const res = await api<{ case: CaseSpec; warnings: string[] }>('/api/recon/draft-case', {
        endpoint,
        ...(originInput.trim() ? { targetOrigin: originInput.trim() } : {}),
      });
      onCaseDrafted(res.case, res.warnings ?? []);
    });

  const runJwtAnalyze = () =>
    run('jwt', async () => {
      const res = await api<JwtAnalysisResult>('/api/bounty/jwt-analyze', { token: jwtInput });
      setJwtResult(res);
    });

  const runTrafficAudit = (useLiveCase = false) =>
    run('traffic', async () => {
      const res = await api<TrafficAuditResult>('/api/bounty/traffic-audit', {
        ...(useLiveCase && currentCase ? { caseId: currentCase.id } : { trafficText: trafficInput }),
      });
      setTrafficResult(res);
      if (res.endpoints.length) setCandidates(res.endpoints);
    });

  const saveFinding = () =>
    run('finding', async () => {
      await api<BountyFinding>('/api/bounty/findings', {
        programId: selectedProgramId || undefined,
        title: findTitle.trim(),
        category: findCategory,
        cvssVector: cvss.vector,
        cwe: findCwe,
        endpoint: findEndpoint,
        caseId: currentCase?.id,
        summary: findSummary,
        impact: findImpact,
        status: 'triaging',
      });
      setFindTitle('');
      setFindSummary('');
      await loadState();
      setNotice(tr ? 'Bulgu CVSS v3.1 puanıyla kaydedildi.' : 'Finding saved with CVSS v3.1 score.');
    });

  const exportFinding = (f: BountyFinding) =>
    run('export-finding', async () => {
      const md = await api<string>(`/api/bounty/findings/${f.id}/export`);
      download(`${f.id}.bounty.md`, md, 'text/markdown');
    });

  return (
    <div className="modal-body agent-settings">{busy&&<button className="button secondary small" onClick={()=>void api('/api/scans/cancel',{}).catch(e=>setError(e.message))}>{tr?'Ağ taramalarını durdur':'Stop network scans'}</button>}
      {error && (
        <div className="alert alert-error" role="alert">
          <CircleX size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-notice" role="status">
          <CircleCheck size={16} />
          <span>{notice}</span>
        </div>
      )}

      <div className="segmented">
        <button className={section === 'recon' ? 'active' : ''} onClick={() => setSection('recon')}>
          <Radio size={14} /> {tr ? '1. Keşif & Saldırı Yüzeyi' : '1. Recon & Attack Surface'}
        </button>
        <button className={section === 'toolkit' ? 'active' : ''} onClick={() => setSection('toolkit')}>
          <Terminal size={14} /> {tr ? '2. Dahili Güvenlik Araçları' : '2. Built-in Security Toolkit'}
        </button>
        <button className={section === 'scope' ? 'active' : ''} onClick={() => setSection('scope')}>
          <ShieldCheck size={14} /> {tr ? '3. Program & Kapsam (Scope)' : '3. Program & Scope'} ({programs.length})
        </button>
        <button className={section === 'findings' ? 'active' : ''} onClick={() => setSection('findings')}>
          <ShieldAlert size={14} /> {tr ? '4. CVSS v3.1 & Bulgular' : '4. CVSS v3.1 & Findings'} ({findings.length})
        </button>
      </div>

      {section === 'recon' && (
        <>
          <div className="agent-button-row">
            <button
              className="button primary small"
              onClick={() =>
                onAskAi(
                  tr
                    ? `Hedef ${originInput || domainInput || 'uygulama'} için tam kapsamlı bug bounty keşfi başlat: önce bounty_security_pack ve recon_probe_origin çalıştır, güvenlik başlıkları/CORS/GraphQL durumunu incele, en yüksek riskli IDOR/BOLA/BFLA/Race adaylarını sırala ve bir vaka taslağı oluştur.`
                    : `Run a full-scope bug bounty recon on ${originInput || domainInput || 'the target'}: execute bounty_security_pack and recon_probe_origin, inspect headers/CORS/GraphQL, rank top IDOR/BOLA/BFLA/Race candidates, and draft a reproducible case.`,
                )
              }
            >
              <Sparkles size={14} /> {tr ? '🤖 AI Co-Pilot ile Tam Keşif Başlat' : '🤖 Launch AI Co-Pilot Full Recon'}
            </button>
          </div>

          <h3>
            <Globe2 size={16} /> {tr ? 'A. Aktif Hedef Güvenlik Denetim Paketi (Origin Audit Pack)' : 'A. Active Origin Security Audit Pack'}
          </h3>
          <p className="help-text">
            {tr
              ? 'Hedef origin üzerinde CORS (null ve keyfi origin yansıması), HTTP metotları (OPTIONS), GraphQL Introspection, OpenAPI/Swagger, robots.txt ve güvenlik başlıklarını tek seferde denetler.'
              : 'Audits target origin for CORS reflection (null & arbitrary), HTTP verb enumeration, GraphQL introspection, OpenAPI/Swagger, robots.txt, and security headers.'}
          </p>
          <div className="field-row">
            <label className="grow">
              {tr ? 'Hedef Origin URL' : 'Target Origin URL'}
              <input value={originInput} onChange={e => setOriginInput(e.target.value)} placeholder="https://api.example.com" />
            </label>
            <button className="button primary" disabled={!!busy || !originInput.trim()} onClick={() => void runOriginAudit()}>
              {busy === 'audit-pack' ? <LoaderCircle size={15} className="spin" /> : <Radio size={15} />}
              {tr ? 'Güvenlik Paketini Çalıştır' : 'Run Security Audit Pack'}
            </button>
          </div>

          {auditPack && (
            <div className="validation-block">
              <h4>
                {auditPack.origin} · {auditPack.findings.length} {tr ? 'Güvenlik Bulgusu' : 'Security Findings'}
              </h4>
              {auditPack.state==='inconclusive'&&<div className="alert alert-notice">{tr?'Sonuç belirsiz: bazı istekler engellendi veya tamamlanamadı. Sıfır bulgu temiz tarama anlamına gelmez.':'Inconclusive: some requests were blocked or failed. Zero findings does not establish a clean scan.'}<details><summary>{tr?'Ayrıntılar':'Details'}</summary><pre>{JSON.stringify(auditPack.errors,null,2)}</pre></details></div>}{auditPack.technologies.length > 0 && <p className="mono small-muted">{auditPack.technologies.join(' · ')}</p>}
              {auditPack.findings.map(f => (
                <div className={`validation-item ${f.severity === 'high' ? 'error' : 'warning'}`} key={f.id}>
                  <CircleHelp size={14} />
                  <div>
                    <strong>[{f.severity.toUpperCase()}] {f.title}</strong> <code>{f.evidence}</code>
                    <div><small>{f.remediation}</small></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3>
            <Globe2 size={16} /> {tr ? 'B. Subdomain & Canlı Varlık Keşfi (crt.sh + Scope Filter)' : 'B. Subdomain & Live Asset Discovery'}
          </h3>
          <div className="field-row">
            <label className="grow">
              {tr ? 'Kök Domain' : 'Root Domain'}
              <input value={domainInput} onChange={e => setDomainInput(e.target.value)} placeholder="example.com" />
            </label>
            <button className="button secondary" disabled={!!busy || !domainInput.trim()} onClick={runSubdomainDiscovery}>
              {busy === 'assets' ? <LoaderCircle size={15} className="spin" /> : <Globe2 size={15} />}
              {tr ? 'Alt Alan Adlarını Keşfet' : 'Discover Subdomains'}
            </button>
          </div>
          {assets.length > 0 && (
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>Scope</th>
                  <th>{tr ? 'Canlı Origin / HTTP' : 'Live Origin / HTTP'}</th>
                  <th>{tr ? 'İşlem' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.hostname}>
                    <td className="mono">{a.hostname}</td>
                    <td>{a.inScope ? <span className="passed">In-Scope</span> : <span className="failed">Out-of-Scope</span>}</td>
                    <td className="mono">{a.liveOrigin ? `${a.liveOrigin} (${a.status ?? 'OK'})` : '—'}</td>
                    <td>
                      {a.liveOrigin && (
                        <button className="button secondary small" onClick={() => { setOriginInput(a.liveOrigin!); void runOriginAudit(a.liveOrigin!); }}>
                          {tr ? 'Denetle' : 'Audit'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>
            <FileCode2 size={16} /> {tr ? 'C. JS Bundle, Source Map, GraphQL ve Trafik Analizörü' : 'C. JS Bundle, Source Map, GraphQL & Traffic Analyzer'}
          </h3>
          <label>
            {tr ? 'JS Kodu / OpenAPI JSON / HAR / Ham HTTP Yapıştır' : 'Paste JS Bundle / OpenAPI JSON / HAR / Raw HTTP'}
            <textarea
              className="code-input"
              rows={4}
              value={jsInput}
              onChange={e => setJsInput(e.target.value)}
              placeholder="axios.get('/api/v1/documents/{id}'); query GetOrgUsers { users { id role } } ..."
              spellCheck={false}
            />
          </label>
          <div className="agent-button-row">
            <button className="button secondary small" disabled={!!busy || !jsInput.trim()} onClick={runJsAnalysis}>
              <Braces size={14} /> {tr ? 'JS / GraphQL / Endpoint Analiz Et' : 'Analyze JS / GraphQL / Endpoints'}
            </button>
            {jsInput.trim() && (
              <button
                className="button text small"
                onClick={() =>
                  onAskAi(
                    tr
                      ? `Şu kodu bounty_js_audit ile incele ve bulduğun en kritik yetkilendirme açığı adayından vaka oluştur:\n\`\`\`\n${jsInput.slice(0, 4000)}\n\`\`\``
                      : `Analyze this source with bounty_js_audit and draft a case from the top authorization vulnerability candidate:\n\`\`\`\n${jsInput.slice(0, 4000)}\n\`\`\``,
                  )
                }
              >
                <Bot size={14} /> {tr ? 'AI ile İncele' : 'Analyze with AI'}
              </button>
            )}
          </div>

          {jsResult && (
            <div className="validation-block">
              <p className="mono small-muted">
                GraphQL Ops: {jsResult.graphqlOperations.map(o => `${o.type} ${o.name}`).join(', ') || '0'} · Role Guards: {jsResult.clientRoleChecks.join(', ') || '0'} · SourceMaps: {jsResult.sourceMaps.join(', ') || '0'}
              </p>
              {jsResult.findings.map(f => (
                <div className="validation-item warning" key={f.id}>
                  <CircleHelp size={14} />
                  <div>
                    <strong>[{f.severity.toUpperCase()}] {f.title}</strong> <code>{f.evidence}</code>
                  </div>
                </div>
              ))}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="validation-block">
              <h4>
                {tr ? 'Sıralı Açık Adayları (IDOR / BOLA / BFLA / Race / SSRF)' : 'Ranked Vulnerability Candidates'} ({candidates.length})
              </h4>
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path & Params</th>
                    <th>Risk</th>
                    <th>{tr ? 'Kategoriler & Gerekçe' : 'Categories & Rationale'}</th>
                    <th>{tr ? 'İşlem' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 40).map(ep => (
                    <tr key={ep.id}>
                      <td className="mono">{ep.method}</td>
                      <td>
                        <code>{ep.path}</code>
                        {ep.parameters.length > 0 && <div><small className="mono">params: {ep.parameters.join(', ')}</small></div>}
                      </td>
                      <td><strong>{ep.risk.toUpperCase()}</strong></td>
                      <td>
                        <code>{ep.categories.join(', ')}</code>
                        <div><small>{ep.rationale}</small></div>
                      </td>
                      <td>
                        <button className="button secondary small" disabled={!!busy} onClick={() => void draftCase(ep)}>
                          <Plus size={13} /> {tr ? 'Vaka Oluştur' : 'Draft Case'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {section === 'toolkit' && (
        <>
          <h3>
            <KeyRound size={16} /> {tr ? '1. JWT & Oturum Token Güvenlik Analizörü' : '1. JWT & Session Token Security Analyzer'}
          </h3>
          <p className="help-text">
            {tr
              ? 'JWT tokenlarını çözer; alg:none, kid/jku enjeksiyonu, eksik exp, hassas veri sızıntısı kontrollerini yapar ve ReproCase aktör JSON pointerlarını otomatik çıkarır.'
              : 'Decodes JWT header/payload, checks for alg:none, kid/jku injection, missing exp, sensitive claim leaks, and infers ReproCase actor JSON pointers.'}
          </p>
          <div className="field-row">
            <label className="grow">
              JWT / Bearer Token
              <input value={jwtInput} onChange={e => setJwtInput(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
            </label>
            <button className="button primary" disabled={!!busy || !jwtInput.trim()} onClick={runJwtAnalyze}>
              {tr ? 'Tokenı Denetle' : 'Analyze Token'}
            </button>
          </div>
          {jwtResult && (
            <div className="validation-block">
              <p className="mono small-muted">
                Suggested Pointers: id=<code>{jwtResult.suggestedPointers.idPointer}</code>
                {jwtResult.suggestedPointers.tenantPointer && <> · tenant=<code>{jwtResult.suggestedPointers.tenantPointer}</code></>}
                {jwtResult.suggestedPointers.rolePointer && <> · role=<code>{jwtResult.suggestedPointers.rolePointer}</code></>}
              </p>
              {jwtResult.findings.map(f => (
                <div className={`validation-item ${f.severity === 'high' ? 'error' : 'warning'}`} key={f.id}>
                  <CircleHelp size={14} />
                  <div>
                    <strong>[{f.severity.toUpperCase()}] {f.title}</strong> <code>{f.evidence}</code>
                    <div><small>{f.remediation}</small></div>
                  </div>
                </div>
              ))}
              {jwtResult.payload && <pre className="session-output">{JSON.stringify({ header: jwtResult.header, payload: jwtResult.payload }, null, 2)}</pre>}
            </div>
          )}

          <h3>
            <ShieldAlert size={16} /> {tr ? '2. Pasif Trafik, Sır (API Key) ve Çerez (Cookie) Denetçisi' : '2. Passive Traffic, Secret & Cookie Auditor'}
          </h3>
          <div className="agent-button-row">
            {currentCase && (
              <button className="button primary small" disabled={!!busy} onClick={() => void runTrafficAudit(true)}>
                {tr ? `Aktif Vaka Trafiğini Denetle (${currentCase.title})` : `Audit Active Case Traffic (${currentCase.title})`}
              </button>
            )}
          </div>
          <label>
            {tr ? 'Veya HAR / HTTP Yanıt Metni Yapıştır' : 'Or Paste HAR / Raw HTTP Response Text'}
            <textarea
              className="code-input"
              rows={3}
              value={trafficInput}
              onChange={e => setTrafficInput(e.target.value)}
              placeholder="HTTP/1.1 200 OK\nSet-Cookie: session=abc123\n\n{...}"
              spellCheck={false}
            />
          </label>
          <div className="agent-button-row">
            <button className="button secondary small" disabled={!!busy || !trafficInput.trim()} onClick={() => void runTrafficAudit(false)}>
              {tr ? 'Metni Sırlar ve Zafiyetler İçin Tara' : 'Scan Text for Secrets & Flaws'}
            </button>
          </div>
          {trafficResult && (
            <div className="validation-block">
              <p className="mono small-muted">
                {tr ? 'Sızan Sırlar:' : 'Leaked Secrets:'} {trafficResult.leakedSecretsCount} · {tr ? 'Güvensiz Çerezler:' : 'Insecure Cookies:'} {trafficResult.insecureCookiesCount} · Endpoints: {trafficResult.endpoints.length}
              </p>
              {trafficResult.findings.map(f => (
                <div className={`validation-item ${f.severity === 'high' ? 'error' : 'warning'}`} key={f.id}>
                  <CircleHelp size={14} />
                  <div>
                    <strong>[{f.severity.toUpperCase()}] {f.title}</strong> <code>{f.evidence}</code>
                    <div><small>{f.remediation}</small></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3>
            <Terminal size={16} /> {tr ? '3. Kurulu Otomasyon & Güvenlik Araçları (Toolchain)' : '3. Installed Automation & Security Toolchain'}
          </h3>
          {toolchain && (
            <>
              <p className="help-text">
                {tr
                  ? 'ReproCase 6 dahili güvenlik motorunu yerleşik içerir. Ayrıca sisteminizdeki harici CLI araçlarını otomatik algılar ve AI Assistant (Sınırsız Yetki modunda) doğrudan çalıştırabilir.'
                  : 'ReproCase ships with 6 built-in security engines and auto-detects external CLI tools for AI Assistant execution.'}
              </p>
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>{tr ? 'Araç / Motor' : 'Tool / Engine'}</th>
                    <th>{tr ? 'Kategori' : 'Category'}</th>
                    <th>{tr ? 'Durum' : 'Status'}</th>
                    <th>{tr ? 'AI / Kurulum' : 'AI / Setup'}</th>
                  </tr>
                </thead>
                <tbody>
                  {toolchain.builtInModules.map(m => (
                    <tr key={m.id}>
                      <td><strong>{m.name}</strong></td>
                      <td>Built-in Core Engine</td>
                      <td><span className="passed">{tr ? 'Hazır (Dahili)' : 'Ready (Built-in)'}</span></td>
                      <td><code>Active</code></td>
                    </tr>
                  ))}
                  {toolchain.externalTools.map(tItem => (
                    <tr key={tItem.name}>
                      <td className="mono"><strong>{tItem.name}</strong></td>
                      <td>{tItem.category}</td>
                      <td>{tItem.installed ? <span className="passed">{tr ? 'Kurulu' : 'Installed'}</span> : <span className=" small-muted">{tr ? 'Kurulu Değil' : 'Not found'}</span>}</td>
                      <td>
                        {tItem.installed ? (
                          <button
                            className="button secondary small"
                            onClick={() =>
                              onAskAi(
                                tr
                                  ? `Terminal aracını kullanarak ${tItem.name} aracını ${originInput || domainInput || 'hedef'} üzerinde güvenli parametrelerle çalıştır ve çıktısını analiz et.`
                                  : `Use terminal_run to run ${tItem.name} with safe flags against ${originInput || domainInput || 'the target'} and analyze the output.`,
                              )
                            }
                          >
                            <Bot size={12} /> {tr ? 'AI ile Kullan' : 'Run with AI'}
                          </button>
                        ) : (
                          <button
                            className="button text small"
                            onClick={() =>
                              onAskAi(
                                tr
                                  ? `Sistemime ${tItem.name} aracını şu komutla kurmama yardım et: ${tItem.installHint}`
                                  : `Help me install ${tItem.name} on my machine using: ${tItem.installHint}`,
                              )
                            }
                          >
                            <code>{tItem.installHint}</code>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {section === 'scope' && (
        <>
          <h3>
            <ShieldCheck size={16} /> {tr ? 'Kapsam Doğrulayıcı (Scope Enforcer)' : 'Target Scope Checker'}
          </h3>
          <div className="field-row">
            <label className="grow">
              {tr ? 'Program Seç' : 'Select Program'}
              <select value={selectedProgramId} onChange={e => setSelectedProgramId(e.target.value)}>
                <option value="">{tr ? 'Varsayılan / Son Program' : 'Default / Latest Program'}</option>
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.platform})</option>
                ))}
              </select>
            </label>
            <label className="grow">
              {tr ? 'Test Edilecek Hedef URL / Host' : 'Target URL / Host to Verify'}
              <input value={scopeTarget} onChange={e => setScopeTarget(e.target.value)} placeholder="https://api.example.com/v1/users" />
            </label>
            <button className="button secondary" disabled={!!busy || !scopeTarget.trim()} onClick={testScope}>
              <Check size={14} /> {tr ? 'Kapsamı Kontrol Et' : 'Verify Scope'}
            </button>
          </div>
          {scopeResult && (
            <div className={`validation-item ${scopeResult.allowed ? 'info' : 'error'}`}>
              {scopeResult.allowed ? <CircleCheck size={15} /> : <CircleX size={15} />}
              <div>
                <strong>{scopeResult.allowed ? (tr ? 'KAPSAM İÇİ (IN-SCOPE)' : 'IN-SCOPE (AUTHORIZED)') : (tr ? 'KAPSAM DIŞI (OUT-OF-SCOPE)' : 'OUT-OF-SCOPE (BLOCKED)')}</strong>
                <span> · {scopeResult.reason}</span>
              </div>
            </div>
          )}

          <h3>{tr ? 'Yeni Bug Bounty Programı Kaydet' : 'Save Bug Bounty Program'}</h3>
          <div className="agent-form"><label>{tr?'En fazla istek / saniye':'Maximum requests / second'}<input type="number" min={1} max={100} value={progRate} onChange={e=>setProgRate(Number(e.target.value))}/></label><label>{tr?'Oturumluk HTTP başlıkları (JSON, isteğe bağlı)':'Session-only HTTP headers (JSON, optional)'}<textarea value={progHeaders} autoComplete="off" spellCheck={false} onChange={e=>setProgHeaders(e.target.value)} placeholder={'{"X-Api-Key":"..."}'}/><small>{tr?'Değerler modele veya veritabanına yazılmaz. Uygulama kapanınca yeniden girmen gerekir.':'Values stay out of model context and the database. Re-enter them after restarting.'}</small></label>
            <div className="field-row">
              <label className="grow">
                {tr ? 'Program Adı' : 'Program Name'}
                <input value={progName} onChange={e => setProgName(e.target.value)} placeholder="Acme Corp Bug Bounty" />
              </label>
              <label>
                Platform
                <select value={progPlatform} onChange={e => setProgPlatform(e.target.value as BountyProgram['platform'])}>
                  <option value="hackerone">HackerOne</option>
                  <option value="bugcrowd">Bugcrowd</option>
                  <option value="intigriti">Intigriti</option>
                  <option value="yeswehack">YesWeHack</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="grow">
                {tr ? 'Kapsam İçi Varlıklar (Her satıra bir kural, ör. *.example.com)' : 'In-Scope Assets (one per line, e.g. *.example.com)'}
                <textarea rows={3} value={progInScope} onChange={e => setProgInScope(e.target.value)} />
              </label>
              <label className="grow">
                {tr ? 'Kapsam Dışı Varlıklar (Out-of-Scope)' : 'Out-of-Scope Exclusions'}
                <textarea rows={3} value={progOutScope} onChange={e => setProgOutScope(e.target.value)} />
              </label>
            </div>
            <button className="button primary small" disabled={!!busy || !progInScope.trim()} onClick={saveProgram}>
              <Plus size={14} /> {tr ? 'Programı Kaydet' : 'Save Program'}
            </button>
          </div>

          {programs.length > 0 && (
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>{tr ? 'Program' : 'Program'}</th>
                  <th>Platform</th>
                  <th>In-Scope</th>
                  <th>Out-of-Scope</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {programs.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td><code>{p.platform}</code></td>
                    <td className="mono">{p.inScope.join(', ')}</td>
                    <td className="mono">{p.outOfScope.join(', ') || '—'}</td>
                    <td>
                      <button
                        className="icon-button tiny"
                        onClick={() => void api(`/api/bounty/programs/${p.id}`, undefined, 'DELETE').then(loadState)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {section === 'findings' && (
        <>
          <h3>
            <ShieldAlert size={16} /> {tr ? 'CVSS v3.1 Hesaplayıcı ve Bulgu Kaydı' : 'CVSS v3.1 Calculator & Finding Tracker'}
          </h3>
          <div className="validation-block">
            <div className="field-row">
              <strong>
                CVSS v3.1: <code>{cvss.score} ({cvss.severity.toUpperCase()})</code>
              </strong>
              <code className="mono">{cvss.vector}</code>
            </div>
            <div className="field-row">
              {(
                [
                  ['AV', ['N', 'A', 'L', 'P']],
                  ['AC', ['L', 'H']],
                  ['PR', ['N', 'L', 'H']],
                  ['UI', ['N', 'R']],
                  ['S', ['U', 'C']],
                  ['C', ['N', 'L', 'H']],
                  ['I', ['N', 'L', 'H']],
                  ['A', ['N', 'L', 'H']],
                ] as const
              ).map(([metricKey, opts]) => (
                <label key={metricKey}>
                  {metricKey}
                  <select
                    value={cvssMetrics[metricKey]}
                    onChange={e => setCvssMetrics(old => ({ ...old, [metricKey]: e.target.value }))}
                  >
                    {opts.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="agent-form">
            <div className="field-row">
              <label className="grow">
                {tr ? 'Bulgu Başlığı' : 'Finding Title'}
                <input value={findTitle} onChange={e => setFindTitle(e.target.value)} placeholder="Cross-Tenant Document Read (IDOR) on /api/v1/documents/{id}" />
              </label>
              <label>
                {tr ? 'Kategori' : 'Category'}
                <select value={findCategory} onChange={e => setFindCategory(e.target.value)}>
                  <option value="idor_bola">IDOR / BOLA</option>
                  <option value="bfla_privesc">BFLA / Privilege Escalation</option>
                  <option value="race_condition">Race Condition / TOCTOU</option>
                  <option value="cors_misconfig">CORS Misconfiguration</option>
                  <option value="jwt_auth">JWT / Authentication Flaw</option>
                  <option value="secret_leak">Secret / Credential Exposure</option>
                  <option value="ssrf_redirect">SSRF / Open Redirect</option>
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="grow">
                CWE
                <input value={findCwe} onChange={e => setFindCwe(e.target.value)} />
              </label>
              <label className="grow">
                Endpoint
                <input value={findEndpoint} onChange={e => setFindEndpoint(e.target.value)} placeholder="GET /api/v1/documents/{id}" />
              </label>
            </div>
            <label>
              {tr ? 'Teknik Özet & Kanıt' : 'Technical Summary & Evidence'}
              <textarea rows={3} value={findSummary} onChange={e => setFindSummary(e.target.value)} />
            </label>
            <label>
              {tr ? 'Etki (Impact)' : 'Security Impact'}
              <textarea rows={2} value={findImpact} onChange={e => setFindImpact(e.target.value)} />
            </label>
            <button className="button primary small" disabled={!!busy || !findTitle.trim()} onClick={saveFinding}>
              <Plus size={14} /> {tr ? 'Bulguyu Kaydet' : 'Save Finding'}
            </button>
          </div>

          {findings.length > 0 && (
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>{tr ? 'Bulgu' : 'Finding'}</th>
                  <th>CVSS v3.1</th>
                  <th>Status</th>
                  <th>{tr ? 'Rapor' : 'Report'}</th>
                </tr>
              </thead>
              <tbody>
                {findings.map(f => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.title}</strong>
                      <div><small className="mono">{f.cwe} {f.endpoint ? `· ${f.endpoint}` : ''}</small></div>
                    </td>
                    <td>
                      <strong>{f.cvssScore} ({f.severity})</strong>
                      <div><small className="mono">{f.cvssVector}</small></div>
                    </td>
                    <td><code>{f.status}</code></td>
                    <td>
                      <div className="agent-button-row">
                        <button className="button secondary small" onClick={() => void exportFinding(f)}>
                          <ArrowDownToLine size={13} /> Markdown
                        </button>
                        <button
                          className="icon-button tiny"
                          onClick={() => void api(`/api/bounty/findings/${f.id}`, undefined, 'DELETE').then(loadState)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
