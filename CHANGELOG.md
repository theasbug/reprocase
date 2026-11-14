# Changelog

## Unreleased

- **Easier to read.** Small interface text is larger throughout (labels, badges, step lists, chat), with the same layout on desktop and mobile.
- **"Next step" guide** on every case: shows the first unfinished step (acknowledge the policy, enter the target, connect accounts, approve and run) with a short hint.
- **Import dialog** groups its tabs into *Evidence* (HAR, raw HTTP, Burp, Postman, package) and *IDOR leads* (Arjun, ffuf).
- **Quick proof: Sign in** option. ReproCase opens a separate browser window where you sign in normally, with nothing to copy. When no identity endpoint is found, the wizard lists every path it tried with each account's status and explains a 401.

## 1.1.0-beta.4

- **Quick proof.** A four-step wizard that turns two test accounts and two pasted requests into a case. It finds the identity endpoint and fields by comparing both accounts. From one observed creation it learns the new object's ID, owner and a marker field, detects CSRF tokens, previews the other account's access, cleans up and saves an unacknowledged case. Corrections are made by picking fields; no JSON Pointers. It is the primary action on the start screen and on IDOR candidates. API: `/api/quickproof/*`.
- **Verify on my site** for triagers. An imported package binds every account to one origin with a header, token or cookie. If the identity endpoint differs, it is detected and saved as a new revision. API: `/api/cases/:id/verify-on-site`.
- Account sessions can use any custom auth header (for example `X-Auth-Token`, `Authorization: Token …`), not only Bearer tokens and cookies.
- New `steps.<id>.text` reference: the bounded raw response. A read witness can check that the response contains the run marker anywhere, so no response field location is needed.
- Imported packages no longer carry the reporter's policy acknowledgement. Imported and recon drafts no longer require a `/role` identity field.
- A second test lab with a differently shaped API (`tests/fixtures/alt-api.ts`). It proves inference end to end: reproduced, not reproduced, cross-user and same-person inconclusive.

## 1.1.0-beta.3

- **IDOR candidates from Arjun and ffuf.** Import evidence has new **Arjun** (`-oJ`) and **ffuf** (`-of json`) tabs. The output is ranked offline by identifier signals: ID-like parameter names, object IDs in paths, and fuzzed IDs that returned 2xx. Each lead becomes a case draft with one click. Also available as `cli candidates FILE [--draft N]` and the MCP tool `idor_candidates`. Captured cookies and tokens are never copied.
- GitHub Actions updated (upload-artifact v7, attest-build-provenance v4, setup-java v6, docker/login-action v4). Dependabot opens only minor/patch npm updates.
- Dependencies: electron 45.3.0, lucide-react 0.577, actions/setup-node v7.

## 1.1.0-beta.2

- README focused on the core promise: reproducible IDOR/BOLA proofs. Added a 30-second case walkthrough, an audience section, download verification and a note on how the project is built. AI and recon extras moved into a collapsible section.
- Added `templates/` with schema-valid horizontal IDOR (read/write) and vertical privilege (BFLA) cases.
- Added a tag-triggered release workflow that builds, smoke-tests and checksums the Windows archive, records a GitHub build-provenance attestation and creates a draft release.
- Added Dependabot configuration and resolved moderate `minimatch`/`glob` advisories in Electron packaging dependencies (`npm audit`: 0).
- Added a Docker image and `compose.yaml` (web workbench, case runner and demo lab with headless Chromium). The new `REPROCASE_LISTEN_HOST` variable lets the service listen on all interfaces inside a container. Host, Origin and token checks still only accept loopback clients. CI builds and smoke-tests the image, and tagged releases publish it to GHCR with provenance.
- Added a Burp Suite extension (`integrations/burp`, Montoya API) with **Send to ReproCase** in the context menu. It imports the selected requests as a case draft through the local API and refuses non-loopback addresses. CI builds the jar, and releases attach it.
- Moved the "HTTP 200 is not proof" article to `docs/articles/` and the beta checklist to `docs/BETA-TEST.md`. Removed maintainer campaign files from the repository.

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
