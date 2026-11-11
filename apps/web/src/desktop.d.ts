import type { ChatAttachment } from '../../../packages/core/src/assistant.ts';
declare global { interface Window { reprocaseDesktop?: { platform: string; pickTextFile(): Promise<ChatAttachment | null>;pickWorkspace():Promise<unknown>; appInfo(): Promise<{ version: string; platform: string; desktop: boolean }> }; } }
export {};
