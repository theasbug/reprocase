import { caseSchema, runConfigSchema, type CaseSpec, type RunConfig, type ValidationIssue } from './schema.ts';
import { refs, targetOrigin } from './values.ts';
import { validateCase } from './validate.ts';
export interface PlanBinding { actorId: string; origin: string; connected: boolean; mode: 'browser' | 'direct'; }
export interface RunPlan {
  caseId: string; revision: number; ready: boolean; targets: Record<string, string>; issues: ValidationIssue[];
  accounts: { id: string; label: string; bound: boolean; verifiedPreviously: boolean; originMatches: boolean; mode?: 'browser' | 'direct' }[];
  totals: { steps: number; reads: number; writes: number; identityChecks: number; maximumPlannedRequests: number; requestBudget: number };
  steps: { id: string; label: string; phase: string; actor: string; method: string; origin: string; path: string; effect: string; dependencies: string[]; consumes: string[]; produces: string[] }[];
  notes: string[];
}
/** Pure inspection. It does not authenticate, resolve DNS, open a browser or send requests. */
export function planRun(input: CaseSpec, config: RunConfig, bindings: PlanBinding[] = []): RunPlan {
  const spec = caseSchema.parse(input), options = runConfigSchema.parse(config);
  const issues = validateCase(spec);
  const targets: Record<string, string> = {};
  for (const origin of spec.origins) {
    try { targets[origin.id] = targetOrigin(options.targets[origin.id] ?? ''); }
    catch { issues.push({ path: `targets.${origin.id}`, message: 'Choose a plain HTTP(S) origin for this API', level: 'error' }); }
  }
  if (options.approvedRevision !== spec.revision) issues.push({ path: 'approvedRevision', message: 'The selected revision is no longer current', level: 'error' });
  const accounts = spec.actors.map(actor => {
    const binding = bindings.find(b => b.actorId === actor.id), originMatches = !!binding && binding.origin === targets[actor.identity.origin];
    if (!binding) issues.push({ path: `actors.${actor.id}`, message: `Connect ${actor.label} before running`, level: 'error' });
    else if (!originMatches) issues.push({ path: `actors.${actor.id}`, message: `${actor.label} is connected to another origin`, level: 'error' });
    else if (!binding.connected) issues.push({ path: `actors.${actor.id}`, message: `${actor.label} has not passed identity verification yet; the run will check it live`, level: 'warning' });
    return { id: actor.id, label: actor.label, bound: !!binding, verifiedPreviously: !!binding?.connected, originMatches, ...(binding ? { mode: binding.mode } : {}) };
  });
  const producers = new Map<string, string>();
  for (const step of spec.steps) for (const capture of step.captures) producers.set(`captures.${capture.name}`, step.id);
  const steps = spec.steps.map(step => {
    const consumes = [...new Set(refs(step.request))];
    return { id: step.id, label: step.label, phase: step.phase, actor: step.request.actor, method: step.request.method, origin: targets[step.request.origin] ?? step.request.origin, path: step.request.path, effect: step.effect, consumes, produces: step.captures.map(c => `captures.${c.name}`), dependencies: [...new Set(consumes.map(ref => producers.get(ref) ?? (/^steps\./.test(ref) ? ref.split('.')[1] : undefined)).filter((id): id is string => !!id))] };
  });
  let afterFirstProbe = false, rechecks = 0;
  for (const step of spec.steps) { if (step.phase === 'probe') { rechecks++; afterFirstProbe = true; } else if (afterFirstProbe && step.phase === 'verify') rechecks++; }
  const stepRequests = spec.steps.reduce((sum, s) => sum + (s.concurrency?.count ?? 1), 0);
  const identityChecks = spec.actors.length * (1 + rechecks), maximumPlannedRequests = identityChecks + stepRequests, requestBudget = options.maxRequests ?? 100;
  if (maximumPlannedRequests > requestBudget) issues.push({ path: 'maxRequests', message: `The full plan needs up to ${maximumPlannedRequests} requests, above the selected budget of ${requestBudget}`, level: 'error' });
  if (!spec.steps.some(s => s.phase === 'cleanup')) issues.push({ path: 'steps', message: 'No cleanup step is configured; created test resources may remain', level: 'warning' });
  return { caseId: spec.id, revision: spec.revision, ready: !issues.some(i => i.level === 'error'), targets, issues, accounts, steps, totals: { steps: steps.length, reads: steps.filter(s => s.effect === 'read').length, writes: steps.filter(s => s.effect === 'write').length, identityChecks, maximumPlannedRequests, requestBudget }, notes: ['This is an inspection of the plan; no target traffic was sent.', 'Previously verified sessions can change. Live identity and ownership checks still run during execution.', 'The request count is an upper estimate for the declared workflow, including identity rechecks and cleanup. A failed prerequisite can stop the run earlier.'] };
}
