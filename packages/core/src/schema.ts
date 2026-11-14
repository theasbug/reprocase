import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonSchema), z.record(z.string(), jsonSchema),
]));
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value), 'Reserved identifier');
export const refSchema = z.strictObject({ $ref: z.string().min(1) });
export type Value = Json; // A sole { $ref: 'captures.documentId' } object is a typed reference.
export const conditionSchema = z.strictObject({
  id, label: z.string().min(1), op: z.enum(['eq', 'neq', 'contains', 'not_contains', 'exists', 'in', 'gt', 'gte', 'lt', 'lte', 'regex']),
  left: jsonSchema, right: jsonSchema.optional(),
});
export type Condition = z.infer<typeof conditionSchema>;
export const requestSchema = z.strictObject({
  actor: id, origin: id, method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().startsWith('/'),
  pathParams: z.record(z.string(), jsonSchema).default({}),
  query: z.record(z.string(), jsonSchema).default({}),
  headers: z.record(z.string(), jsonSchema).default({}),
  contentType: z.enum(['json', 'form', 'multipart', 'graphql']).optional(),
  body: jsonSchema.optional(),
});
export type HttpRequestSpec = z.infer<typeof requestSchema>;
export const actorSchema = z.strictObject({
  id, label: z.string().min(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  expectedRole: z.string().optional(),
  identity: z.strictObject({ origin: id, path: z.string().startsWith('/'), idPointer: z.string(), tenantPointer: z.string().optional(), rolePointer: z.string().optional() }),
});
export type ActorSpec = z.infer<typeof actorSchema>;
export const concurrencySchema = z.strictObject({
  count: z.number().int().min(2).max(25),
  mode: z.enum(['parallel', 'sequential']).default('parallel'),
});
export type ConcurrencySpec = z.infer<typeof concurrencySchema>;
export const stepSchema = z.strictObject({
  id, label: z.string().min(1), phase: z.enum(['prepare', 'probe', 'verify', 'cleanup']),
  effect: z.enum(['read', 'write']), request: requestSchema,
  concurrency: concurrencySchema.optional(),
  captures: z.array(z.strictObject({ name: id, from: z.enum(['body', 'headers', 'status']).default('body'), pointer: z.string().default('') })).default([]),
  checks: z.array(conditionSchema).default([]),
});
export type StepSpec = z.infer<typeof stepSchema>;
export const caseV1Schema = z.strictObject({
  schemaVersion: z.literal(1), id, revision: z.number().int().positive(),
  title: z.string().min(1).max(200), description: z.string().max(12000).default(''),
  policy: z.strictObject({ statement: z.string().min(1), acknowledged: z.boolean() }),
  actors: z.array(actorSchema).min(1).max(12),
  origins: z.array(z.strictObject({ id, label: z.string().min(1) })).min(1).max(12),
  preconditions: z.array(conditionSchema).default([]),
  resources: z.array(z.strictObject({ id, label: z.string(), ownerActor: id, createdBy: id, idRef: z.string(), ownerRef: z.string(), tenantRef: z.string().optional() })).default([]),
  steps: z.array(stepSchema).min(1).max(200),
  witness: z.strictObject({
    success: z.array(conditionSchema).min(1), rejection: z.array(conditionSchema).min(1),
    writeProof: z.strictObject({ resource: id, probe: id, before: id, after: id, fieldPointer: z.string().startsWith('/'), mutationPointer: z.string().startsWith('/'), expected: z.never().optional(), control: z.never().optional() }).optional(),
  }),
  kind: z.never().optional(), boundary: z.never().optional(), sessionProof: z.never().optional(),
});
const scalarSchema = z.union([z.string().min(1).max(2000), z.number().finite(), z.boolean()]);
export const caseV2Schema = caseV1Schema.extend({
  schemaVersion: z.literal(2), kind: z.enum(['authorization', 'function_read', 'cors_read']),
  boundary: z.enum(['object', 'role']).default('object'),
  sessionProof: z.strictObject({ request: requestSchema, fieldPointer: z.string().startsWith('/').max(512) }).optional(),
  witness: z.strictObject({
    success: z.array(conditionSchema), rejection: z.array(conditionSchema),
    writeProof: caseV1Schema.shape.witness.shape.writeProof.unwrap().extend({
      expected: scalarSchema.optional(), control: z.strictObject({ step: id, before: id, mutation: id, resource: id, fieldPointer: z.string().startsWith('/') }).optional(),
    }).optional(),
  }),
}).superRefine((v, ctx) => {
  if (v.kind === 'authorization' && (v.sessionProof || !v.resources.length || !v.witness.success.length || !v.witness.rejection.length)) ctx.addIssue({ code: 'custom', message: 'Authorization needs fresh-resource witnesses and no session proof' });
  if (v.kind !== 'authorization' && (!v.sessionProof || v.resources.length || v.witness.writeProof)) ctx.addIssue({ code: 'custom', message: 'Session proofs need their request and field, with no resource/write witness' });
});
export const caseSchema = z.union([caseV1Schema, caseV2Schema]);
export type CaseSpec = z.infer<typeof caseSchema>;
export interface Identity { id: Json; tenant?: Json; role?: Json; }
export interface ResolvedRequest { url: string; method: string; headers: Record<string, string>; contentType?: 'json' | 'form' | 'multipart' | 'graphql'; body?: Json; }
export interface HttpResponse { status: number; headers: Record<string, string>; body: Json; }
export interface SessionTransport {
  request(actorId: string, request: ResolvedRequest, signal?: AbortSignal): Promise<HttpResponse>;
  knownSecrets(): string[];
  anonymous?(request: ResolvedRequest, signal?: AbortSignal): Promise<HttpResponse>;
  browserFetch?(actorId: string, request: ResolvedRequest, origin: 'foreign' | 'null' | 'same', signal?: AbortSignal): Promise<HttpResponse>;
}
export interface BindingProfile {
  id: string; actors: Record<string, { mode: 'browser' | 'direct'; origin: string; connected: boolean; identity?: Identity }>;
}
export interface RunConfig {
  targets: Record<string, string>;
  approvedRevision: number;
  maxRequests?: number;
  intervalMs?: number;
}
export const runConfigSchema = z.strictObject({
  targets: z.record(z.string(), z.string()), approvedRevision: z.number().int().positive(),
  maxRequests: z.number().int().positive().max(10000).optional(), intervalMs: z.number().finite().min(0).max(60000).optional(),
});
export type Verdict = 'reproduced' | 'not_reproduced' | 'inconclusive';
export interface CheckResult { id: string; label: string; passed: boolean; detail?: string; }
export interface StepConcurrencyResult { count: number; succeeded: number; statuses: number[]; }
export interface StepResult {
  id: string; label: string; phase: StepSpec['phase'] | 'identity'; actor: string;
  status: 'passed' | 'failed' | 'running' | 'skipped'; startedAt: string; finishedAt?: string;
  request?: { method: string; url: string; contentType?: string; body?: Json };
  response?: HttpResponse; concurrency?: StepConcurrencyResult; checks: CheckResult[]; error?: string;
}
export interface MatrixCell {
  actorId: string;
  actorLabel: string;
  role?: Json;
  tenant?: Json;
  verdict: Verdict;
  code: string;
  reason: string;
  probeStatuses: number[];
  passedChecks: number;
  totalChecks: number;
  runId: string;
}
export interface MatrixResult {
  id: string;
  caseId: string;
  caseRevision: number;
  ownerActor: string;
  startedAt: string;
  finishedAt: string;
  cells: MatrixCell[];
  summary: { totalActors: number; reproduced: number; notReproduced: number; inconclusive: number };
}
export interface RunResult {
  schemaVersion: 1 | 2; id: string; caseId: string; caseRevision: number;
  state: 'running' | 'completed' | 'cancelled'; verdict: Verdict; reason: string; code: string;
  startedAt: string; finishedAt?: string; steps: StepResult[]; checks: CheckResult[];
  identities: Record<string, Identity>; requests: number; cleanupErrors: string[];
  setup: 'created_this_run' | 'verified_session';
  /** Local-only recovery addresses; always omitted from shareable evidence. */
  localCleanupTargets?: string[];
}
export interface RunEvent { type: 'started' | 'step' | 'check' | 'finished'; run: RunResult; }
export const packageSchema = z.strictObject({
  format: z.literal('reprocase'), schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(), case: caseSchema,
  evidence: jsonSchema.optional(), redactions: z.array(z.string()).default([]),
}).refine(v => v.schemaVersion === v.case.schemaVersion, 'Package and case versions must match');
export type ReproPackage = z.infer<typeof packageSchema>;
export interface ValidationIssue { path: string; message: string; level: 'error' | 'warning'; }
export type AISettings = { provider: 'openai' | 'compatible' | 'anthropic'; baseURL?: string; apiKey?: string; model: string };
