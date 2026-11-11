import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { bountyFindingSchema, bountyProgramSchema, caseSchema, type BountyFinding, type BountyProgram, type CaseSpec, type RunResult, type ChatSession } from '@reprocase/core';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS case_versions(id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bounty_programs(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bounty_findings(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);`);
  }
  /** Only call after exclusively acquiring this workspace; read-only connections must not recover live runs. */
  recoverInterruptedRuns() { for (const run of this.runs()) if (run.state === 'running') this.saveRun({ ...run, state: 'completed', verdict: 'inconclusive', code: 'process_interrupted', reason: 'The process stopped during execution. No write was automatically retried.', finishedAt: new Date().toISOString() }); }
  cases(): CaseSpec[] { return (this.db.prepare('SELECT data FROM cases ORDER BY rowid DESC').all() as any[]).map(row => caseSchema.parse(JSON.parse(row.data))); }
  getCase(id: string, revision?: number): CaseSpec | undefined {
    const row = (revision === undefined ? this.db.prepare('SELECT data FROM cases WHERE id=?').get(id) : this.db.prepare('SELECT data FROM case_versions WHERE id=? AND revision=?').get(id, revision)) as any;
    return row ? caseSchema.parse(JSON.parse(row.data)) : undefined;
  }
  saveCase(input: CaseSpec, expectedRevision?: number): CaseSpec {
    const current = this.getCase(input.id);
    if (current && expectedRevision !== current.revision) throw Object.assign(new Error('The case changed. Reload before saving this revision.'), { statusCode: 409 });
    if (!current && expectedRevision !== undefined) throw Object.assign(new Error('Case no longer exists'), { statusCode: 409 });
    const spec = caseSchema.parse({ ...input, revision: current ? current.revision + 1 : 1 });
    const data = JSON.stringify(spec);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO cases(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(spec.id, spec.revision, data);
      this.db.prepare('INSERT INTO case_versions(id,revision,data) VALUES(?,?,?)').run(spec.id, spec.revision, data);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return spec;
  }
  runs(): RunResult[] { return (this.db.prepare('SELECT data FROM runs ORDER BY rowid DESC LIMIT 100').all() as any[]).map(row => JSON.parse(row.data)); }
  getRun(id: string): RunResult | undefined { const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id) as any; return row ? JSON.parse(row.data) : undefined; }
  saveRun(run: RunResult) { this.db.prepare('INSERT INTO runs(id,case_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id, run.caseId, JSON.stringify(run)); }
  setting<T>(key: string, fallback: T): T { const row = this.db.prepare('SELECT data FROM settings WHERE key=?').get(key) as any; return row ? JSON.parse(row.data) : fallback; }
  setSetting(key: string, data: unknown) { this.db.prepare('INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(data)); }
  chats(): ChatSession[] { return (this.db.prepare('SELECT data FROM chats ORDER BY updated_at DESC LIMIT 200').all() as any[]).map(row => JSON.parse(row.data)); }
  getChat(id: string): ChatSession | undefined { const row = this.db.prepare('SELECT data FROM chats WHERE id=?').get(id) as any; return row ? JSON.parse(row.data) : undefined; }
  saveChat(chat: ChatSession) { this.db.prepare('INSERT INTO chats(id,updated_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data').run(chat.id, chat.updatedAt, JSON.stringify(chat)); }
  deleteChat(id: string) { this.db.prepare('DELETE FROM chats WHERE id=?').run(id); }
  programs(): BountyProgram[] { return (this.db.prepare('SELECT data FROM bounty_programs ORDER BY updated_at DESC LIMIT 100').all() as any[]).map(row => bountyProgramSchema.parse(JSON.parse(row.data))); }
  getProgram(id: string): BountyProgram | undefined { const row = this.db.prepare('SELECT data FROM bounty_programs WHERE id=?').get(id) as any; return row ? bountyProgramSchema.parse(JSON.parse(row.data)) : undefined; }
  saveProgram(input: BountyProgram): BountyProgram {
    const parsed = bountyProgramSchema.parse({ ...input, updatedAt: new Date().toISOString() });
    this.db.prepare('INSERT INTO bounty_programs(id,updated_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data').run(parsed.id, parsed.updatedAt, JSON.stringify(parsed));
    return parsed;
  }
  deleteProgram(id: string) { this.db.prepare('DELETE FROM bounty_programs WHERE id=?').run(id); }
  findings(): BountyFinding[] { return (this.db.prepare('SELECT data FROM bounty_findings ORDER BY updated_at DESC LIMIT 500').all() as any[]).map(row => bountyFindingSchema.parse(JSON.parse(row.data))); }
  getFinding(id: string): BountyFinding | undefined { const row = this.db.prepare('SELECT data FROM bounty_findings WHERE id=?').get(id) as any; return row ? bountyFindingSchema.parse(JSON.parse(row.data)) : undefined; }
  saveFinding(input: BountyFinding): BountyFinding {
    const parsed = bountyFindingSchema.parse({ ...input, updatedAt: new Date().toISOString() });
    this.db.prepare('INSERT INTO bounty_findings(id,updated_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data').run(parsed.id, parsed.updatedAt, JSON.stringify(parsed));
    return parsed;
  }
  deleteFinding(id: string) { this.db.prepare('DELETE FROM bounty_findings WHERE id=?').run(id); }
  close() { this.db.close(); }
}
