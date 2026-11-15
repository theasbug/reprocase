import { z } from 'zod';
import { caseSchema, packageSchema, type CaseSpec } from './schema.ts';
import { exportPackage } from './export.ts';

/**
 * A case template is a proven case with every target address, account, evidence and observed
 * value removed. It is reused on another target that the user names explicitly: one target per
 * case, with the user's own test accounts and the normal scope, approval and run checks.
 * Templates never choose or discover targets.
 */
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'template';
const randomSuffix = () => globalThis.crypto.randomUUID().slice(0, 8);

export const templateMetaSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  appliesTo: z.string().trim().max(200).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type TemplateMeta = z.infer<typeof templateMetaSchema>;

export const templateSchema = templateMetaSchema.extend({
  format: z.literal('reprocase-template'),
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  createdAt: z.string(),
  case: caseSchema,
});
export type CaseTemplate = z.infer<typeof templateSchema>;

/** Builds a shareable template from a case. Credentials and observed values are redacted like an export. */
export function makeTemplate(spec: CaseSpec, meta: z.input<typeof templateMetaSchema>, secrets: string[] = []): CaseTemplate {
  const info = templateMetaSchema.parse(meta);
  const safe = exportPackage(spec, undefined, secrets).case;
  return templateSchema.parse({
    format: 'reprocase-template', version: 1,
    id: `${slug(info.name)}-${randomSuffix()}`,
    createdAt: new Date().toISOString(),
    ...info,
    case: { ...safe, revision: 1, policy: { ...safe.policy, acknowledged: false } },
  });
}

/** Accepts a template file, or a ReproCase package (its evidence is dropped). */
export function parseTemplateFile(text: string, fallbackName = 'Imported template'): CaseTemplate {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  const asTemplate = templateSchema.safeParse(data);
  if (asTemplate.success) return asTemplate.data;
  const asPackage = packageSchema.safeParse(data);
  if (asPackage.success) return makeTemplate(asPackage.data.case, { name: asPackage.data.case.title || fallbackName, description: asPackage.data.case.description.slice(0, 2000) });
  throw new Error('This is neither a ReproCase template nor a ReproCase package.');
}

export interface TemplateSlot { path: string; uses: string[] }

/** Every request path the template uses, so the user can map each one to the new target's API. */
export function templateSlots(spec: CaseSpec): TemplateSlot[] {
  const slots = new Map<string, Set<string>>();
  const add = (path: string, use: string) => { if (!slots.has(path)) slots.set(path, new Set()); slots.get(path)!.add(use); };
  for (const actor of spec.actors) add(actor.identity.path, `identity: ${actor.label}`);
  for (const step of spec.steps) add(step.request.path, `${step.request.method} · ${step.label}`);
  if ('sessionProof' in spec && spec.sessionProof) add(spec.sessionProof.request.path, `${spec.sessionProof.request.method} · proof read`);
  return [...slots].map(([path, uses]) => ({ path, uses: [...uses] }));
}

const caseId = (name: string) => { const value = `${slug(name)}-${randomSuffix()}`; return /^[a-z]/.test(value) ? value : `case-${value}`; };
const placeholders = (path: string) => [...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!).sort().join(',');

export const applyTemplateSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  paths: z.record(z.string(), z.string()).default({}),
});

/** Creates a new, unapproved case from a template, with request paths rewritten for another target. */
export function applyTemplate(template: CaseTemplate, input: z.input<typeof applyTemplateSchema> = {}): CaseSpec {
  const options = applyTemplateSchema.parse(input);
  const known = new Set(templateSlots(template.case).map(slot => slot.path));
  const map = new Map<string, string>();
  for (const [from, rawTo] of Object.entries(options.paths)) {
    const to = rawTo.trim();
    if (!known.has(from)) throw new Error(`The template does not use the path ${from}.`);
    if (!to || to === from) continue;
    if (!to.startsWith('/') || /^\/\//.test(to) || /[\s?#]/.test(to)) throw new Error(`${to} must be a path on the target, starting with a single /, without a query or spaces.`);
    if (placeholders(to) !== placeholders(from)) throw new Error(`${to} must keep the same {placeholders} as ${from}.`);
    map.set(from, to);
  }
  const path = (value: string) => map.get(value) ?? value;
  const source = template.case;
  const next = {
    ...source,
    id: caseId(template.name),
    revision: 1,
    title: options.title ?? source.title,
    policy: { ...source.policy, acknowledged: false },
    actors: source.actors.map(actor => ({ ...actor, identity: { ...actor.identity, path: path(actor.identity.path) } })),
    steps: source.steps.map(step => ({ ...step, request: { ...step.request, path: path(step.request.path) } })),
    ...('sessionProof' in source && source.sessionProof ? { sessionProof: { ...source.sessionProof, request: { ...source.sessionProof.request, path: path(source.sessionProof.request.path) } } } : {}),
  };
  return caseSchema.parse(next);
}
