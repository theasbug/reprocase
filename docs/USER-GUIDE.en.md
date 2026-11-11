# ReproCase 1.1 beta

## 1. What is ReproCase?

Imagine finding a security issue. You want another person to check it with their own test accounts. ReproCase turns that experiment into a case containing accounts, resources, requests, setup steps and evidence.

Example: Alice creates a private note. Bob should not be able to read it. If Bob reads the unique content of a newly created note, there may be an access control issue. HTTP 200 alone is not proof. ReproCase repeats the experiment with fresh accounts and resources.

AI Assistant is your agent in this workspace. It can read files, edit code, run commands and use Windows applications. Explicit case rules determine the security verdict. Start with the local demo to learn the workflow.

## 2. Extract and start

Right-click the Windows ZIP and choose Extract All. Run ReproCase.exe from the extracted folder, rather than inside the archive. You do not need Node.js, Python or Docker for the bundled app. Its runtime and Chromium are included.

ReproCase runs locally. ReproCase-data appears beside the executable and contains cases, chats, settings and backups. Keep this folder. Before upgrading, close the app and back it up; retain the previous version separately.

Use the language button at the top for Turkish or English, and the theme button to change appearance. AI Assistant opens chat. Workbench returns to your cases.

## 3. Provider and API key

A provider runs the model. Open AI Assistant → Providers & API keys. In normal mode, choose a provider and paste its API key. Save and discover models. Treat an API key like a password: keep it out of public repositories, screenshots and reports.

Presets include OpenAI, Anthropic, Gemini, DeepSeek and OpenCode Go/Zen. Choose the advanced/custom mode for your own server or another endpoint. That mode also asks for a Base URL and protocol. Usually the Base URL ends in /v1; do not append /chat/completions yourself.

Discovering a model does not guarantee inference access. Pricing, quota, region and permissions depend on your provider account. On Windows, saved keys use Windows encryption tied to the current user. You may need to enter keys again on another computer.

## 4. Models, reasoning and vision

Click Model below the message box. Search by provider or model name, then select an entry. Reasoning is a separate control. A disabled reasoning control simply means the selected model does not advertise adjustable effort.

Auto uses the provider default. Supported effort levels can affect time and cost. The model stays fixed during a running task. Stop the task or wait for it to finish before switching.

Understanding screenshots requires a model with image input. Text models can still use window lists, accessibility trees, terminal and files; captured images remain visible to you. Refresh discovery if vision capabilities are missing. Tool-calling support also varies by model.

## 5. Your first conversation

Start a new session and ask: “Hello, which tools do you have in this environment?” Then try: “List the working directory and read plan.md if it exists.” Give a full path for files outside that directory.

On Windows, “Open Notepad” can launch the real app. “Find the Notepad window, inspect it and type Hello into the blank document” exercises computer control. Review the requested action card and allow it. Start with a blank test document.

The paperclip attaches a text file’s contents to your message, which sends those contents to the model. Add case includes the current case definition. Mentioning a filename alone does not attach it; the agent needs to read it with a tool.

## 6. Working directory and files

Choose folder under Tools & environment to set the agent working directory. The default is ReproCase-data/projects. Select your project folder before working on it. /workspace opens the same panel.

The agent can list, read, search and write text files. It reads an existing file before editing; a content hash prevents overwriting a file that changed meanwhile. Previous contents are backed up under ReproCase-data/backups.

Access outside the working directory requests permission. Terminal and computer permissions can allow broader actions. A backup is not an automatic undo: inspect it and explicitly restore the earlier contents when needed.

## 7. Actions and permissions

Each action appears as a tool card. Expand it to inspect the tool, arguments and actual output. An error card is not a successful action. You can check tool evidence before trusting a written summary.

Permission cards offer Allow once, This tool: for this session, and Deny. Computer tools also offer Computer: for this session, covering desktop_ tools in that chat. The agent cannot approve its own request.

Review terminal commands and MCP arguments before execution. Grant session permissions for the work you intend. A new chat has separate permissions. Stop also dismisses pending requests.

## 8. Computer control

Windows tools cover windows and monitors, screenshots, focus/move/resize/minimize/maximize, pointer movement/click/drag/scroll, Unicode typing, key chords and the text clipboard. Accessibility can inspect controls and invoke, select, toggle or set values on supported elements.

Mouse actions reference a recent screenshot. Image pixels are translated to physical screen coordinates. Moving a window or using an old image requires a new capture. Prefer the relevant window over a full-screen capture.

Using the mouse and keyboard yourself at the same time may change focus. Emergency stop: Ctrl + Alt + Esc. Windows may reject input to UAC or elevated applications. This release does not bypass those boundaries. Linux computer control is not implemented yet.

For image-capable models, a captured image is sent to the chosen provider. Close unrelated private windows or target a specific test window. Images are kept in ReproCase-data/screenshots and shown in the tool card.

## 9. Terminal and applications

terminal_run uses PowerShell on Windows and starts in the working directory. The agent can inspect a project or run tests. The command appears in a permission card. Read it before allowing it.

Commands have a time limit. Cancellation attempts to stop the process tree created by the tool. Files already written, requests already sent, and detached applications are not rolled back. An uncertain changing action is not automatically repeated.

There are direct launch shortcuts for Notepad and Calculator. Other applications can be used through terminal, accessibility or computer tools. External MCP servers may require separately installed runtimes such as Python or Node.

## 10. Steer and stop a running agent

You can send another message while the agent works. It appears as Queued. The agent receives it at the next action boundary after the current model reply or tool finishes. New steering dismisses pending permissions and replans actions that have not started.

For example, send “Do not delete the file; only show its contents.” A message cannot undo an action already started. Use the square Stop button or Ctrl + Alt + Esc for an urgent stop. Queued messages are cancelled too.

Sessions can run independently, but the desktop has one pointer and keyboard. Run physical desktop tasks sequentially. Open a session from history to inspect a longer task.

## 11. Reasoning, tokens and speed

If the provider returns reasoning text or a summary, it appears under Reasoning. Some providers return a short summary; others return none. The app does not invent missing text or decode encrypted internal reasoning.

Hover over a reply footer or focus it with the keyboard to inspect input/output tokens, elapsed time and tok/s. A token is a small unit processed by the model; it is not always a whole word.

Speed is provider-reported output tokens divided by model request time. Tool execution and permission waits are excluded; initial response latency is included. Missing usage is shown as unreported rather than estimated. Usage from multiple tool rounds is combined.

## 12. Slash commands

Type / in the composer to open the command menu. /help opens this guide; /mcp opens connections; /model opens models; /workspace and /tools open the environment. /new starts a chat; /stop cancels the current task.

/plan, /scope, /case, /repro, /compare and /report prepare prompts for research plans, scope, cases, reproduction, comparisons and reports. /read, /terminal and /computer prepare file, command and desktop tasks. Fill in the details and send.

Commands are shortcuts to normal agent tasks and permissions. /report does not publish a report. /scope does not expand run targets automatically. Choose targets separately and approve them in the run plan.

## 13. Add and manage MCP

MCP is a standard way to connect other programs’ tools to the agent. Type /mcp or open MCP. Name the server. For a local program choose stdio, enter its command and one argument per line. For a remote service choose HTTP and enter its MCP endpoint.

Example command: npx. Separate argument lines might be -y, @modelcontextprotocol/server-filesystem, and the full directory you want to allow. This example downloads and runs an external package; inspect its source first. Save stores a configuration. Connect is a separate, explicit action that starts it.

If needed, enter environment variables or HTTP headers as JSON, such as {"API_KEY":"..."} or {"Authorization":"Bearer ..."}. Windows encrypts the configuration. Saved secret values are not returned to this screen. Disconnect before changing or replacing a server.

Connected tools appear with status and names. The agent can choose them alongside built-in tools; calls use the same action cards and permission system. Disconnect stops the connection, and Remove deletes its configuration. This release supports stdio and Streamable HTTP, not legacy SSE or OAuth setup.

## 14. Local demo: first experiment

Return to Workbench and start the local demo. It runs on your computer without a customer system. Bind the test accounts to the case roles. Check that identities are distinct and ownership is correct.

Open a fresh run plan and verify its target is the local demo. Setup creates a new resource, the test tries access as another account, and verification checks its unique content. Approve the plan, run it and inspect each timeline step.

Switch the demo to secure mode and repeat. With correct setup, the same package should report Not reproduced. Compare the runs to understand the difference between a fixed issue and invalid preparation.

## 15. Create or import a case

Use the new case wizard to name the case, set its API origin, describe account roles and state the expected access policy. Roles can be owner and other. The relationships should retain their meaning with new accounts.

Import HAR, raw HTTP or selected Chromium traffic. Importing alone sends no network requests. Replace old cookies, tokens and object IDs with explicit dependencies before sharing. Review AI suggestions before applying them.

Separate setup, test, verification and cleanup. Extract a fresh resource ID from JSON with a JSON Pointer, then bind it to an explicit path, header or JSON-body location. Arbitrary text substitution and executable JavaScript or shell inside packages are unsupported.

## 16. Accounts, organizations, MFA and CSRF

Each role has its own isolated Chromium context. Open a login window and sign in yourself. Assisted login hands control back for MFA or CAPTCHA and continues in the same session afterwards.

Direct binding is experimental and supports cookies, Bearer tokens or a defined HTTP login recipe. A connected session is not necessarily the correct role. Compare observed user, role and organization against the case requirements.

Binding the same account twice or selecting a wrong organization invalidates the experiment. Preconditions separate those failures. Extract fresh CSRF values from setup responses rather than copying old values. A changed identity after session refresh must stop the run.

## 17. Read the verdict correctly

Reproduced means required preconditions passed and the defined violation witness was observed, for example another account reading the unique contents of the new private note.

Not reproduced means setup was valid, the test completed, and its witness was absent. It describes this experiment, not a guarantee that the entire application is secure.

Inconclusive means a wrong account, missing setup, timeout, network failure or insufficient evidence blocked evaluation. Do not report this as a fix. Resolve the first failing precondition and start a new run.

A changing request interrupted by an uncertain network error is not automatically retried. Check whether its resource was created before choosing the next action. Inspect cleanup outputs too.

## 18. Reports, sharing and comparison

Choose two runs under Compare. Repeats with different accounts help demonstrate independence from old object IDs. A secure-version comparison tests whether the witness incorrectly produces a positive result.

Preview the sanitized .reprocase.json package and HTML/Markdown report under Export. Known secrets are removed, but unknown private data can remain; review the contents yourself. Local account bindings stay outside the shareable package.

AI chat or a desktop screenshot is not automatically security proof. Connect report claims to observations from the case run. Share through your research program’s chosen channel yourself; the app does not automatically send it.

## 19. Agent context and mission

The agent mission lives in prompts/AGENT.md. Tools & environment shows the active prompt and lets you save a local override. Reset to default removes that override. For a clear test of changes, stop a running task and send a new message.

The prompt introduces ReproCase, bug bounty research and software development. Actual OS, working directory and available tools are added for each task. The agent knows it has file and application tools. The chosen provider and model retain their own behavior rules.

Files, pages and tool outputs are treated as data. A document saying “ignore previous instructions” is not a user instruction. Models can still make mistakes; inspect important action inputs and outputs.

## 20. Common errors

401: check the key and provider. 403: check model permissions or regional access. 429: inspect quota, balance and rate limits in the provider dashboard. 400: check the protocol and supported model settings. OpenCode session routing headers are added by the app.

Provider connection failed / fetch failed: check internet, VPN/proxy and certificates. The Windows desktop app uses Electron networking for provider requests. Certificate validation remains enabled. If only one provider fails, check that service too.

Local service unavailable: verify the app is open, restart it if necessary, and reopen the session from history. A truncated reply stays incomplete. Partial output is retained; generation and changing actions are not automatically retried.

Missing or failing tools: use Test connection to check model tool support. For MCP, verify Connected status and server requirements. If Windows refuses focus, make the target window visible and retry. Share version, tool name and sanitized errors in a bug report, without keys.

## 21. Tasks to try

Files: “Read plan.md in the working directory and explain its first three steps. Do not edit files yet.” Code: “Find this project’s test command, show it and run it after I allow it.”

Desktop: “Open Notepad, find its window and inspect its accessibility tree. Type ReproCase test in the blank document without saving.” Vision: “Capture only this test window and describe its buttons.”

Security: “Explain this case’s roles, ownership relationships and witness rule. List missing preconditions.” Reporting: “Summarize the last run, separating observed results from assumptions. Do not send it anywhere.”

Start with one small task and extend it after checking the outputs. Capabilities depend on the provider, model tool support and the local permissions you grant.

## 22. Program scope, rate and cancellation

In Bug Bounty Center → Program & Scope, name the program. A host rule such as *.example.com also includes example.com in this app. A URL rule such as https://api.example.com/v2/* keeps its exact scheme, port and path boundary. It does not allow /admin or another port. Exclusions win.

Maximum requests per second is shared across managed scans for a program. Out-of-scope requests are blocked and redirects are not followed. A root-origin scan can be blocked by path-only scope; use appropriate case steps instead of broadening the rules.

Optional HTTP headers are entered as JSON and held in memory. Their values stay out of model output and new program database records. Enter them again after restarting. Historical backups from older releases may still hold legacy data.

Stop network scans cancels managed reconnaissance. Ctrl+Alt+Esc stops agent tasks and scans. Already-started server changes are not undone. Terminal and external MCP tools can act outside these target policies. Autonomous mode is not computer isolation.

## 23. Proof tests and request drafts

The primary portable proof is .reprocase.json. The recipient binds their own accounts and creates fresh resources through the same core. Wrong accounts or failed setup are inconclusive, not reproduction.

Place a Playwright export under tests/e2e in a ReproCase source checkout. After npm ci, set REPROCASE_APPROVE_REVISION to the reviewed revision and provide account token/cookie environment variables. The file header and docs/EXPORTS.md explain the details. Expected verdict defaults to reproduced; set REPROCASE_EXPECT_VERDICT=not_reproduced for a secure application.

All responses being 403 is not a successful proof test. Missing identity or setup fails the test. Hurl output is an HTTP request draft without security verdict assertions; a green Hurl exit is not evidence.