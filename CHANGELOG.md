# Changelog

## 1.1.0-beta.1

- Fixed URL scope boundaries and unknown-program fail-open behavior; exclusions retain their path boundaries.
- Central request policy for managed scans and case execution: program-wide rate limiting, budgets, cancellation and manual redirects. Added Stop network scans.
- Pending outside-workspace approvals remain pending when switching to Auto-Edit.
- Playwright exports reuse the core runner and real session transport; denied or invalid preparation fails. Hurl is explicitly a request draft.
- Program headers are session-only, excluded from SQLite metadata and agent output.
- Fixed GraphQL error false positives, structural HAR cookie parsing, strict CVSS validation and visible inconclusive scan state.
- Windows/Linux CI, packaged Windows smoke, dynamic Chromium manifest, non-overwriting package output, aligned versions, source contribution/security documentation.


## 1.0.0 — Full-Scope Bug Bounty Platform, 6 Built-in Security Engines, CVSS v3.1 & AI Co-Pilot

- **Full-Scope Bug Bounty Command Center (`BountyCenter.tsx`, `packages/core/src/bounty.ts`):**
  - **Program & Scope Engine:** Manage bug bounty programs (HackerOne, Bugcrowd, Intigriti, YesWeHack, Custom) with wildcard `inScope` / `outOfScope` rules (`*.example.com`, `https://api.example.com/*`) and deterministic `checkScope` validation.
  - **FIRST.org CVSS v3.1 Base Score Calculator & Finding Tracker:** Interactive CVSS v3.1 calculator (`AV/AC/PR/UI/S/C/I/A` vector string & base score) and SQLite-backed finding tracker (`bounty_findings`) with one-click HackerOne/Bugcrowd Markdown export.
- **6 Built-in Security Automation Tools (`packages/core/src/bounty-tools.ts`):**
  - **Subdomain & Live Asset Discovery (`discoverSubdomains`):** Certificate Transparency (`crt.sh`) enumeration, scope filtering, and optional live HTTP status/server probing.
  - **Active Security Audit Pack (`runSecurityAuditPack`):** Automated checks for CORS arbitrary origin & `Origin: null` reflection with credentials, HTTP method enumeration (`OPTIONS`/`TRACE`), GraphQL introspection, exposed API schemas, and security headers.
  - **JWT & Session Token Security Analyzer (`analyzeJwtToken`):** Decodes header/payload, checks `alg: none`, `kid`/`jku`/`x5u` injection vectors, weak HMAC secret brute-force, missing `exp`, and auto-suggests ReproCase `IdentitySpec` JSON Pointers (`idPointer`, `tenantPointer`, `rolePointer`).
  - **JS Bundle, Source Map & GraphQL Operation Analyzer (`analyzeJsBundle`):** Extracts API routes, GraphQL queries/mutations, `sourceMappingURL`, and leaked secrets directly from JavaScript bundles.
  - **Passive Traffic, Secret & Cookie Security Auditor (`auditTrafficSecurity`):** Scans HTTP traffic/HAR/headers for AWS, GitHub, Slack, Stripe, Google API keys, private keys, insecure cookies (`HttpOnly`/`Secure`/`SameSite`), and internal IP disclosures.
  - **Security CLI Toolchain Detector (`detectToolchain`):** Auto-detects local installations and versions of `nuclei`, `subfinder`, `httpx`, `ffuf`, `nmap`, `sqlmap`, `hurl`, `curl`, `python`, and `git`.
- **AI Co-Pilot & Autonomous Execution (`apps/server/src/harness.ts`, `apps/server/src/permissions.ts`):**
  - Added 10 `bounty_*` agent tools (`bounty_program_list`, `bounty_program_save`, `bounty_scope_check`, `bounty_asset_discover`, `bounty_security_pack`, `bounty_jwt_analyze`, `bounty_traffic_audit`, `bounty_js_audit`, `bounty_finding_save`, `bounty_toolchain_status`) and 3 `recon_*` tools.
  - Added 3-tier execution permission modes (`ask`, `auto_edit`, `autonomous` / "⚡ Sınırsız Yetki") and non-blocking mid-task follow-up message injection across OpenAI, Anthropic, and Responses adapters.
  - Added `/bounty`, `/audit`, `/jwt`, `/assets`, `/cvss`, `/toolchain`, and `/recon` slash commands plus 1-click AI Co-Pilot handoff from the Bug Bounty Command Center.

## 0.5.0 — Protocol extensions, role matrix, traffic importers, and bounty exports

- GraphQL (`POST /graphql` read/write probes), `application/x-www-form-urlencoded` and `multipart/form-data` request bodies.
- Extended condition operators (`gt`, `gte`, `lt`, `lte`, `regex`, `not_contains`) and concurrent step execution (`concurrency`: parallel barrier and sequential bursts) for race-condition / TOCTOU verification.
- Multi-actor Role Matrix runner (`executeMatrix`, `/api/cases/:id/matrix`, CLI `matrix`, MCP `run_matrix`) evaluating all non-owner actors against freshly created resources.
- Burp Suite XML (`burp`) and Postman Collection v2.1 (`postman`) traffic importers plus multi-actor live traffic correlation (`importMultiActorTraffic`, `/api/cases/:id/traffic/draft`, MCP `traffic_draft`).
- HackerOne/Bugcrowd-ready Bug Bounty Markdown report (`renderBountyReport`), standalone Hurl (`.hurl`) and Playwright (`.spec.ts`) script exporters.
- AI Agent browser/traffic/matrix tools (`reprocase_browser_snapshot`, `reprocase_browser_action`, `reprocase_traffic_draft`, `reprocase_matrix`) and unified line diffs with one-click backup restoration (`filesystem_rollback` / `/api/agent/backups/:id/restore`).

## 0.4.0 — Windows agent harness

- Shared multi-round tool agent for Chat Completions, Responses and Claude Messages. Local file read/search/edit with checked revisions and backups; PowerShell commands and native app launch.
- Windows screenshots, monitor/window inventory and management, mouse movement/click/drag/scroll, Unicode typing/key chords, async clipboard and UI Automation inspection/actions. Recent screenshot coordinates and a serialized desktop action queue.
- Explicit permission cards, per-tool or computer permissions for the current session, and Ctrl+Alt+Esc emergency stop.
- MCP client management for stdio and Streamable HTTP with encrypted local configuration and tool integration.
- Follow-up messages while working, visible reasoning fields supplied by providers, tool outputs and actual provider usage/speed.
- Composer model picker, slash commands, workspace/prompt settings and a searchable 21-chapter TR/EN manual.
- Provider networking uses Electron networking on desktop; interrupted streams and uncertain changes are not automatically retried.

## 0.3.0 — Windows desktop alpha

- Native Electron window with the existing runner, bundled Chromium, loopback API and SQLite.
- Highlighted AI Assistant, separate conversation view, saved sessions, streaming, cancellation, searchable model picker and supported reasoning levels.
- Provider/API-key setup with automatic model discovery for OpenAI, Claude, Gemini, DeepSeek, OpenCode Go/Zen, OpenRouter, Groq and Mistral; custom endpoints in Advanced.
- Windows-encrypted keys and native file attachments without a general renderer filesystem/shell bridge.
- Button press feedback, dialog/content transitions and reduced-motion support.
- All 0.2 authoring, preflight, comparison and CLI/MCP features retained. Linux remains a future verified build target.

## 0.2.0

- Guided authoring for fresh-resource read disclosure and controlled-write cases, including before/after owner observations, optional CSRF and cleanup.
- Read-only preflight showing origins, account bindings, revision/budget errors, data-changing steps, dependencies and request estimates. The execution service enforces its blocking checks across UI, CLI and MCP.
- Recorded run comparison with verdicts, check changes, HTTP outcomes, bounded JSON Pointer field differences, revision attribution and JSON download.
- CLI `create`, `plan`, `compare`; MCP `case_build`, `run_plan`, `run_compare`.
- OpenCode Go session routing and application user agent, a LongCat preset and a model-connection test button. Real LongCat connection and case-proposal calls verified; provider secrets remain in memory.
- CaseSpec and `.reprocase.json` package schema stay at version 1. Existing exported cases remain importable. The default port stays 4317; this delivery's side-by-side demo uses 4318.

## 0.1.0

Initial local prototype: shared deterministic runner, account/resource relationships, isolated Chromium sessions, capture import, sanitized packages/reports, optional AI, CLI/MCP and controlled vulnerable/secure lab.
