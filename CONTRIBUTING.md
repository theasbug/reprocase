# Contributing

Use Node 24.18+ and a clean checkout. Run npm ci --ignore-scripts and npm run browsers:install. Desktop contributors also run npm run desktop:setup. See README for the check commands.

Start with the owned local demo. Tests must not contact real bounty targets or depend on a paid provider key. Add failing behavior tests before fixing scope, identity, witness, cancellation, rate or secret handling. Preserve the same core semantics across API, CLI, MCP and exports. Do not add arbitrary executable case package fields.

Report version, operating system, sanitized error and exact reproduction steps. Never attach ReproCase-data, tokens, cookies, private captures or account credentials. Pull requests should explain resulting behavior and relevant checks. Windows computer tests take foreground control; run those in a dedicated desktop session.

Alpha/beta release promotion requires a green hosted CI run, packaged Windows smoke, clean archive inspection and checksums. Source and binary artifacts must be separate.
