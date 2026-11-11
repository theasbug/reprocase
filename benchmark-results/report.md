# Measured fresh-account comparison

Recorded 2026-11-10T18:14:13.166Z. Node v24.18.0, win32. hurl 8.1.0 (Windows) libcurl/8.23.0 Schannel zlib/1.3.2 nghttp2/1.70.0. ReproCase 0.3.0.

The controlled local fixture was exercised in vulnerable and secure modes, using both cookie and Bearer sessions. Each tool received two independently provisioned identity pairs per mode/auth cell. No external target or paid model API was used.

ReproCase: 8/8 expected verdicts. Hurl: 8/8 expected recipe outcomes.

All freshness, distinct-identity, tenant, unchanged-template, cleanup, and two-resource-write checks passed: yes.

## Observations

- reprocase / vulnerable / cookie / fresh pair 1: reproduced; expected reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / vulnerable / cookie / fresh pair 1: reproduced; expected reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / vulnerable / cookie / fresh pair 2: reproduced; expected reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / vulnerable / cookie / fresh pair 2: reproduced; expected reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / vulnerable / bearer / fresh pair 1: reproduced; expected reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / vulnerable / bearer / fresh pair 1: reproduced; expected reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / vulnerable / bearer / fresh pair 2: reproduced; expected reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / vulnerable / bearer / fresh pair 2: reproduced; expected reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / secure / cookie / fresh pair 1: not_reproduced; expected not_reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / secure / cookie / fresh pair 1: not_reproduced; expected not_reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / secure / cookie / fresh pair 2: not_reproduced; expected not_reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / secure / cookie / fresh pair 2: not_reproduced; expected not_reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / secure / bearer / fresh pair 1: not_reproduced; expected not_reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / secure / bearer / fresh pair 1: not_reproduced; expected not_reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- reprocase / secure / bearer / fresh pair 2: not_reproduced; expected not_reproduced; 9 HTTP requests in the test workflow; cleanup confirmed; template edits 0.
- hurl / secure / bearer / fresh pair 2: not_reproduced; expected not_reproduced; 7 HTTP requests in the test workflow; cleanup confirmed; template edits 0.

## What this comparison establishes

- These observations measure the declared fixture scenarios, not general vulnerability detection or universal correctness.
- Both tools support fresh bound workflows. Hurl uses an explicitly authored violation or denial recipe; a failing positive assertion is never classified as a negative finding.
- The harness supplies a new marker to this authored Hurl baseline; ReproCase generates it internally. This is not a claim that Hurl cannot generate dynamic values.
- Manual template edits are zero for both tools in this automated harness; supplied-binding lists document configuration inputs, not measured human effort or completion time.
- ReproCase sends extra live identity rechecks. Request counts therefore differ and are not a speed comparison.
- Credentials and literal observed account/resource values are not included in the persisted results. Hurl raw JSON is inspected in memory and not saved.

## Reproduce

Set HURL_BIN to a verified Hurl executable and run `npx tsx scripts/benchmark.ts` from this project. The script starts and closes its own local fixture. The checked-in positive and denial Hurl recipes use placeholders; actor credentials are passed to the child process through environment variables. Spawn uses no shell. Optional HURL_SOURCE_METADATA points to the binary provenance JSON.

The complete machine-readable results, source hashes, binary provenance, check outcomes, and sanitized ReproCase observations are in [summary.json](summary.json). No wall-clock speed or human productivity claim is made.
