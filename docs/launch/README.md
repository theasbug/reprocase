# ReproCase launch kit

**Fresh accounts. Reproducible proofs.**

The first public demo uses the real local application, two disposable accounts and the unchanged case revision. It records `reproduced`, `reproduced` after refreshing accounts, and `not_reproduced` after enabling the secure fixture. No model provider or API key is configured.

- [Watch the 56-second demo](https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo-56s-en.mp4)
- [English captions](https://github.com/theasbug/reprocase/releases/download/v1.1.0-beta.1/ReproCase-demo.en.srt)
- [Published launch post](https://x.com/theasbug/status/2120583234086228135) — pinned to the maintainer's profile.
- [Why HTTP 200 is not an authorization proof](why-200-is-not-proof.md)
- [English posts](posts.en.md) · [Turkish posts](posts.tr.md)
- [Community routing and human-written submissions](COMMUNITY.md)
- [First-five tester checklist](FEEDBACK.md)
- [Four-week content calendar](calendar.csv)

The calendar is an editorial schedule. Future posts are drafts, not scheduled or published actions. User feedback is published only with permission and after it actually arrives. The 1,000-star goal is an aspiration, not a promised result or deadline.

## Re-record the demo

From a source checkout with Node 24.18+:

```sh
npm ci --ignore-scripts
npm run browsers:install
npm run build
node --import tsx scripts/record-launch-demo.ts
node scripts/render-launch-demo.mjs .cache/launch-demo .cache/launch-demo/rendered
```

Rendering requires FFmpeg with libass/libx264 and ffprobe on PATH. These are maintainer video-production tools; users of ReproCase do not need FFmpeg. Optional variables: `REPROCASE_RECORD_OUT`, `REPROCASE_CHROMIUM_EXECUTABLE`, `PLAYWRIGHT_BROWSERS_PATH`, `REPROCASE_SOURCE_COMMIT`, `REPROCASE_FFMPEG`, `REPROCASE_FFPROBE`.

The recording helper checks live verdicts, a stable revision, changed accounts, the reviewed export and page errors. Captions are burned into a separate lower band. The UI evidence is not replaced with simulated results. Raw video and temporary files stay in `.cache`; inspect every new recording before sharing it.

## Weekly review

Run `node scripts/campaign-metrics.mjs --output .cache/campaign` using an authenticated GitHub CLI with access to this repository's traffic data. It records aggregate stars, forks, asset download counters and available traffic windows. Traffic failures remain unavailable rather than becoming invented zeroes. Compare cumulative star and asset counters with the previous snapshot; do not add overlapping unique-visitor windows together.

Downloads include maintainer checks, repeat downloads and automated fetches. They are not verified installations or active-user counts. Track successful fresh-account runs only when testers voluntarily report them. Keep names, outreach drafts and private replies outside the public repository.
