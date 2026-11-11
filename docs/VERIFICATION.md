# 1.1.0-beta.1 verification

Local Windows x64 verification on 11 November 2026, Node 24.18.0 / Electron 45.2.3. Case/package schema stays at version 1.

- TypeScript: passed. Web and Electron main production compilation: passed.
- 137 Vitest tests across 12 files: passed. New regressions cover URL/path/scheme/port scope, exclusions, redirects, missing program, program-header privacy, pending outside-folder approvals, shared rate limiting, abort before/during dispatch, GraphQL errors, standard HAR cookies and invalid CVSS.
- Proof export was executed as a real Playwright test: all-403 preparation fails; vulnerable fixture reproduces; secure fixture passes only when not_reproduced is expected; secure fixture fails when reproduced is expected. This reuses executeCase and BrowserManager.
- Five Chromium product flows passed, including an owned HTTP fixture proving zero out-of-scope traffic, visible inconclusive scan state and user Stop cancellation. Stale menu-count and sidebar selectors were corrected.
- The Windows release is built with its installed Chromium revision in a generated manifest, rather than looking for an old release folder. Packaged-executable validation uses isolated local data, encrypted-key persistence/restart, the shared runner and the bundled account browser.

## Release scope

Hosted results are reported separately in [GitHub Actions](https://github.com/theasbug/reprocase/actions/workflows/ci.yml): Linux/Windows source checks and Windows packaging/smoke. The README badge reflects the actual hosted status; local results alone do not establish a green workflow. Linux/macOS native computer control is not delivered. No second physical Windows machine was tested. No live remote model or external bounty target was contacted for these fixes; AI transport contracts use an owned local provider. Earlier Beam/provider records are historical, not current-beta live-model verification.

Program custom header values are session-only, excluded from new SQLite program metadata and agent output. Legacy on-disk backups/WAL pages may still retain earlier values; this release does not erase old copies. Rate/scope policy applies to ReproCase-managed API scans and case execution, not arbitrary terminal commands, desktop user interactions or external MCP servers. Cancellation cannot undo effects of a request already dispatched.

Hurl is explicitly a request draft, not a proof. Playwright proofs require a ReproCase source checkout and locally supplied test-account credentials. Recon results remain heuristic candidates. Concurrency/matrix support follows the declared case and single-owner model; it is not a universal race detector.

## Known release limitations

Windows binaries are unsigned. The pre-publication dependency audit on 11 November 2026 found zero runtime advisories and five moderate affected development-package records from glob/minimatch in the Electron packaging chain; these were not force-downgraded. No application security certification is implied by a clean dependency audit.

Only clean source files and application files belong in release archives. ReproCase-data, .browsers, node_modules and local credentials are excluded from the source archive. Source and portable binary are distributed separately with SHA-256 checksums. This is a beta candidate, not a stable-security guarantee.
