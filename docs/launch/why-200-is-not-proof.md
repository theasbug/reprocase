# Why HTTP 200 is not an authorization proof

*A walkthrough of the owned local ReproCase demo. Written with AI assistance and verified against the executable demo. This is not a disclosure about a third-party application.*

An authorization report needs to establish what another account could actually access. A status code is one observation. It does not establish who owns an object, which account sent the request, or whether the response contains the owner's private data.

[OWASP's BOLA guidance](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/) focuses on authorization checks for the specific object being accessed. The practical question for reproduction is whether the second account crossed the case's declared boundary for a resource whose ownership has been observed.

## A response that proves little

Imagine another account requesting a private document and receiving this illustrative response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","message":"This response proves no access"}
```

The server returned 200. It did not return the private document or a value known to come from it. Calling this a confirmed IDOR would skip the central observation.

A 403 is also insufficient on its own to characterize a fix. If the session expired before setup, or the supposedly different accounts are actually the same identity, the reproduction never established its prerequisites.

## Build evidence that survives a new pair of accounts

The ReproCase local demo uses a private-document policy: only the owner should be able to read the document. A member of another tenant should receive the declared rejection response.

1. Query each account's live identity. Confirm that the two identities and tenants differ.
2. Fetch the owner's current CSRF value.
3. Create a new private document under the owner with a unique marker for this run.
4. Capture the new object ID and observe the owner and tenant returned by the application.
5. Confirm that the owner can read the resource and its marker.
6. Ask the other account to read that exact new resource.
7. Evaluate the returned marker and ownership evidence, then clean up the resource created by the run.

IDs and tokens are bound to declared request locations. They are not replaced indiscriminately throughout captured text. The case describes the roles and relationships; local bindings provide the current sessions.

The [recorded demo](https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo-56s-en.mp4) shows the same case revision producing **Reproduced**, then **Reproduced** again after refreshing both accounts. Switching the fixture to its secure implementation produces **Not reproduced**. The real recording used nine requests per run, including identity and setup checks; the number is a property of this demo, not a general requirement for every case.

## Preserve three distinct outcomes

- **Reproduced:** required prerequisites are satisfied and the declared violation witness is observed.
- **Not reproduced:** prerequisites are satisfied, the test completes and the case's non-violation conditions are met.
- **Inconclusive:** a session, dependency, preparation step, unsupported transport, network failure or missing evidence prevents a decision.

This distinction matters when someone reruns the report with a new account pair. A broken login should lead them toward account setup; an observed secure denial should lead them toward the tested access policy. Neither is a substitute for the other.

The researcher still defines and reviews the intended access policy. The engine can validate the declared checks; it cannot infer every application's legitimate business permissions. An AI assistant can help draft or inspect a case, while explicit core rules determine its verdict.

## Try the controlled example

Download the [Windows portable beta](https://github.com/theasbug/reprocase/releases/tag/v1.1.0-beta.1), extract it completely and open `ReproCase.exe`. Load the local demo, approve the reviewed case and target, inspect the preflight, then run it. Choose **Fresh identities** and repeat. Switch to **Secure target** for the comparison. The demo does not require an AI provider key.

From source, use Node.js 24.18+:

```sh
git clone https://github.com/theasbug/reprocase.git
cd reprocase
npm ci --ignore-scripts
npm run browsers:install
npm run demo
```

On Linux, first install Chromium's system dependencies with `npx playwright install-deps chromium`. Native computer control is implemented for Windows; source/web workflows on other platforms remain experimental.

## Share the scenario, review the evidence

Export through the in-app review screen. Known session values, captured IDs and markers are redacted or replaced with symbolic references where supported. A recipient binds their own local accounts and reruns the case. Review the package for unrelated confidential material before sharing it.

The primary proof format is `.reprocase.json`. Playwright exports run inside a ReproCase checkout and reuse the same runner. Hurl exports are request drafts without verdict assertions. These scopes are documented in [proof exports](../EXPORTS.md).

[Try the five-minute beta test](FEEDBACK.md) · [Source](https://github.com/theasbug/reprocase) · [Tested scope and known limits](../VERIFICATION.md)
