import { z } from 'zod';
export const providerIds = ['openai', 'anthropic', 'gemini', 'deepseek', 'opencode-go', 'opencode-zen', 'openrouter', 'groq', 'mistral', 'custom'] as const;
export const protocols = ['responses', 'chat', 'anthropic'] as const;
export type ProviderId = typeof providerIds[number];
export type Protocol = typeof protocols[number];
export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = typeof efforts[number];
export interface ModelInfo { id: string; name: string; efforts: Effort[]; effortSource: 'metadata' | 'documented' | 'unknown'; contextWindow?: number; supportsVision?: boolean; }
export interface ProviderProfile { id: string; providerId: ProviderId; label: string; baseURL: string; protocol: Protocol; hasKey: boolean; remembered: boolean; models: ModelInfo[]; modelsUpdatedAt?: string; error?: string; }
export const providerInputSchema = z.strictObject({ id: z.string().regex(/^provider-[0-9a-f-]{36}$/).optional(), providerId: z.enum(providerIds), apiKey: z.string().max(4096).optional(), baseURL: z.string().max(2000).optional(), protocol: z.enum(protocols).optional(), label: z.string().trim().min(1).max(100).optional() });
export const attachmentSchema = z.strictObject({ name: z.string().min(1).max(200), content: z.string().max(500000) });
export type ChatAttachment = z.infer<typeof attachmentSchema>;
export interface ToolActivity { id: string; name: string; input: unknown; output?: string; status: 'running' | 'approval' | 'completed' | 'error' | 'cancelled'; startedAt: string; finishedAt?: string; approvalId?: string; evidenceIds?: string[]; }
export interface TokenUsage { input?: number; output?: number; reasoning?: number; total?: number; source: 'provider'; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; status: 'complete' | 'streaming' | 'cancelled' | 'error' | 'queued'; attachments?: ChatAttachment[]; error?: string; modelId?: string; providerId?: string; reasoning?: string; reasoningText?: string; activities?: ToolActivity[]; usage?: TokenUsage; elapsedMs?: number; generationMs?: number; tokensPerSecond?: number; }
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; profileId?: string; modelId?: string; reasoning: string; messages: ChatMessage[]; }
export const chatInputSchema = z.strictObject({ profileId: z.string(), modelId: z.string().min(1).max(200), reasoning: z.enum(['auto', ...efforts]).default('auto'), content: z.string().trim().max(30000), attachments: z.array(attachmentSchema).max(8).default([]), caseId: z.string().optional() }).refine(input => !!input.content || input.attachments.length > 0 || !!input.caseId, 'Add a message or a selected attachment');
