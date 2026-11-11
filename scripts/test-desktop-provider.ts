import { createServer } from '../apps/server/src/server.ts';
import { VERSION } from '@reprocase/core';
import { writeFileSync } from 'node:fs';
const key = process.env.REPROCASE_TEST_API_KEY;
if (!key) throw new Error('Set REPROCASE_TEST_API_KEY privately before this optional live test');
const requests: { path: string; sessionHeader: boolean; applicationAgent: boolean; status?: number }[] = [], sessions: string[] = [];
const server = await createServer({ memory: true, port: 0, providerFetch: async (url, init) => {
  const headers = new Headers(init?.headers), session = headers.get('x-opencode-session'); if (String(url).includes('/chat/completions') && session) sessions.push(session);
  const row = { path: new URL(String(url)).pathname, sessionHeader: !!session, applicationAgent: headers.get('user-agent') === `reprocase/${VERSION}`, status: undefined as number | undefined }; requests.push(row);
  const response = await fetch(url, init); row.status = response.status; return response;
} });
const report: Record<string, unknown> = { version: VERSION, testedAt: new Date().toISOString(), provider: 'OpenCode Go', model: 'longcat-2.5-free', requests };
try {
  const profile = await server.service.providers.save({ providerId: 'opencode-go', apiKey: key });
  const discovered = await server.service.providers.discover(profile.id); report.discoveredModels = discovered.models.length; report.reasoningMetadataModels = discovered.models.filter(m => m.efforts.length).length;
  const chat = server.service.chats.create();
  for (const [i, content] of ['Read the selected plan and suggest exactly two short implementation steps for the TypeScript app.', 'Summarize your previous advice in one short sentence.'].entries()) {
    server.service.chats.send(chat.id, { profileId: profile.id, modelId: 'longcat-2.5-free', content, ...(i === 0 ? { attachments: [{ name: 'plan.md', content: '# ReproCase desktop plan\nAdd automatic provider model discovery and saved chat sessions to the TypeScript Electron workbench.' }] } : {}) });
    while (server.service.chats.get(chat.id).messages.at(-1)?.status === 'streaming') await new Promise(r => setTimeout(r, 100));
    const result = server.service.chats.get(chat.id).messages.at(-1)!;
    if (result.status !== 'complete') throw new Error(result.error ?? 'Live chat failed');
    console.log(JSON.stringify({ stage: 'streamed_chat_turn', turn: i + 1, status: result.status, visibleCharacters: result.content.length }));
  }
  const chatResult = server.service.chats.get(chat.id);
  report.messageCount = chatResult.messages.length; report.stableConversationRouting = sessions.length === 2 && new Set(sessions).size === 1;
  report.credentialAbsentFromStoredConversation = !JSON.stringify(chatResult).includes(key); report.ok = true;
} catch (e) { report.ok = false; report.error = (e instanceof Error ? e.message : String(e)).split(key).join('[REDACTED]'); process.exitCode = 1; }
finally { await server.close(); }
const output = JSON.stringify(report, null, 2); if (output.includes(key)) throw new Error('Refusing to save a credential in the live-test report');
writeFileSync('docs/desktop-provider-live-test.json', output + '\n'); console.log(output);
