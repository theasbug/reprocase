# Desktop agent additions (0.4)

The Windows agent can operate the computer through backend tools. Workspace file operations run within the chosen directory; outside paths, terminal commands, MCP tools and computer control request human permission. A user may grant a tool or desktop-control permission for a chat session. This is a permission workflow, not an OS sandbox. A granted terminal or desktop tool can affect the user's computer.

The renderer remains sandboxed/context-isolated without Node integration. Its loopback API still requires the local token, Host and Origin checks. Only trusted renderer IPC can choose a file or workspace. Computer actions are serialized, mouse coordinates reference recent captures, and moved windows invalidate captures. Ctrl+Alt+Esc cancels active agent tasks. In-flight changes and detached apps cannot be rolled back automatically.

MCP configurations with environment/header credentials are stored through the Windows encrypted vault. Adding a server does not execute it; Connect is explicit. Connected third-party tool output is untrusted data. File contents, clipboard reads and supported screenshots can be transmitted to the selected provider when used as model context. Known secrets are redacted, but arbitrary confidential data is not automatically identified. Chats, backups and screenshots are local plaintext data; protect ReproCase-data accordingly.

## Previous case-engine security model: Security and data handling

ReproCase handles material that may contain live account credentials. It is designed for one local researcher or triager and systems they are authorized to test. It is not a multi-user hosting service.

## Trust boundaries

- The web service binds to loopback and authenticates management requests. Keep its bootstrap URL/token private. A malicious local process running as your user is outside the protection provided by a loopback token.
- Imported captures and packages are untrusted input. Imports parse data and create drafts. They do not execute shell commands, JavaScript expressions, or network calls. Running a package requires selected origins and a reviewed case revision.
- A scenario’s intended permission rule is supplied by its author. The tool checks observable prerequisites and the declared witness; it cannot discover a service’s complete intended access policy from traffic alone.
- Browser/AI page content is untrusted. AI suggestions are schema checked and do not determine the security verdict. The same core boundaries apply to the web interface, CLI, and MCP.

## Credentials and exports

Actor sessions and provider keys are held in memory by default. Exported cases use symbolic references instead of your account session. Recognized secret keys, known credential values, and observed runtime identity/resource bindings are masked in exported evidence. Reference objects used by the executable case are preserved.

Automatic redaction is not a complete PII detector. An application may return confidential business text in ordinary fields. Review the export preview before sharing. Do not attach the original HAR, browser storage state, environment files, or local workspace runtime metadata as if they were sanitized reports.

The optional remote AI provider receives selected sanitized material. It does not need to receive a login password to ask the local browser to fill a secret reference. Users choose the provider/endpoint and remain responsible for its data handling policy.

## Running tests against an application

Preparation and cleanup requests can change data. Use owned test resources, observe ownership, and keep test traffic inside the configured origin mapping. The runner does not retry ambiguous mutations automatically. Cancellation does not prove an already in-flight server operation was rolled back.

MFA, CAPTCHA, passkeys, device-bound credentials, unusual CSRF binding, redirects, and third-party identity providers may require a manual handoff or remain unsupported. Do not weaken the target's settings merely to turn an inconclusive test into a positive result.

## Reporting a problem

This source distribution does not configure a public issue tracker or security contact. Until the project owner publishes one, report issues privately to the person who supplied the project. Remove credentials and personal information from reproduction material. Do not assume that a repository issue is a private reporting channel.
