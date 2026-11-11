# Case format v1

A `.reprocase.json` package contains `format: "reprocase"`, `schemaVersion: 1`, an export timestamp, a `CaseSpec`, optional historical evidence, and redaction notes. It is JSON data. Import does not execute code, open a target, or start a run. Unknown executable fields are rejected by strict schemas.

`CaseSpec` defines:

- `actors`: symbolic actor IDs, labels/colors, expected roles when relevant, and an HTTP identity probe with JSON Pointer locations for identity, tenant, and role.
- `origins`: symbolic API origins. Their actual addresses are supplied locally at run time.
- `policy`: the researcher-declared access rule and explicit acknowledgement. A declared rule is distinct from a live observation.
- `preconditions`: observed account relationships such as different identities and different tenants.
- `resources`: a producing preparation step, the expected owner actor, and references to freshly observed resource ID/owner/tenant values.
- `steps`: typed HTTP operations in preparation, probe, verification, or cleanup phases, with response captures and checks.
- `witness`: explicit success conditions and explicit rejection conditions. A status code alone is insufficient for a positive confidentiality/access witness.

The complete executable example is [cross-tenant.reprocase.json](../examples/cross-tenant.reprocase.json).

## References are typed values

A sole object such as `{ "$ref": "captures.documentId" }` resolves to a value observed in the current run. It is not a JavaScript expression. References can resolve to scalar or JSON values; request path/header binding imposes additional scalar checks. JSON Pointer captures preserve the response value’s type.

Typical namespaces are `actors.owner.id`, `actors.researcher.tenant`, `captures.documentId`, `steps.cross-tenant-read.status`, `steps.cross-tenant-read.body.marker`, and `run.marker`.

For a positive read witness, a non-owner GET/HEAD response must contain the current run's marker from a freshly prepared resource. An owner successfully reading their own resource does not establish disclosure. Controlled write cases can supply `witness.writeProof` with `resource`, `probe`, `before`, `after`, `fieldPointer`, and `mutationPointer`: the case independently observes the owner's state before and after a single non-owner mutation. The before observation must differ from the new marker, and the owner-side after observation must confirm it. A success status without that observed state change is insufficient.

For a path `/documents/{document}`, define `pathParams.document` as a reference to `captures.documentId`. The runner encodes it as one path component. Query parameters and JSON body fields have their own explicit value slots. String replacement across arbitrary request text is not used.

## Local bindings are separate

`BindingProfile` associates symbolic actors with local browser or direct API sessions. Credentials are not carried in `CaseSpec`. Authentication and transport headers cannot be injected as arbitrary case headers. Every selected API origin is an explicit run-time mapping.

The local actor’s identity is checked before its relationships are used. Source identity/resource values from an imported recording do not establish a new result. A new resource must be prepared and its ownership observed for the fresh-setup path.

## Evidence and verdicts

`RunResult` records the exact case revision, timestamps, request count, observed checks, steps, result, and explanation. It records `created_this_run` setup provenance. The package is a portable workflow and a local observation, not an independent notary attestation.

There are three verdicts: `reproduced`, `not_reproduced`, and `inconclusive`. Failed identity checks, missing captures, expired sessions, unsupported transports, and ambiguous network outcomes must not be converted into a negative security finding. The evidence inside a shared package remains historical until the recipient runs the case.

## Current boundaries

The engine operates on normalized HTTP/JSON requests. It does not preserve wire-level header duplication, raw protocol parsing behavior, races, WebSocket sequences, arbitrary scripts, or a whole browser application's behavior. OAuth/device-bound or browser-specific sessions may not transfer to API requests. A user can hand off login or receive an inconclusive result; a stored trace is not a substitute for live authentication.
