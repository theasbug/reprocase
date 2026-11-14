# Quick proof: writes, roles and CORS

Write proofs normally need five inputs: API origin, owner account A, challenger B, a creation request and the suspected mutation request. JSON Pointers are inferred. A single correction panel asks only for a missing owner-read request or a field choice.

## Controlled writes

Choose **Access between accounts**. Paste a disposable-object POST and a PATCH, PUT or POST that changes it. JSON/form encoding and object identifiers in the path, query or body are supported. The supplied object's ID is replaced with a newly captured ID; the original object is not modified. Ambiguous different identifiers are refused.

Learning calibrates the supplied operation on one temporary object as A. Each proof run creates a separate authorized-control object and a fresh challenge object: **A reads before → B attempts one mutation → A reads after**. Free text uses a fresh marker; numeric, boolean and fixed values use an exact observed transition. A 200 alone is insufficient. An independently observed change can prove the effect even after an error response; uncertain mutations are never automatically retried.

Cleanup targets only objects created by this run. Review cleanup errors for remaining objects. Stop sends no further requests, including cleanup requests.

## Function / role authorization

Choose **Role / operation authorization**. A is authorized and B should be denied according to the policy you review. Live role fields are inferred, with a field picker for corrections. Role names are not assigned an automatic privilege hierarchy.

For a read, leave creation empty and paste a GET such as `/admin/report`. The authorized live response, anonymous control and lower-role response are compared. A private field absent from the anonymous response must be observed by B. For writes, supply a creation and a mutation bound to the new test object. Equal/changing roles, the same account and different observed organizations do not establish a role violation. Global irreversible administration actions are outside this first workflow.

## Browser CORS proof

Choose **CORS**, sign in normally in the single account browser, and paste an authenticated GET such as `/private`. Each run checks a same-origin authenticated baseline, an anonymous control, JavaScript reads from a locally fulfilled `https://reprocase-probe.invalid` document and an opaque sandbox `null` origin, then rechecks the baseline and identity.

Only data readable by attacker-page JavaScript is proof. Target responses use the real network. CORS headers or privileged API-client reads alone are insufficient. Browser security, TLS, cookie SameSite and third-party-cookie policies remain enabled; known Bearer tokens are never injected into attacker requests.

This version requires a signed-in cookie browser session, not a raw token/header/Cookie binding. Local-network permissions, third-party-cookie policy or network failures may limit the test. Ambiguous failures are inconclusive. A negative result applies only to the recorded origins and Chromium context. Test-lab local-network permissions are not automatically granted by the application.

## Packages and automation

New proof types use v2 packages; existing v1 cases continue unchanged. Imports reset policy acknowledgement. Recipients bind their own accounts and run a new verification.

CLI run/plan/validate/compare/export use the same engine. For CORS, supply a local Playwright storage-state file as `browserState` in the binding profile; `env:REPROCASE_SECRET_STATE` can supply its path. Treat that file as a credential. It is never exported. Generated Playwright proofs use `REPROCASE_BROWSER_STATE_OWNER`. They retain the exported program scope/exclusions and rate limit; an explicit `REPROCASE_PROGRAM` JSON can supply the recipient’s reviewed policy. Session-only program authentication headers are never embedded. Hurl is unavailable for CORS because it cannot prove browser readability.

MCP provides `quickproof_start`, `quickproof_open_browser`, `quickproof_identity`, `quickproof_observe` and `actor_restore_browser_state`. Observation returns `ready` or `needs_input`; it does not replace policy/revision approval and a final run.

See the three `templates/quick-*-v2.reprocase.json` examples. Development-only regeneration: `node --import tsx scripts/generate-proof-examples.ts`.
