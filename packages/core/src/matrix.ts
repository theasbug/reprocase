import { randomUUID } from 'node:crypto';
import type { CaseSpec, Json, MatrixCell, MatrixResult, RunConfig, RunResult, SessionTransport } from './schema.ts';
import { executeCase } from './runner.ts';
import { createRedactor } from './redact.ts';

function remapRefs(value: Json, fromActors: Set<string>, toActor: string): Json {
  if (!value || typeof value !== 'object') return value;
  if (!Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).$ref === 'string') {
    const ref = String((value as Record<string, unknown>).$ref);
    const match = /^actors\.([^.]+)\.(.+)$/.exec(ref);
    if (match && fromActors.has(match[1]!)) return { $ref: `actors.${toActor}.${match[2]}` };
    return value;
  }
  if (Array.isArray(value)) return value.map(item => remapRefs(item, fromActors, toActor));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapRefs(v as Json, fromActors, toActor)]));
}

export async function executeMatrix(
  spec: CaseSpec,
  config: RunConfig,
  transport: SessionTransport,
  options: { signal?: AbortSignal; onRun?: (run: RunResult) => void } = {},
): Promise<MatrixResult> {
  const startedAt = new Date().toISOString();
  const ownerActor = spec.resources[0]?.ownerActor ?? spec.actors[0]?.id ?? 'owner';
  const challengers = spec.actors.filter(a => a.id !== ownerActor);
  const nonOwners = new Set(challengers.map(a => a.id));
  const cells: MatrixCell[] = [];

  for (const challenger of challengers) {
    if (options.signal?.aborted) break;
    const variant: CaseSpec = {
      ...spec,
      actors: spec.actors.filter(a => a.id === ownerActor || a.id === challenger.id),
      preconditions: spec.preconditions.map(c => ({
        ...c,
        left: remapRefs(c.left, nonOwners, challenger.id),
        ...(c.right === undefined ? {} : { right: remapRefs(c.right, nonOwners, challenger.id) }),
      })),
      steps: spec.steps.map(s => {
        const actor = s.request.actor === ownerActor ? ownerActor : challenger.id;
        return {
          ...s,
          request: {
            ...s.request,
            actor,
            pathParams: remapRefs(s.request.pathParams, nonOwners, challenger.id) as Record<string, Json>,
            query: remapRefs(s.request.query, nonOwners, challenger.id) as Record<string, Json>,
            headers: remapRefs(s.request.headers, nonOwners, challenger.id) as Record<string, Json>,
            ...(s.request.body === undefined ? {} : { body: remapRefs(s.request.body, nonOwners, challenger.id) }),
          },
          checks: s.checks.map(c => ({
            ...c,
            left: remapRefs(c.left, nonOwners, challenger.id),
            ...(c.right === undefined ? {} : { right: remapRefs(c.right, nonOwners, challenger.id) }),
          })),
        };
      }),
      witness: {
        ...spec.witness,
        success: spec.witness.success.map(c => ({
          ...c,
          left: remapRefs(c.left, nonOwners, challenger.id),
          ...(c.right === undefined ? {} : { right: remapRefs(c.right, nonOwners, challenger.id) }),
        })),
        rejection: spec.witness.rejection.map(c => ({
          ...c,
          left: remapRefs(c.left, nonOwners, challenger.id),
          ...(c.right === undefined ? {} : { right: remapRefs(c.right, nonOwners, challenger.id) }),
        })),
      },
    };

    const run = await executeCase(variant, config, transport, { signal: options.signal });
    options.onRun?.(run);
    const identity = run.identities[challenger.id];
    const probeSteps = run.steps.filter(s => s.phase === 'probe');
    const probeStatuses = probeSteps.flatMap(s => s.concurrency ? s.concurrency.statuses : s.response ? [s.response.status] : []);
    const allChecks = [...run.checks, ...run.steps.flatMap(s => s.checks)];
    cells.push({
      actorId: challenger.id,
      actorLabel: challenger.label,
      ...(identity?.role !== undefined ? { role: identity.role } : challenger.expectedRole ? { role: challenger.expectedRole } : {}),
      ...(identity?.tenant !== undefined ? { tenant: identity.tenant } : {}),
      verdict: run.verdict,
      code: run.code,
      reason: run.reason,
      probeStatuses,
      passedChecks: allChecks.filter(c => c.passed).length,
      totalChecks: allChecks.length,
      runId: run.id,
    });
  }

  const redact = createRedactor(transport.knownSecrets());
  return redact.json({
    id: `matrix_${randomUUID()}`,
    caseId: spec.id,
    caseRevision: spec.revision,
    ownerActor,
    startedAt,
    finishedAt: new Date().toISOString(),
    cells,
    summary: {
      totalActors: cells.length,
      reproduced: cells.filter(c => c.verdict === 'reproduced').length,
      notReproduced: cells.filter(c => c.verdict === 'not_reproduced').length,
      inconclusive: cells.filter(c => c.verdict === 'inconclusive').length,
    },
  });
}
