# Windows desktop beta

Extract the full portable ZIP and run ReproCase.exe. Local ReproCase-data is created beside it; back up that directory before upgrading, and never distribute it. Provider/MCP encryption can depend on the Windows account and Electron data; re-enter keys if moving between machines.

Build: npm ci --ignore-scripts; npm run desktop:setup; npm run browsers:install; npm run desktop:build; npm run desktop.

Package on Windows with npm run desktop:package. A manifest records the actual chromium-NNNN resource directory. REPROCASE_PACKAGE_CHROMIUM can explicitly select an installed chromium-NNNN folder; no previous release folder is searched. REPROCASE_PACKAGE_OUT must point to a new directory when the default output already exists. The launcher fails clearly if packaged Chromium is missing.

Agent mode has native Windows window/screenshot/pointer/keyboard/clipboard/accessibility tools. Physical desktop input can interfere with your work; use a dedicated session for automated desktop tests. UI/API, CLI and MCP retain the shared reproduction engine.

Stop network scans cancels managed scans. Ctrl+Alt+Esc cancels active agent work and managed scans. Already-started server changes and detached applications are not rolled back.

See README, SECURITY.md and docs/EXPORTS.md for scope, session-only program headers, and exported proof requirements. Linux/macOS native control is not implemented in this release.
