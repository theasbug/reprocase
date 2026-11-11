# Proof exports (1.1 beta)

Use .reprocase.json with the shared runner as the primary portable case.

## Playwright

The exported .spec.ts imports @reprocase/core and @reprocase/browser from a ReproCase source checkout. Place it under tests/e2e. It uses executeCase and BrowserManager, including identity, fresh resource, ownership and witness validation. It requires the reviewed revision through REPROCASE_APPROVE_REVISION, approved origin mapping (embedded or REPROCASE_TARGETS JSON), and REPROCASE_TOKEN_<ACTOR> or REPROCASE_COOKIE_<ACTOR>.

PowerShell example for the standard owner/researcher demo, using fresh locally obtained test-account tokens:

~~~powershell
$env:REPROCASE_APPROVE_REVISION='1'
$env:REPROCASE_TOKEN_OWNER='your-owner-test-token'
$env:REPROCASE_TOKEN_RESEARCHER='your-other-test-token'
npx playwright test tests/e2e/exported.spec.ts
~~~

Do not put these values in the spec or commit them. Default expected verdict is reproduced. Set REPROCASE_EXPECT_VERDICT=not_reproduced to validate a secure fixture. Inconclusive is never a passing expected verdict. Test output attaches the core's sanitized RunResult. Running can create/delete test resources.

## Hurl

Hurl export is a request draft. It does not implement all identity/precondition/witness rules, and a successful Hurl exit is not proof. The header and UI label say so. Adapt it manually for independent experiments.
