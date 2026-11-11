import { randomUUID } from 'node:crypto';
import type { Approval } from '@reprocase/core';

export type PermissionMode = 'ask' | 'auto_edit' | 'autonomous';

export class Permissions {
  private pending = new Map<string, { request: Approval; outsideWorkspace?: boolean; resolve: (decision: 'allow' | 'deny' | 'steer') => void }>();
  private trusted = new Set<string>();
  private mode: PermissionMode = 'ask';
  private saveMode?: (mode: PermissionMode) => void;

  constructor(initialMode: PermissionMode = 'ask', saveMode?: (mode: PermissionMode) => void) {
    this.mode = initialMode;
    this.saveMode = saveMode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode, persist = true): PermissionMode {
    this.mode = mode;
    if (persist) this.saveMode?.(mode);
    if (mode === 'autonomous') {
      for (const item of this.pending.values()) item.resolve('allow');
    } else if (mode === 'auto_edit') {
      for (const item of this.pending.values()) {
        if (this.isAutoEditSafe(item.request.tool, item.outsideWorkspace)) item.resolve('allow');
      }
    }
    return this.mode;
  }

  private isAutoEditSafe(tool: string, outsideWorkspace = false): boolean {
    if (outsideWorkspace) return false;
    if (tool.startsWith('reprocase_') || tool.startsWith('recon_') || tool.startsWith('bounty_') || tool.startsWith('filesystem_')) return true;
    return false;
  }

  list(sessionId?: string) {
    return [...this.pending.values()].map(x => x.request).filter(x => !sessionId || x.sessionId === sessionId);
  }

  async ask(
    sessionId: string,
    tool: string,
    input: unknown,
    reason: string,
    signal: AbortSignal,
    notify: (a: Approval) => void,
    options?: { outsideWorkspace?: boolean },
  ) {
    if (signal.aborted) throw new Error('Action cancelled');
    if (this.mode === 'autonomous') return;
    if (this.mode === 'auto_edit' && this.isAutoEditSafe(tool, options?.outsideWorkspace)) return;
    if (
      this.trusted.has('*:' + tool) ||
      this.trusted.has(sessionId + ':' + tool) ||
      (tool.startsWith('desktop_') && (this.trusted.has(sessionId + ':computer') || this.trusted.has('*:computer')))
    ) {
      return;
    }
    if (signal.aborted) throw new Error('Action cancelled');
    const request: Approval = {
      id: `approval-${randomUUID()}`,
      sessionId,
      tool,
      input,
      reason,
      createdAt: new Date().toISOString(),
    };
    const decision = await new Promise<'allow' | 'deny' | 'steer'>(resolve => {
      const done = (value: 'allow' | 'deny' | 'steer') => {
        signal.removeEventListener('abort', abort);
        this.pending.delete(request.id);
        resolve(value);
      };
      const abort = () => done('deny');
      this.pending.set(request.id, { request, outsideWorkspace: options?.outsideWorkspace, resolve: done });
      signal.addEventListener('abort', abort, { once: true });
      notify(request);
    });
    if (decision === 'steer') {
      throw Object.assign(new Error('Skipped waiting for approval because a new user message arrived. Replan with the latest user message.'), { steered: true });
    }
    if (decision !== 'allow') {
      throw new Error(signal.aborted ? 'Action cancelled' : 'The user declined this action');
    }
  }

  decide(id: string, choice: 'once' | 'session' | 'computer' | 'always' | 'autonomous' | 'deny') {
    const item = this.pending.get(id);
    if (!item) throw new Error('This approval is no longer pending');
    if (choice === 'autonomous') {
      this.setMode('autonomous');
      return;
    }
    if (choice === 'always') {
      this.trusted.add('*:' + item.request.tool);
    }
    if (choice === 'session') {
      this.trusted.add(item.request.sessionId + ':' + item.request.tool);
    }
    if (choice === 'computer') {
      if (!item.request.tool.startsWith('desktop_')) throw new Error('Computer permission applies only to desktop tools');
      this.trusted.add(item.request.sessionId + ':computer');
    }
    item.resolve(choice === 'deny' ? 'deny' : 'allow');
  }

  clear(sessionId: string) {
    for (const key of this.trusted) if (key.startsWith(sessionId + ':')) this.trusted.delete(key);
    for (const item of this.pending.values()) if (item.request.sessionId === sessionId) item.resolve('deny');
  }

  dismissPending(sessionId: string) {
    for (const item of this.pending.values()) if (item.request.sessionId === sessionId) item.resolve('steer');
  }

  close() {
    for (const item of this.pending.values()) item.resolve('deny');
    this.trusted.clear();
  }
}
