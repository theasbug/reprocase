<p align="center"><img src="docs/images/banner.svg" alt="ReproCase — Fresh accounts. Reproducible proofs." width="100%"></p>

<h1 align="center">ReproCase</h1>

<p align="center"><strong>HTTP 200 is not proof of an IDOR. ReproCase checks whether the boundary was actually crossed.</strong></p>

<p align="center">
  <a href="https://github.com/theasbug/reprocase/actions/workflows/ci.yml"><img alt="Build and tests" src="https://github.com/theasbug/reprocase/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/theasbug/reprocase/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/theasbug/reprocase?include_prereleases&label=release&color=a59aff"></a>
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-6bd5ad"></a>
  <img alt="No API key needed for the demo" src="https://img.shields.io/badge/demo-no%20API%20key-72b7ff">
</p>

<p align="center">
  <a href="https://github.com/theasbug/reprocase/releases"><strong>Download for Windows</strong></a> ·
  <a href="#docker-linux-macos-windows">Docker</a> ·
  <a href="integrations/burp/">Burp extension</a> ·
  <a href="https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo-56s-en.mp4">56s demo</a> ·
  <a href="templates/">Case templates</a> ·
  <a href="docs/QUICKSTART.tr.md">Türkçe</a>
</p>

<p align="center"><a href="https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo-56s-en.mp4"><img src="docs/images/demo-highlights.gif" alt="Recorded local demo: reproduced, reproduced again with fresh accounts, then not reproduced on the secure target." width="1000"></a></p>

<p align="center"><sub>Recorded from the real local app, no API key. <b>Reproduced</b> → fresh accounts → <b>Reproduced</b> → secure target → <b>Not reproduced</b>. <a href="https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo-56s-en.mp4">Full 56s recording</a>.</sub></p>

## The problem

You found an IDOR. Then the triager replies **"could not reproduce"**: your cookies expired, the object ID belonged to yesterday's account, or the two "different" accounts turned out to be in the same tenant.

ReproCase turns the finding into a **case**: a small JSON file that anyone can run with **their own accounts and newly created resources**. On every run it checks three things:

| | Check | Why it matters |
|---|---|---|
| 1 | **Who are the actors?** Live identity, role and tenant probes | A wrong account is not a failed reproduction |
| 2 | **Who owns the object?** It is created fresh in this run, and ownership is observed | No reliance on stale IDs |
| 3 | **Was the boundary crossed?** The other account must read *this run's* unique marker | A 200 with an empty body proves nothing |

Every run ends in exactly one verdict: **`reproduced`**, **`not_reproduced`**, or **`inconclusive`**. An expired session or a failed setup is reported as inconclusive, so it can never pass as a fix.

## Who it is for

- **Bug bounty hunters.** Attach a case that proves itself and avoid "N/A, cannot reproduce".
- **Triagers and program owners.** Rerun a report with your own test accounts in seconds.
- **AppSec teams.** Keep the case as a regression check and rerun it after the fix.

## Try it in two minutes

### Windows portable

1. Download the newest **`ReproCase-<version>-Windows-x64.zip`** from [Releases](https://github.com/theasbug/reprocase/releases) and extract the **whole** archive into a writable folder.
2. Open `ReproCase.exe` and load the built-in local demo. Review the accounts and the access policy, approve, then run. The expected result is **Reproduced**.
3. Choose **Fresh identities** and run again (still **Reproduced**). Switch to **Secure target** and run again (**Not reproduced**).

The app bundles Electron and Chromium, so you do not need Node.js, Python or Docker. The executable is **not code-signed yet**. Check the archive before you run it ([how to verify](#verify-a-download)).

### Docker (Linux, macOS, Windows)

~~~sh
git clone https://github.com/theasbug/reprocase.git
cd reprocase
docker compose up
~~~

Open the `http://localhost:4317/#token=…` URL from the logs. The container starts the built-in demo lab with headless Chromium, and data is kept in the `reprocase-data` volume. The port is published on `127.0.0.1` only. For your own targets, change the compose `command` to `serve`.

### Run from source (Linux, macOS, Windows)

Requires **Node.js 24.18+**.

~~~sh
git clone https://github.com/theasbug/reprocase.git
cd reprocase
npm ci --ignore-scripts
npm run browsers:install
npm run demo
~~~

Open the local URL printed by the command. On Linux, first run `npx playwright install-deps chromium`. The web workbench and the case runner work on every platform. Native desktop control is Windows-only.

## A case in 30 seconds

~~~jsonc
{
  "policy":        { "statement": "A private document is readable only by its owner." },
  "preconditions": [ { "op": "neq", "left": {"$ref": "actors.owner.tenant"}, "right": {"$ref": "actors.researcher.tenant"} } ],
  "steps": [
    { "id": "create-document", "actor": "owner",      "method": "POST", "path": "/documents", "body": { "marker": {"$ref": "run.marker"} } },
    { "id": "probe",           "actor": "researcher", "method": "GET",  "path": "/documents/{document}" }
  ],
  "witness": {
    "success":   [ { "op": "eq", "left": {"$ref": "steps.probe.body.marker"}, "right": {"$ref": "run.marker"} } ],
    "rejection": [ { "op": "in", "left": {"$ref": "steps.probe.status"},      "right": [403, 404] } ]
  }
}
~~~

<sub>Simplified. See the full executable [example](examples/cross-tenant.reprocase.json) and the [case format](docs/CASE-FORMAT.md).</sub>

Start from a template in [`templates/`](templates/): horizontal IDOR (read and write) and vertical privilege escalation. Cross-tenant read and write cases are in [`examples/`](examples/). Import a HAR, raw HTTP, Burp XML or Postman capture to draft a case from your own traffic.

### From Burp Suite in one click

Install the [ReproCase Burp extension](integrations/burp/), then right-click any request in Proxy history or Repeater and choose **Send to ReproCase**. The selection becomes a case draft. Nothing is sent to the target until you bind your accounts and run it.

## What is inside

- **Proof engine.** Isolated Chromium account contexts, cookie or Bearer bindings, live preflight, JSON Pointer captures, read and controlled-write cases, actor matrices and run comparisons.
- **Sharing.** Sanitized `.reprocase.json` packages without credentials (recipients bind their own accounts), plus HTML/Markdown reports and Playwright proof exports.
- **CLI and MCP.** `import`, `validate`, `run`, `compare` and `export` commands and a stdio MCP server that use the same services as the UI. See the [CLI docs](docs/CLI.md).

<details>
<summary><strong>Optional extras: AI assistant and bug bounty utilities</strong></summary>

<br>

**AI assistant (bring your own model, off by default).** Use it to investigate and draft cases. The verdict always comes from the deterministic checks above, never from the model. It supports OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Groq, Mistral and compatible local endpoints, along with local file tools, terminal access, Windows desktop control and MCP servers. Tool actions ask for approval by default. Auto-edit and autonomous modes are explicit opt-ins. [Provider details](docs/AI-PROVIDERS.md).

**Bug bounty utilities.** Program scope and exclusions, rate limits and request budgets, bounded CT/HTTP discovery, JWT/JS/traffic helpers, a CVSS v3.1 calculator and a finding tracker. Nuclei, subfinder, httpx, ffuf, nmap and sqlmap are detected when installed but not bundled.

</details>

<details>
<summary><strong>See a vulnerable → secure run comparison</strong></summary>

<p align="center"><img src="docs/images/comparison.png" alt="Local demo comparing reproduced and not-reproduced authorization runs with step-level evidence" width="1000"></p>

</details>

## Security model

- The local service binds to loopback only and requires authentication. Importing a capture never sends a request.
- Cases are declarative JSON. They contain no JavaScript or shell. Unknown fields are rejected.
- Credentials are kept out of cases and redacted from shared evidence. Saved desktop credentials use Windows OS encryption.
- Scope, exclusions, budgets and rate limits apply to every request that ReproCase itself sends. The optional AI terminal and desktop tools and external MCP servers are **not** sandboxed by that policy. **Ctrl+Alt+Esc** stops active agent work.

Never publish your `ReproCase-data` folder, sessions or private captures. See [SECURITY.md](SECURITY.md) and [tested behavior and limitations](docs/VERIFICATION.md).

### Verify a download

Each release ships a `SHA256SUMS.txt` file:

~~~powershell
Get-FileHash .\ReproCase-*-Windows-x64.zip -Algorithm SHA256
~~~

Releases built by the [release workflow](.github/workflows/release.yml) also carry a signed GitHub build-provenance attestation. It proves that the archive was built from this repository's source by GitHub Actions:

~~~sh
gh attestation verify ReproCase-<version>-Windows-x64.zip --repo theasbug/reprocase
~~~

## Development

TypeScript · npm workspaces · Fastify · React/Vite · Zod · SQLite · Playwright · Electron.

~~~sh
npm run typecheck && npm test && npm run test:e2e
~~~

GitHub Actions tests the source on Linux and Windows, then packages and smoke-tests the Windows executable. Desktop details are in [docs/DESKTOP.md](docs/DESKTOP.md) and release checks in [docs/RELEASE-CHECKS.md](docs/RELEASE-CHECKS.md).

**About how it is built.** ReproCase is developed with heavy use of AI coding assistants. Verdicts come from deterministic, tested core checks, and [VERIFICATION.md](docs/VERIFICATION.md) separates what has been tested from what has not. Reviews and bug reports are especially welcome.

## Documentation and community

- [English guide](docs/USER-GUIDE.en.md) · [Türkçe kılavuz](docs/USER-GUIDE.tr.md) · [Türkçe hızlı başlangıç](docs/QUICKSTART.tr.md)
- [Case format](docs/CASE-FORMAT.md) · [Templates](templates/) · [CLI](docs/CLI.md) · [Proof exports](docs/EXPORTS.md) · [Desktop](docs/DESKTOP.md) · [Changelog](CHANGELOG.md)
- [Why HTTP 200 is not proof](docs/articles/why-200-is-not-proof.md) · [Five-minute beta test](docs/BETA-TEST.md)
- [Contribute](CONTRIBUTING.md) · [Report a bug](https://github.com/theasbug/reprocase/issues/new/choose) · [Security reporting](SECURITY.md)

The most useful contributions right now are **new case templates for real-world IDOR patterns**, minimal local reproductions, provider compatibility reports (without keys) and translations. If ReproCase saves you a "could not reproduce", a ⭐ helps other researchers find it.

## License

[Apache-2.0](LICENSE). Built on Playwright, Electron and the MCP TypeScript SDK. [Hurl](https://hurl.dev/) is a great tool for request replay. ReproCase focuses on preserving account and resource relationships and validating evidence when the accounts change.
