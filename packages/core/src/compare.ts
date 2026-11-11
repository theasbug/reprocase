import type { Json, RunResult, StepResult } from './schema.ts';
import { equal } from './values.ts';
export interface FieldChange { pointer: string; kind: 'added' | 'removed' | 'changed'; before?: Json; after?: Json; }
export interface RunComparison {
  caseId: string; before: { id: string; revision: number; verdict: string; code: string; startedAt: string }; after: { id: string; revision: number; verdict: string; code: string; startedAt: string };
  verdictChanged: boolean; sameRevision: boolean; changedSteps: number; checksChanged: string[]; truncated: boolean; notes: string[];
  steps: { id: string; label: string; beforeStatus?: string; afterStatus?: string; beforeHTTP?: number; afterHTTP?: number; beforeError?: string; afterError?: string; changed: boolean; limited: boolean; fields: FieldChange[]; checksChanged: string[] }[];
}
function flatten(value: Json | undefined): { fields: Map<string, Json>; truncated: boolean } {
  const fields = new Map<string, Json>(), stack: { path: string; value: Json | undefined; depth: number }[] = [{ path: '', value, depth: 0 }];
  let visited = 0, truncated = false;
  while (stack.length) {
    if (++visited > 10000) { truncated = true; break; }
    const item = stack.pop()!;
    if (item.value === undefined) continue;
    if (item.depth >= 24) { truncated = true; continue; }
    if (item.value !== null && typeof item.value === 'object' && Object.keys(item.value).length) {
      for (const key of Object.keys(item.value)) stack.push({ path: `${item.path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, value: (item.value as Record<string, Json>)[key], depth: item.depth + 1 });
    } else fields.set(item.path, item.value);
  }
  return { fields, truncated };
}
export function compareRuns(before: RunResult, after: RunResult): RunComparison {
  if (before.caseId !== after.caseId) throw new Error('Choose two runs of the same case');
  if (before.state === 'running' || after.state === 'running') throw new Error('Wait for both runs to finish before comparing');
  const metadata = (run: RunResult) => ({ id: run.id, revision: run.caseRevision, verdict: run.verdict, code: run.code, startedAt: run.startedAt });
  const visible = (run: RunResult) => new Map(run.steps.filter(s => s.phase !== 'identity').map(s => [s.id, s]));
  const left = visible(before), right = visible(after); let truncated = false, remaining = 200;
  const steps = [...new Set([...left.keys(), ...right.keys()])].map(id => {
    const a = left.get(id), b = right.get(id), aFields = flatten(a?.response?.body), bFields = flatten(b?.response?.body);
    truncated ||= aFields.truncated || bFields.truncated;
    const fields: FieldChange[] = []; let bodyChanged = false, limited = aFields.truncated || bFields.truncated;
    for (const pointer of [...new Set([...aFields.fields.keys(), ...bFields.fields.keys()])].sort()) {
      const av = aFields.fields.get(pointer), bv = bFields.fields.get(pointer);
      if (equal(av, bv)) continue;
      bodyChanged = true;
      if (remaining-- <= 0) { truncated = true; limited = true; continue; }
      fields.push({ pointer, kind: av === undefined ? 'added' : bv === undefined ? 'removed' : 'changed', ...(av === undefined ? {} : { before: av }), ...(bv === undefined ? {} : { after: bv }) });
    }
    const checks = (step: StepResult | undefined) => new Map((step?.checks ?? []).map(c => [c.id, c.passed]));
    const ac = checks(a), bc = checks(b), checksChanged = [...new Set([...ac.keys(), ...bc.keys()])].filter(key => ac.get(key) !== bc.get(key));
    return { id, label: b?.label ?? a?.label ?? id, beforeStatus: a?.status, afterStatus: b?.status, beforeHTTP: a?.response?.status, afterHTTP: b?.response?.status, beforeError: a?.error, afterError: b?.error, changed: !a || !b || a.status !== b.status || a.response?.status !== b.response?.status || a.error !== b.error || bodyChanged || checksChanged.length > 0, limited, fields, checksChanged };
  });
  const ac = new Map(before.checks.map(c => [c.id, c.passed])), bc = new Map(after.checks.map(c => [c.id, c.passed]));
  const checksChanged = [...new Set([...ac.keys(), ...bc.keys()])].filter(id => ac.get(id) !== bc.get(id));
  return { caseId: before.caseId, before: metadata(before), after: metadata(after), verdictChanged: before.verdict !== after.verdict || before.code !== after.code, sameRevision: before.caseRevision === after.caseRevision, changedSteps: steps.filter(s => s.changed).length, checksChanged, truncated, steps, notes: [before.caseRevision === after.caseRevision ? 'Both runs used the same case revision.' : 'The case revision changed. Differences cannot be attributed solely to the target application.', 'This compares recorded observations. It does not run the target or prove that every vulnerability variant is fixed.', ...(truncated ? ['The field comparison reached its display limit. Inspect the original run evidence for the complete responses.'] : [])] };
}
