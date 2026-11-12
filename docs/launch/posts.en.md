# ReproCase — English X posts

Entries marked draft are not published. Dates use Europe/Istanbul.

## 2026-11-11 — launch (published)

Fresh accounts. Reproducible proofs.

I built ReproCase to rerun IDOR/BOLA cases with new accounts and resources.

56s demo. Open source. No API key needed for the local demo.

https://github.com/theasbug/reprocase

Looking for 5 beta testers. #bugbounty

## 2026-11-12 — http-200 (published)

Published: https://x.com/theasbug/status/2120894107145159159

HTTP 200 alone does not prove an IDOR.

Who owns the resource? Are the accounts different? Did the other account read this run's fresh marker?

The local ReproCase walkthrough:
https://github.com/theasbug/reprocase/blob/main/docs/launch/why-200-is-not-proof.md
#AppSec

## 2026-11-15 — beta-feedback (draft)

Trying ReproCase? My first request: run the local demo, refresh identities, repeat, then enable Secure target.

Tell me which step was confusing. No API key or private target captures needed.
https://github.com/theasbug/reprocase/issues/new/choose

## 2026-11-18 — resource (draft)

Fresh accounts also need fresh resources.

ReproCase creates a controlled document, binds its new ID, verifies ownership and checks a fresh marker. The case keeps its roles when sessions change.

https://github.com/theasbug/reprocase
#bugbounty

## 2026-11-20 — windows-fix (draft)

A real beta fix: Windows CI exposed a PowerShell startup hang caused by the stripped runtime environment.

ReproCase now preserves standard Windows shell variables while keeping an allowlist. Hosted Windows/Linux checks passed.
https://github.com/theasbug/reprocase/actions

## 2026-11-22 — three-results (draft)

A failed login is not a secure denial.

ReproCase separates Reproduced, Not reproduced and Inconclusive. Identity/setup failures should point back to setup rather than masquerading as a completed security test.

https://github.com/theasbug/reprocase

## 2026-11-25 — sharing (draft)

Share the scenario, then connect your own sessions.

ReproCase exports reviewed case packages with symbolic account/resource bindings. Recipients provide local sessions and create fresh evidence. Always review unrelated confidential content before sharing.
https://github.com/theasbug/reprocase

## 2026-11-27 — exports (draft)

Export details matter.

ReproCase Playwright proofs reuse its runner inside a source checkout. Missing preparation fails. Hurl exports are request drafts without security verdict assertions.

https://github.com/theasbug/reprocase/blob/main/docs/EXPORTS.md

## 2026-11-29 — case-policy (draft)

An authorization case needs an explicit policy.

ReproCase checks the identities, ownership and witness you declare. The researcher still reviews the intended access boundary.

A local demo is included:
https://github.com/theasbug/reprocase
#AppSec

## 2026-12-02 — ai-core (draft)

ReproCase includes an AI assistant for investigation and case drafting. Explicit core checks determine reproduction verdicts.

You can try the local proof workflow without connecting any model provider.

https://github.com/theasbug/reprocase

## 2026-12-04 — sessions (draft)

Cookie and Bearer sessions need verified actor bindings. ReproCase keeps Chromium account contexts separate and performs live identity checks before evaluating the case.

Try it with the disposable local accounts:
https://github.com/theasbug/reprocase

## 2026-12-06 — next-feedback (draft)

What would make fresh-account reproduction easier in your workflow: account binding, resource setup, or reviewing the evidence?

ReproCase is an open-source beta. Minimal local reproductions and setup feedback help shape the next release.
https://github.com/theasbug/reprocase
