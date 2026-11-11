import { createServer } from 'node:http';
export async function modelServer() {
  const received: any[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'local-contract-test', name: 'Local test model', capabilities: { reasoning: { effort: ['low', 'high'] } } }] })); return; }
    try {
      let body = ''; for await (const chunk of request) body += String(chunk);
      const payload = JSON.parse(body); received.push(payload);
      if (payload.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Provider-returned test summary.', content: 'A safe plan: create fresh resources, verify ownership, then test the boundary.\n\n<script>window.__chatXSS=true</script>' }, finish_reason: null }] }) + '\n\n');
        response.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: {prompt_tokens:20,completion_tokens:30} }) + '\n\ndata: [DONE]\n\n'); return;
      }
      const name = payload.tools?.[0]?.function?.name;
      let args: unknown = { ok: true };
      if (name === 'propose_case') { const source = JSON.parse(payload.messages.find((m: any) => m.role === 'user').content).case; args = { caseJson: JSON.stringify({ ...source, title: `${source.title} · reviewed` }), explanation: 'A title-only proposal from the local test adapter.', warnings: [] }; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'local-test', object: 'chat.completion', model: 'local-contract-test', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'tool-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
    } catch (e) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: String(e) } })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { baseURL: `http://127.0.0.1:${(server.address() as any).port}/v1`, received, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
