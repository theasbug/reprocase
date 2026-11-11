# Fresh-account reproduction benchmark

The comparison is designed to measure reproducibility and editing effort, not to claim that a workflow language is universally better or that an HTTP `200` proves impact.

## Fixture and baseline

Use the project's local demo only. It exposes identity and CSRF probes, creates a private document containing a fresh controlled marker, and can either enforce or intentionally violate the cross-tenant access boundary.

The [positive Hurl baseline](../examples/cross-tenant.hurl) and [explicit-denial baseline](../examples/cross-tenant-denied.hurl) manually define identity probes, relationship assertions, preparation, owner check, cross-tenant read, and cleanup. Hurl is an existing capable request-chain/assertion tool. ReproCase adds authoring, actor binding, relationship/provenance validation, portability checks, tri-state evaluation, and reports around the workflow.

## Included measured run

[report.md](../benchmark-results/report.md) and [summary.json](../benchmark-results/summary.json) contain the completed local experiment. The harness ran 16 trials: two independent account pairs per tool for each vulnerable/secure and cookie/Bearer combination. Both tools produced all eight expected outcomes. Every trial confirmed distinct accounts/tenants, newly provisioned identities, unchanged templates, exactly two resource writes (create/delete), and cleanup.

The run used the official portable Hurl 8.1.0 Windows release. Its downloaded ZIP was verified against the publisher's SHA-256 file; provenance, the executable's version output, and source hashes are recorded in the machine-readable summary. The executable itself is not vendored in this source project.

To repeat the experiment, set `HURL_BIN` to your verified Hurl executable and run `npx tsx scripts/benchmark.ts`. Optionally set `HURL_SOURCE_METADATA` to a JSON provenance record containing the download URL and verified digest. The script launches its own local fixture and does not contact an external test target or model API. Hurl receives credentials through environment variables; raw Hurl JSON is inspected in memory and is not persisted. Generated placeholder-only recipe variants are stored under the ignored local workspace.

## Procedure

1. Start `npm run demo`. Record the fixture origin shown by the workbench.
2. Use a pair of controlled member accounts from different tenants. Record whether both live identity probes and the declared relationship checks pass.
3. Run the same ReproCase revision against vulnerable mode. Record the verdict, reason, step count, and which bindings/preparation values were provided manually.
4. Bind a different pair of test accounts and run again. The document ID and marker must be new, with no source capture credentials or object IDs reused.
5. Repeat with a third account pair. Export each observation for independent inspection.
6. Switch to secure mode and repeat. A valid run must explicitly observe denial rather than label an authentication failure as a fixed finding.
7. Test the controls: same actor twice, wrong tenant relationship, expired session, missing resource producer, missing marker, and a network failure. Record their result classification.
8. Run the Hurl baseline using equivalent fresh tokens and a fresh marker. Count the manually supplied fields and any edits needed to update identity/resource relationships. Preserve the complete Hurl output and version.

Example Hurl invocation after installing Hurl separately:

```sh
hurl --test --variable base=http://127.0.0.1:FIXTURE_PORT \
  --variable owner_token=YOUR_OWNER_TOKEN \
  --variable researcher_token=YOUR_RESEARCHER_TOKEN \
  --variable marker=rc_A_NEW_UNIQUE_MARKER \
  examples/cross-tenant.hurl
```

Use your shell's multiline syntax or put the command on one line. The positive recipe expects vulnerable behavior. For secure mode, explicitly select `examples/cross-tenant-denied.hurl`, which asserts the fixture's access denial. A failed positive assertion is never evidence of a negative finding. Hurl's stop-on-error behavior can prevent cleanup after an unexpected failure, so remove the owned fixture resource or reset the demo before the next trial.

## Record and publish

For each trial, record the implementation revision, fixture mode, auth mode, whether identity/ownership prerequisites passed, whether the violation witness was observed, the final classification, manual binding edits, request count, and cleanup outcome. Separate machine-measured results from human timing or judgment. Do not include token values in the record.

No wall-clock performance or originality claim is made by this procedure. The recorded zero template edits apply to this automated harness, not to a human productivity measurement. Supplied-binding lists document this authored configuration; the fact that the Hurl baseline accepts an explicit marker is not a claim that Hurl cannot generate dynamic values. If Hurl is unavailable in another test environment, state that it was not executed there rather than copying the included results as a new run.
