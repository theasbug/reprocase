import { ScanNetwork, RequestLimiter } from '@reprocase/core';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { BrowserManager, type DirectConnection, type BrowserAction } from '@reprocase/browser';
import { AIManager } from '@reprocase/ai';
import {
  analyzeJsBundle,
  analyzeJwtToken,
  auditTrafficSecurity,
  bountyFindingSchema,
  bountyProgramSchema,
  buildCase,
  buildCaseFromEndpoint,
  calculateCvss31,
  checkScope,
  compareRuns,
  discoverSubdomains,
  extractEndpointsFromText,
  planRun,
  probeOrigin,
  renderBountyReport,
  renderFindingMarkdown,
  renderHTML,
  renderHurl,
  renderMarkdown,
  renderPlaywright,
  runConfigSchema,
  runSecurityAuditPack,
  targetOrigin,
  validateCase,
  VERSION,
  caseSchema,
  createExampleCase,
  createRedactor,
  executeCase,
  executeMatrix,
  exportPackage,
  importTraffic,
  importMultiActorTraffic,
  newRunResult,
  type AuthoringInput,
  type ActorSpec,
  type AISettings,
  type BountyFinding,
  type BountyProgram,
  type CaseSpec,
  type ImportKind,
  type MatrixResult,
  type ReconEndpoint,
  type ReconReport,
  type RunConfig,
  type RunResult,
} from '@reprocase/core';
import type { PermissionMode } from './permissions.ts';
import { Store } from './store.ts';
import { startDemo, type DemoServer } from './demo.ts';
import { ProviderRegistry, providerCatalog, type SecretVault } from '../../../packages/ai/src/providers.ts';
import { ChatService } from './chats.ts';
import type { ProviderProfile, AgentTool, AgentToolOutput, McpServerState } from '@reprocase/core';
import { Harness } from './harness.ts';
import { McpManager } from './mcp-client.ts';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class ReproService {
  readonly browsers = new BrowserManager();
  readonly ai: AIManager;
  readonly events = new EventEmitter();
  private controllers = new Map<string, AbortController>();
  private activeCases = new Map<string, string>();
  private tasks = new Map<string, Promise<RunResult>>();
  demo?: DemoServer;
  readonly providers: ProviderRegistry;
  readonly chats: ChatService;
  readonly mcp: McpManager;
  readonly harness: Harness;
  private scanControllers=new Set<AbortController>();
  private programHeaders=new Map<string,Record<string,string>>();
  private scanLimiters=new Map<string,RequestLimiter>();
  private extraSecrets: string[] = [];

  constructor(
    readonly store: Store,
    options: {
      vault?: SecretVault;
      providerFetch?: typeof fetch;
      desktop?: boolean;
      dataRoot?: string;
      prompt?: string;
      computer?: {
        tools(): AgentTool[];
        execute(name: string, input: unknown, signal: AbortSignal): Promise<AgentToolOutput>;
        image(id: string): Promise<Buffer>;
      };
    } = {},
  ) {
    this.ai = new AIManager({ fetch: options.providerFetch });
    this.providers = new ProviderRegistry({ vault: options.vault, fetch: options.providerFetch, save: profiles => store.setSetting('providers', profiles) });
    this.mcp = new McpManager({ desktop: !!options.desktop, vault: options.vault, save: records => store.setSetting('mcpServers', records) });
    const dataRoot = options.dataRoot ?? process.cwd(),
      root = store.setting<string>('agent.workspace', join(dataRoot, 'projects'));
    if (options.desktop) mkdirSync(root, { recursive: true });
    const initialPermissionMode = store.setting<PermissionMode>('agent.permissionMode', 'ask');
    this.harness = new Harness({
      desktop: !!options.desktop,
      root,
      dataRoot,
      computer: options.computer,
      saveRoot: path => store.setSetting('agent.workspace', path),
      permissionMode: initialPermissionMode,
      savePermissionMode: mode => store.setSetting('agent.permissionMode', mode),
      secrets: () => this.knownSecrets(),
      mcp: this.mcp,
      caseAction: async (name, input, signal) => {
        if (name === 'reprocase_list') return { cases: store.cases(), runs: store.runs().map(r => ({ id: r.id, caseId: r.caseId, verdict: r.verdict, code: r.code })) };
        if (name === 'recon_probe_origin') return this.probeTarget(String(input.origin),signal);
        if (name === 'recon_extract_endpoints') return { endpoints: this.extractRecon(String(input.sourceText), typeof input.sourceLabel === 'string' ? input.sourceLabel : 'agent') };
        if (name === 'recon_draft_case') {
          return this.draftFromReconEndpoint(
            {
              id: `recon-${randomUUID().slice(0, 8)}`,
              method: input.method ?? 'GET',
              path: String(input.path),
              parameters: [],
              risk: 'high',
              categories: Array.isArray(input.categories) ? input.categories : ['idor_bola'],
              rationale: typeof input.rationale === 'string' ? input.rationale : 'Generated from agent reconnaissance.',
              source: 'agent',
            },
            typeof input.targetOrigin === 'string' ? input.targetOrigin : undefined,
          );
        }
        if (name === 'bounty_program_list') return this.bountyState();
        if (name === 'bounty_program_save') return this.saveProgram(input);
        if (name === 'bounty_scope_check') return this.checkTargetScope(String(input.target), typeof input.programId === 'string' ? input.programId : undefined);
        if (name === 'bounty_asset_discover') return this.discoverAssets(String(input.domain), typeof input.programId === 'string' ? input.programId : undefined,signal);
        if (name === 'bounty_security_pack') return this.runAuditPack(String(input.origin), typeof input.programId === 'string' ? input.programId : undefined,signal);
        if (name === 'bounty_jwt_analyze') return this.analyzeToken(String(input.token));
        if (name === 'bounty_traffic_audit') return this.auditTraffic({ caseId: typeof input.caseId === 'string' ? input.caseId : undefined, trafficText: typeof input.trafficText === 'string' ? input.trafficText : undefined });
        if (name === 'bounty_js_audit') return this.analyzeJs(String(input.jsSource), typeof input.sourceLabel === 'string' ? input.sourceLabel : 'agent-js');
        if (name === 'bounty_finding_save') return this.saveFinding(input);
        if (name === 'bounty_toolchain_status') return this.detectToolchain();

        const id = String(input.caseId),
          spec = this.getCase(id);
        if (name === 'reprocase_validate') return { issues: validateCase(spec) };
        if (name === 'reprocase_plan') return this.plan(id, { targets: input.targets, approvedRevision: spec.revision });
        if (name === 'reprocase_browser_snapshot') {
          const actorId = String(input.actorId);
          this.actor(id, actorId);
          return this.browsers.snapshot(this.key(id, actorId));
        }
        if (name === 'reprocase_browser_action') {
          const actorId = String(input.actorId);
          return this.browserAction(id, actorId, { type: input.type, ref: input.ref, url: input.url, value: input.value });
        }
        if (name === 'reprocase_traffic_draft') return this.draftFromLiveTraffic(id);
        if (name === 'reprocase_matrix') return this.runMatrix(id, { targets: input.targets, approvedRevision: input.approvedRevision }, signal);
        if (name === 'reprocase_run') {
          const run = this.startRun(id, { targets: input.targets, approvedRevision: input.approvedRevision });
          const cancel = () => this.cancelRun(run.id);
          signal.addEventListener('abort', cancel, { once: true });
          try {
            return await this.waitRun(run.id);
          } finally {
            signal.removeEventListener('abort', cancel);
          }
        }
        throw new Error('Unknown case action');
      },
    });
    this.chats = new ChatService(
      store,
      this.providers,
      () => this.knownSecrets(),
      id => this.getCase(id),
      options.providerFetch,
      {
        runtime: this.harness,
        prompt: () =>
          store.setting<string>(
            'agent.prompt',
            options.prompt ?? 'You are ReproCase AI Assistant, a desktop agent for bug bounty and software development. Use the tools provided and report observed results.',
          ),
      },
    );
  }

  knownSecrets() {
    return [...this.extraSecrets, ...this.browsers.knownSecrets(), ...this.providers.knownSecrets(), ...this.mcp.knownSecrets(),...Array.from(this.programHeaders.values()).flatMap(h=>Object.values(h))];
  }
  registerSecret(value: string) {
    this.extraSecrets.push(value);
  }
  async initialize() {
    await this.providers.restore(this.store.setting<ProviderProfile[]>('providers', []));
    await this.mcp.restore(this.store.setting<McpServerState[]>('mcpServers', []));
    for(const p of this.store.programs())if(Object.keys(p.customHeaders).length)this.saveProgram(p);
    this.chats.recover();
  }
  providerState() {
    return { catalog: providerCatalog, profiles: this.providers.list(), rememberKeys: this.providers.rememberingAvailable() };
  }
  activateProvider(id: string, modelId: string) {
    const profile = this.providers.get(id);
    if (!profile.hasKey && profile.providerId !== 'custom') throw new Error('Reconnect this provider with its API key');
    if (!profile.models.some(model => model.id === modelId)) throw new Error('Choose a discovered model');
    this.ai.configure({
      provider: profile.protocol === 'responses' ? 'openai' : profile.protocol === 'anthropic' ? 'anthropic' : 'compatible',
      baseURL: profile.baseURL,
      apiKey: this.providers.key(id),
      model: modelId,
    });
    return this.ai.publicSettings();
  }
  key(caseId: string, actorId: string) {
    return `${caseId}:${actorId}`;
  }
  getCase(id: string) {
    const spec = this.store.getCase(id);
    if (!spec) throw Object.assign(new Error('Case not found'), { statusCode: 404 });
    return spec;
  }
  getRun(id: string) {
    const run = this.store.getRun(id);
    if (!run) throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    return run;
  }
  actor(caseId: string, actorId: string): ActorSpec {
    const spec = this.getCase(caseId);
    const actor = spec.actors.find(a => a.id === actorId);
    if (!actor) throw Object.assign(new Error('Actor not found'), { statusCode: 404 });
    return actor;
  }
  private idle(caseId: string) {
    if (this.activeCases.has(caseId)) throw Object.assign(new Error('This case has an active run. Wait for it or cancel before changing sessions or the case.'), { statusCode: 409 });
  }
  state() {
    const targets = this.store.setting<Record<string, Record<string, string>>>('targets', {});
    return {
      version: VERSION,
      cases: this.store.cases(),
      runs: this.store.runs(),
      targets,
      actors: this.browsers.statuses().map(s => {
        const split = s.id.indexOf(':');
        const caseId = s.id.slice(0, split),
          id = s.id.slice(split + 1);
        return { ...s, id, caseId, label: this.store.getCase(caseId)?.actors.find(a => a.id === id)?.label };
      }),
      demo: this.demo ? { origin: this.demo.origin, mode: this.demo.mode, accounts: this.demo.accounts } : null,
      ai: this.ai.publicSettings(),
    };
  }
  saveCase(input: unknown, expectedRevision?: number) {
    const spec = caseSchema.parse(input);
    this.idle(spec.id);
    return this.store.saveCase(spec, expectedRevision);
  }
  build(input: AuthoringInput, origin?: string) {
    const target = origin ? targetOrigin(origin) : undefined;
    const result = buildCase(input);
    result.case = this.saveCase(result.case);
    if (target) {
      const targets = this.store.setting<Record<string, Record<string, string>>>('targets', {});
      targets[result.case.id] = { api: target };
      this.store.setSetting('targets', targets);
    }
    return result;
  }
  plan(caseId: string, config: RunConfig) {
    const spec = this.getCase(caseId);
    return planRun(
      spec,
      config,
      spec.actors.flatMap(actor => {
        const binding = this.browsers.status(this.key(caseId, actor.id));
        return binding ? [{ actorId: actor.id, origin: binding.origin, mode: binding.mode, connected: binding.connected }] : [];
      }),
    );
  }
  compare(before: string, after: string) {
    return compareRuns(this.getRun(before), this.getRun(after));
  }
  import(kind: ImportKind, data: string) {
    const result = importTraffic(kind, data);
    if (this.store.getCase(result.case.id)) result.case = { ...result.case, id: `${result.case.id.slice(0, 45)}-${randomUUID().slice(0, 8)}`, revision: 1 };
    result.case = this.store.saveCase(result.case);
    return result;
  }
  draftFromLiveTraffic(caseId: string) {
    const spec = this.getCase(caseId);
    const sessions = spec.actors.flatMap(actor => {
      try {
        const har = this.browsers.traffic(this.key(caseId, actor.id));
        return [{ actorId: actor.id, entries: har.log.entries }];
      } catch {
        return [];
      }
    });
    const result = importMultiActorTraffic(sessions);
    result.case = this.store.saveCase(result.case);
    return result;
  }
  async probeTarget(originUrl:string,signal?:AbortSignal):Promise<ReconReport>{return this.scan(signal,s=>probeOrigin(originUrl,fetch,this.knownSecrets(),this.scanOptions(undefined,s)));}
  private async scan<T>(signal:AbortSignal|undefined,fn:(signal:AbortSignal)=>Promise<T>){const ctrl=new AbortController();this.scanControllers.add(ctrl);try{return await fn(signal?AbortSignal.any([signal,ctrl.signal]):ctrl.signal);}finally{this.scanControllers.delete(ctrl);}}
  cancelScans(){for(const c of this.scanControllers)c.abort();return {cancelled:true};}
  extractRecon(sourceText: string, sourceLabel = 'manual'): ReconEndpoint[] {
    return extractEndpointsFromText(sourceText, sourceLabel);
  }
  draftFromReconEndpoint(endpoint: ReconEndpoint, originUrl?: string) {
    const result = buildCaseFromEndpoint(endpoint);
    if (this.store.getCase(result.case.id)) {
      result.case = { ...result.case, id: `${result.case.id.slice(0, 45)}-${randomUUID().slice(0, 8)}`, revision: 1 };
    }
    result.case = this.store.saveCase(result.case);
    if (originUrl) {
      try {
        const cleanOrigin = targetOrigin(originUrl);
        const targets = this.store.setting<Record<string, Record<string, string>>>('targets', {});
        targets[result.case.id] = { api: cleanOrigin };
        this.store.setSetting('targets', targets);
      } catch {
        /* ignore invalid optional origin */
      }
    }
    return result;
  }
  bountyState() {
    return { programs: this.store.programs(), findings: this.store.findings() };
  }
  saveProgram(input: Record<string, unknown>): BountyProgram {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `prog-${randomUUID().slice(0, 8)}`;
    const existing = this.store.getProgram(id);
    const parsed=bountyProgramSchema.parse({...existing,...input,id});
    for(const [name,value]of Object.entries(parsed.customHeaders)){if(/^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*|sec-.*)$/i.test(name)||/[\r\n]/.test(value))throw new Error('Unsupported custom header');new Headers({[name]:value});}
    if(input.customHeaders!==undefined)this.programHeaders.set(id,parsed.customHeaders);
    const hasCustomHeaders=input.customHeaders!==undefined?Object.keys(parsed.customHeaders).length>0:!!existing?.hasCustomHeaders;
    return this.store.saveProgram(
      bountyProgramSchema.parse({
        ...existing,
        ...input,
        id,
        customHeaders:{},hasCustomHeaders,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  deleteProgram(id: string) {
    this.store.deleteProgram(id);this.programHeaders.delete(id);this.scanLimiters.delete(id);
    return { ok: true };
  }
  checkTargetScope(target: string, programId?: string) {
    const program=this.getProgramForScan(programId);
    if (!program) return { target, normalizedHost: target, normalizedUrl: target, allowed: false, reason: 'No program scope configured. Configure a program before checking authorization.' };
    return checkScope(target, program);
  }
  private getProgramForScan(programId?:string){const program=programId!==undefined?this.store.getProgram(programId):this.store.programs()[0];if(programId!==undefined&&!program)throw new Error('Unknown program ID');return program;}
  private scanOptions(programId?:string,signal?:AbortSignal){
    const saved=this.getProgramForScan(programId);if(saved?.hasCustomHeaders&&!this.programHeaders.has(saved.id))throw new Error('Re-enter this program’s session-only custom headers before scanning');
    const key=saved?.id??'ad-hoc';let limiter=this.scanLimiters.get(key);if(!limiter){limiter=new RequestLimiter();this.scanLimiters.set(key,limiter);}
    return {signal,limiter,program:saved?{...saved,customHeaders:this.programHeaders.get(saved.id)??{}}:undefined};
  }
  async discoverAssets(domain:string,programId?:string,signal?:AbortSignal){return this.scan(signal,s=>{const options=this.scanOptions(programId,s);return discoverSubdomains(domain,options.program,fetch,options);});}
  async runAuditPack(originUrl:string,programId?:string,signal?:AbortSignal){return this.scan(signal,s=>{const options=this.scanOptions(programId,s);return runSecurityAuditPack(originUrl,options.program,fetch,this.knownSecrets(),options);});}
  analyzeToken(token: string) {
    return analyzeJwtToken(token);
  }
  auditTraffic(input: { caseId?: string; trafficText?: string }) {
    let source = input.trafficText ?? '';
    if (!source.trim() && input.caseId) {
      const spec = this.getCase(input.caseId);
      const entries = spec.actors.flatMap(actor => {
        try {
          return this.browsers.traffic(this.key(input.caseId!, actor.id)).log.entries;
        } catch {
          return [];
        }
      });
      source = JSON.stringify({ log: { entries } });
    }
    return auditTrafficSecurity(source);
  }
  analyzeJs(jsSource: string, sourceLabel = 'js-bundle') {
    return analyzeJsBundle(jsSource, sourceLabel);
  }
  saveFinding(input: Record<string, unknown>): BountyFinding {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `finding-${randomUUID().slice(0, 8)}`;
    const existing = this.store.getFinding(id);
    const cvssInput = typeof input.cvssVector === 'string' ? input.cvssVector : existing?.cvssVector;
    const cvss = calculateCvss31(cvssInput);
    return this.store.saveFinding(
      bountyFindingSchema.parse({
        ...existing,
        ...input,
        id,
        cvssVector: cvss.vector,
        cvssScore: cvss.score,
        severity: cvss.severity,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  deleteFinding(id: string) {
    this.store.deleteFinding(id);
    return { ok: true };
  }
  exportFindingMarkdown(id: string): string {
    const finding = this.store.getFinding(id);
    if (!finding) throw Object.assign(new Error('Finding not found'), { statusCode: 404 });
    const program = finding.programId ? this.store.getProgram(finding.programId) : this.store.programs()[0];
    return renderFindingMarkdown(finding, program);
  }
  detectToolchain() {
    const catalog = [
      { name: 'nuclei', category: 'Vulnerability Scanner', installHint: 'go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest' },
      { name: 'subfinder', category: 'Subdomain Discovery', installHint: 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest' },
      { name: 'httpx', category: 'HTTP Prober', installHint: 'go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest' },
      { name: 'ffuf', category: 'Web Fuzzer', installHint: 'go install github.com/ffuf/ffuf/v2@latest' },
      { name: 'nmap', category: 'Network & Port Scanner', installHint: 'winget install Insecure.Nmap' },
      { name: 'sqlmap', category: 'SQL Injection Assessment', installHint: 'pip install sqlmap' },
      { name: 'hurl', category: 'HTTP Scenario Runner', installHint: 'winget install Orange.Hurl' },
      { name: 'curl', category: 'HTTP Transfer Client', installHint: 'Pre-installed on Windows / POSIX' },
      { name: 'python', category: 'Scripting Runtime', installHint: 'winget install Python.Python.3.12' },
      { name: 'git', category: 'Source Control & Recon', installHint: 'winget install Git.Git' },
    ];
    const locator = platform() === 'win32' ? 'where.exe' : 'which';
    const externalTools = catalog.map(item => {
      try {
        const res = spawnSync(locator, [item.name], { encoding: 'utf8', timeout: 1500, windowsHide: true });
        const firstPath = res.status === 0 ? res.stdout.split(/\r?\n/).find(Boolean)?.trim() : undefined;
        return { ...item, installed: Boolean(firstPath), path: firstPath };
      } catch {
        return { ...item, installed: false, path: undefined };
      }
    });
    const builtInModules = [
      { id: 'jwt-analyzer', name: 'ReproCase JWT & Session Token Analyzer', ready: true },
      { id: 'traffic-auditor', name: 'ReproCase Passive Traffic, Secret & Cookie Auditor', ready: true },
      { id: 'subdomain-recon', name: 'ReproCase Certificate Transparency (crt.sh) & Scope Asset Finder', ready: true },
      { id: 'js-graphql-analyzer', name: 'ReproCase JS Bundle, Source Map & GraphQL Extractor', ready: true },
      { id: 'security-audit-pack', name: 'ReproCase Active Origin Security Pack (CORS, Verbs, GraphQL, Headers)', ready: true },
      { id: 'cvss-31-engine', name: 'ReproCase CVSS v3.1 Base Score & Bounty Report Engine', ready: true },
    ];
    return { builtInModules, externalTools };
  }
  async openBrowser(caseId: string, actorId: string, origin: string) {
    this.idle(caseId);
    this.actor(caseId, actorId);
    return this.browsers.open(this.key(caseId, actorId), targetOrigin(origin));
  }
  async connectDirect(caseId: string, actorId: string, input: DirectConnection) {
    this.idle(caseId);
    const actor = this.actor(caseId, actorId);
    targetOrigin(input.origin);
    await this.browsers.connectDirect(this.key(caseId, actorId), input);
    try {
      await this.browsers.verify(this.key(caseId, actorId), actor.identity);
    } catch {
      /* Keep an unverified binding available for correction in the UI. */
    }
    return this.browsers.status(this.key(caseId, actorId));
  }
  async verifyActor(caseId: string, actorId: string, targets?: Record<string, string>) {
    this.idle(caseId);
    const actor = this.actor(caseId, actorId),
      status = this.browsers.status(this.key(caseId, actorId));
    if (targets?.[actor.identity.origin] && targetOrigin(targets[actor.identity.origin]) !== status?.origin) throw new Error('The account session is bound to a different target origin');
    return this.browsers.verify(this.key(caseId, actorId), actor.identity);
  }
  async browserAction(caseId: string, actorId: string, action: BrowserAction) {
    this.idle(caseId);
    this.actor(caseId, actorId);
    return this.browsers.action(this.key(caseId, actorId), action);
  }
  async assistLogin(caseId: string, actorId: string, input: { username?: string; password?: string; instructions?: string }) {
    this.idle(caseId);
    const actor = this.actor(caseId, actorId);
    const result = await this.ai.assistLogin(this.browsers, this.key(caseId, actorId), input);
    if (result.state === 'completed') {
      try {
        await this.browsers.verify(this.key(caseId, actorId), actor.identity);
      } catch {
        return { ...result, state: 'needs_user', message: 'The form flow finished, but the account identity could not be verified. Complete sign-in and verify the account.' };
      }
    }
    return result;
  }
  configureAI(settings: AISettings) {
    this.ai.configure(settings);
    return this.ai.publicSettings();
  }
  testAI() {
    return this.ai.testConnection();
  }
  propose(caseId: string, prompt: string) {
    return this.ai.propose(this.getCase(caseId), prompt, this.browsers.knownSecrets());
  }
  startRun(caseId: string, config: RunConfig): RunResult {
    config = runConfigSchema.parse(config);
    this.idle(caseId);
    const spec = this.getCase(caseId);
    if (config.approvedRevision !== spec.revision) throw Object.assign(new Error('Approve the current case revision before running'), { statusCode: 409 });
    const issues = this.plan(caseId, config).issues.filter(i => i.level === 'error');
    if (issues.length) throw Object.assign(new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n')), { statusCode: 422 });
    const targets = Object.fromEntries(spec.origins.map(o => [o.id, targetOrigin(config.targets[o.id] ?? '')]));
    for (const actor of spec.actors) {
      const binding = this.browsers.status(this.key(caseId, actor.id));
      if (!binding) throw Object.assign(new Error(`Connect ${actor.label} before starting`), { statusCode: 422 });
      if (binding.origin !== targets[actor.identity.origin]) throw Object.assign(new Error(`${actor.label} is bound to another origin`), { statusCode: 422 });
    }
    const settings = this.store.setting<Record<string, Record<string, string>>>('targets', {});
    settings[caseId] = targets;
    this.store.setSetting('targets', settings);
    const initial = newRunResult(spec),
      controller = new AbortController();
    this.controllers.set(initial.id, controller);
    this.activeCases.set(caseId, initial.id);
    this.store.saveRun(initial);
    const network=new ScanNetwork(fetch,{...this.scanOptions(undefined,controller.signal),maxRequests:config.maxRequests??100});
    const task = executeCase(
      spec,
      { ...config, targets },
      {
        request: async(actorId,request,signal)=>{await network.authorize(request.url,signal);return this.browsers.request(this.key(caseId,actorId),request,signal);},
        knownSecrets: () => this.browsers.knownSecrets(),
      },
      {
        signal: controller.signal,
        runId: initial.id,
        onEvent: event => {
          this.store.saveRun(event.run);
          this.events.emit('run', event);
        },
      },
    )
      .then(result => {
        this.store.saveRun(result);
        return result;
      })
      .catch(error => {
        const result: RunResult = { ...this.getRun(initial.id), state: 'completed', verdict: 'inconclusive', code: 'internal_error', reason: this.safeError(error), finishedAt: new Date().toISOString() };
        this.store.saveRun(result);
        return result;
      })
      .finally(() => {
        this.controllers.delete(initial.id);
        this.activeCases.delete(caseId);
      });
    this.tasks.set(initial.id, task);
    void task.finally(() => this.tasks.delete(initial.id));
    return initial;
  }
  async waitRun(id: string) {
    return (await this.tasks.get(id)) ?? this.getRun(id);
  }
  cancelRun(id: string) {
    this.getRun(id);
    this.controllers.get(id)?.abort();
    return this.getRun(id);
  }
  async runMatrix(caseId: string, config: RunConfig, signal?: AbortSignal): Promise<MatrixResult> {
    config = runConfigSchema.parse(config);
    this.idle(caseId);
    const spec = this.getCase(caseId);
    if (config.approvedRevision !== spec.revision) throw Object.assign(new Error('Approve the current case revision before running'), { statusCode: 409 });
    const issues = this.plan(caseId, config).issues.filter(i => i.level === 'error');
    if (issues.length) throw Object.assign(new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n')), { statusCode: 422 });
    const targets = Object.fromEntries(spec.origins.map(o => [o.id, targetOrigin(config.targets[o.id] ?? '')]));
    for (const actor of spec.actors) {
      const binding = this.browsers.status(this.key(caseId, actor.id));
      if (!binding) throw Object.assign(new Error(`Connect ${actor.label} before starting`), { statusCode: 422 });
      if (binding.origin !== targets[actor.identity.origin]) throw Object.assign(new Error(`${actor.label} is bound to another origin`), { statusCode: 422 });
    }
    const network=new ScanNetwork(fetch,{...this.scanOptions(undefined,signal),maxRequests:config.maxRequests??10000});
    return executeMatrix(
      spec,
      { ...config, targets },
      {
        request: async(actorId,request,reqSignal)=>{await network.authorize(request.url,reqSignal);return this.browsers.request(this.key(caseId,actorId),request,reqSignal);},
        knownSecrets: () => this.browsers.knownSecrets(),
      },
      { signal, onRun: run => this.store.saveRun(run) },
    );
  }
  package(caseId: string, runId?: string) {
    const run = runId ? this.getRun(runId) : undefined;
    if (run && run.caseId !== caseId) throw new Error('This run belongs to another case');
    const spec = run ? this.store.getCase(caseId, run.caseRevision) : this.getCase(caseId);
    if (!spec) throw new Error('The exact case revision for this run is unavailable');
    return exportPackage(spec, run, this.browsers.knownSecrets());
  }
  report(caseId: string, format: 'html' | 'markdown' | 'bounty' | 'hurl' | 'playwright', runId?: string) {
    const pack = this.package(caseId, runId);
    const savedTargets = this.store.setting<Record<string, Record<string, string>>>('targets', {})[caseId] ?? {};
    if (format === 'html') return renderHTML(pack);
    if (format === 'bounty') return renderBountyReport(pack);
    if (format === 'hurl') return renderHurl(pack.case, savedTargets);
    if (format === 'playwright') return renderPlaywright(pack.case, savedTargets);
    return renderMarkdown(pack);
  }
  async startDemo(mode: 'vulnerable' | 'secure' = 'vulnerable') {
    if (this.activeCases.size) throw Object.assign(new Error('Wait for active runs before restarting the controlled lab'), { statusCode: 409 });
    if (this.demo) this.demo.setMode(mode);
    else this.demo = await startDemo(mode);
    let spec = this.store.getCase('cross-tenant-document');
    if (!spec) spec = this.store.saveCase(createExampleCase());
    const settings = this.store.setting<Record<string, Record<string, string>>>('targets', {});
    settings[spec.id] = { api: this.demo.origin };
    this.store.setSetting('targets', settings);
    await this.bindDemo(spec.id, false, 'cookie');
    return { case: spec, origin: this.demo.origin, accounts: this.demo.accounts, mode: this.demo.mode };
  }
  async bindDemo(caseId: string, fresh = false, authMode: 'cookie' | 'bearer' = 'cookie') {
    this.idle(caseId);
    if (!this.demo) throw new Error('Start the controlled demo first');
    const spec = this.getCase(caseId);
    const accounts = fresh ? this.demo.freshPair() : this.demo.accounts;
    for (const [index, actor] of spec.actors.entries()) {
      const user = accounts[index % accounts.length];
      if (authMode === 'cookie') {
        await this.connectDirect(caseId, actor.id, { origin: this.demo.origin, login: { path: '/auth/login', method: 'POST', body: { email: user.email, password: user.password } } });
      } else {
        const response = await fetch(`${this.demo.origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
        const login = (await response.json()) as { token: string };
        await this.connectDirect(caseId, actor.id, { origin: this.demo.origin, token: login.token });
      }
    }
    return this.state();
  }
  setDemoMode(mode: 'vulnerable' | 'secure') {
    if (this.activeCases.size) throw new Error('Wait for active runs before changing the lab');
    if (!this.demo) throw new Error('Start the controlled demo first');
    this.demo.setMode(mode);
    return { mode };
  }
  safeError(error: unknown) {
    return createRedactor(this.knownSecrets()).text(error instanceof Error ? error.message : 'Operation failed');
  }
  async close() {
    this.cancelScans();
    this.controllers.forEach(c => c.abort());
    await Promise.allSettled([...this.tasks.values()]);
    await this.chats.close();
    this.harness.close();
    await this.mcp.close();
    await this.browsers.close();
    await this.demo?.close();
    this.store.close();
  }
}
