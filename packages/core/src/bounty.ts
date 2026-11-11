import { z } from 'zod';

export const bountyPlatformSchema = z.enum(['hackerone', 'bugcrowd', 'intigriti', 'yeswehack', 'custom']);
export type BountyPlatform = z.infer<typeof bountyPlatformSchema>;

export const bountyProgramSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  platform: bountyPlatformSchema.default('hackerone'),
  inScope: z.array(z.string().trim().min(1).max(500)).default([]),
  outOfScope: z.array(z.string().trim().min(1).max(500)).default([]),
  hasCustomHeaders: z.boolean().default(false),
  customHeaders: z.record(z.string(), z.string()).default({}),
  maxRps: z.number().int().min(1).max(100).default(10),
  notes: z.string().max(10000).default(''),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type BountyProgram = z.infer<typeof bountyProgramSchema>;

export interface ScopeCheckResult {
  target: string;
  normalizedHost: string;
  normalizedUrl: string;
  allowed: boolean;
  matchedRule?: string;
  reason: string;
}

const glob = (value: string, pattern: string) => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value);
function hostMatch(host: string, pattern: string) {
  if (pattern.startsWith('*.')) { const base=pattern.slice(2); return host===base || host.endsWith('.'+base); }
  return glob(host, pattern);
}
function matchScopePattern(url: URL, pattern: string): boolean {
  const clean=pattern.trim(); if(!clean)return false;
  if(clean==='*')return true;
  try {
    if(clean.includes('://') || clean.includes('/')) {
      const rule=new URL(clean.includes('://')?clean:'https://'+clean);
      if(!['http:','https:'].includes(rule.protocol)||rule.username||rule.password||rule.hash)return false;
      return url.protocol===rule.protocol && url.port===rule.port && hostMatch(url.hostname.toLowerCase(),rule.hostname.toLowerCase()) && glob(url.pathname,rule.pathname) && (!rule.search || glob(url.search,rule.search));
    }
    const rule=new URL('https://'+clean);
    return hostMatch(url.hostname.toLowerCase(),rule.hostname.toLowerCase()) && (!/:\d+$/.test(clean) || (url.port || (url.protocol==='https:'?'443':'80'))===clean.match(/:(\d+)$/)?.[1]);
  } catch { return false; }
}
export function checkScope(targetInput: string, program: Pick<BountyProgram, 'inScope' | 'outOfScope'>): ScopeCheckResult {
  const raw=targetInput.trim(); let url:URL;
  const invalid={target:raw,normalizedHost:'',normalizedUrl:raw,allowed:false,reason:'Invalid HTTP(S) target'};
  try {url=new URL(raw.includes('://')?raw:'https://'+raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/%(?:2f|5c)/i.test(url.pathname))return invalid;}catch{return invalid;}
  const base={target:raw,normalizedHost:url.hostname.toLowerCase(),normalizedUrl:url.href};
  for(const rule of program.outOfScope)if(matchScopePattern(url,rule))return {...base,allowed:false,matchedRule:rule,reason:'Target matches out-of-scope exclusion rule "'+rule+'".'};
  for(const rule of program.inScope)if(matchScopePattern(url,rule))return {...base,allowed:true,matchedRule:rule,reason:'Target is authorized under in-scope rule "'+rule+'".'};
  return {...base,allowed:false,reason:program.inScope.length?'Target does not match any configured in-scope asset pattern.':'Program has no in-scope rules configured yet.'};
}

export interface CvssMetrics {
  AV: 'N' | 'A' | 'L' | 'P';
  AC: 'L' | 'H';
  PR: 'N' | 'L' | 'H';
  UI: 'N' | 'R';
  S: 'U' | 'C';
  C: 'N' | 'L' | 'H';
  I: 'N' | 'L' | 'H';
  A: 'N' | 'L' | 'H';
}

export interface CvssResult {
  vector: string;
  score: number;
  severity: 'None' | 'Low' | 'Medium' | 'High' | 'Critical';
  impactSubscore: number;
  exploitabilitySubscore: number;
  metrics: CvssMetrics;
}

const DEFAULT_CVSS: CvssMetrics = { AV: 'N', AC: 'L', PR: 'L', UI: 'N', S: 'U', C: 'H', I: 'L', A: 'N' };

function roundUp1(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

const cvssMetricsSchema=z.strictObject({AV:z.enum(['N','A','L','P']),AC:z.enum(['L','H']),PR:z.enum(['N','L','H']),UI:z.enum(['N','R']),S:z.enum(['U','C']),C:z.enum(['N','L','H']),I:z.enum(['N','L','H']),A:z.enum(['N','L','H'])});
export function parseCvssVector(input?:string|Partial<CvssMetrics>):CvssMetrics {
  if(input===undefined)return {...DEFAULT_CVSS};
  if(typeof input==='object')return cvssMetricsSchema.parse(input);
  if(!/^CVSS:3\.1\//.test(input))throw new Error('Use a complete CVSS:3.1 vector');
  const entries=input.slice(9).split('/').map(p=>p.split(':'));
  if(entries.some(e=>e.length!==2)||new Set(entries.map(e=>e[0])).size!==entries.length)throw new Error('Invalid or duplicate CVSS metric');
  return cvssMetricsSchema.parse(Object.fromEntries(entries));
}

export function calculateCvss31(input?: string | Partial<CvssMetrics>): CvssResult {
  const m = parseCvssVector(input);
  const avWeight = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const acWeight = { L: 0.77, H: 0.44 }[m.AC];
  const prWeight = m.S === 'U' ? { N: 0.85, L: 0.62, H: 0.27 }[m.PR] : { N: 0.85, L: 0.68, H: 0.5 }[m.PR];
  const uiWeight = { N: 0.85, R: 0.62 }[m.UI];
  const ciaWeight = { N: 0, L: 0.22, H: 0.56 };

  const iscBase = 1 - (1 - ciaWeight[m.C]) * (1 - ciaWeight[m.I]) * (1 - ciaWeight[m.A]);
  const impact =
    m.S === 'U'
      ? 6.42 * iscBase
      : 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15);
  const exploitability = 8.22 * avWeight * acWeight * prWeight * uiWeight;

  let score = 0;
  if (impact > 0) {
    score = m.S === 'U' ? roundUp1(Math.min(impact + exploitability, 10)) : roundUp1(Math.min(1.08 * (impact + exploitability), 10));
  }
  const severity: CvssResult['severity'] =
    score === 0 ? 'None' : score < 4.0 ? 'Low' : score < 7.0 ? 'Medium' : score < 9.0 ? 'High' : 'Critical';
  const vector = `CVSS:3.1/AV:${m.AV}/AC:${m.AC}/PR:${m.PR}/UI:${m.UI}/S:${m.S}/C:${m.C}/I:${m.I}/A:${m.A}`;

  return {
    vector,
    score,
    severity,
    impactSubscore: Math.max(0, Number(impact.toFixed(1))),
    exploitabilitySubscore: Number(exploitability.toFixed(1)),
    metrics: m,
  };
}

export const bountyFindingStatusSchema = z.enum(['recon', 'triaging', 'verified', 'reported', 'resolved']);
export type BountyFindingStatus = z.infer<typeof bountyFindingStatusSchema>;

export const bountyFindingSchema = z.object({
  id: z.string().min(1).max(100),
  programId: z.string().optional(),
  title: z.string().trim().min(1).max(250),
  category: z.string().trim().min(1).max(100).default('idor_bola'),
  status: bountyFindingStatusSchema.default('triaging'),
  cvssVector: z.string().default('CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N'),
  cvssScore: z.number().min(0).max(10).default(7.1),
  severity: z.enum(['None', 'Low', 'Medium', 'High', 'Critical']).default('High'),
  cwe: z.string().max(100).default('CWE-639: Authorization Bypass Through User-Controlled Key'),
  endpoint: z.string().max(1000).default(''),
  caseId: z.string().optional(),
  runId: z.string().optional(),
  summary: z.string().max(20000).default(''),
  impact: z.string().max(10000).default(''),
  remediation: z.string().max(10000).default(''),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type BountyFinding = z.infer<typeof bountyFindingSchema>;

export function renderFindingMarkdown(finding: BountyFinding, program?: BountyProgram): string {
  const cvss = calculateCvss31(finding.cvssVector);
  return [
    `# [${cvss.severity.toUpperCase()}] ${finding.title}`,
    '',
    '## Vulnerability Overview',
    `- **Program:** ${program ? `${program.name} (${program.platform})` : 'Custom Assessment'}`,
    `- **Severity:** ${cvss.severity} (${cvss.score} / 10.0)`,
    `- **CVSS v3.1 Vector:** \`${cvss.vector}\``,
    `- **Weakness (CWE):** ${finding.cwe}`,
    `- **Category:** \`${finding.category}\``,
    `- **Status:** \`${finding.status}\``,
    ...(finding.endpoint ? [`- **Affected Endpoint:** \`${finding.endpoint}\``] : []),
    ...(finding.caseId ? [`- **Linked ReproCase ID:** \`${finding.caseId}\`${finding.runId ? ` (Run \`${finding.runId}\`)` : ''}`] : []),
    '',
    '## Summary & Technical Details',
    finding.summary || 'Discovered and analyzed via ReproCase Bug Bounty Workbench.',
    '',
    '## Security Impact',
    finding.impact || 'An attacker can bypass intended security boundaries affecting confidentiality or integrity of protected resources.',
    '',
    '## Remediation Recommendation',
    finding.remediation || 'Enforce server-side object and function-level authorization checks tied to the authenticated session context.',
    '',
  ].join('\n');
}
