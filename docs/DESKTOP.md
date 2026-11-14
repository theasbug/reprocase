# Desktop app (Windows, macOS, Linux)

The desktop app bundles Electron and Chromium. It runs the same local service, case runner, CLI and MCP as the web/source version.

## Where your data is stored

| Platform | Data folder |
|---|---|
| Windows | `ReproCase-data` next to `ReproCase.exe` (portable) |
| macOS | `~/Library/Application Support/ReproCase` |
| Linux | `~/.config/ReproCase` (or `$XDG_CONFIG_HOME/ReproCase`) |

`REPROCASE_DESKTOP_WORKSPACE` overrides the folder. Back it up before upgrading and never share it: it contains your local cases, sessions and encrypted provider keys.

## Provider keys

Saved AI provider and MCP keys are encrypted with the operating system: DPAPI on Windows, the Keychain on macOS, and GNOME Keyring or KWallet on Linux. On Linux without a running keyring, ReproCase **does not save** keys (it never falls back to plain text). Use the key for the current session or start a keyring. Keys may need to be entered again after moving to another machine or account.

## macOS

The app is not code-signed yet. The first time, right-click **ReproCase** → **Open** → **Open**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/ReproCase.app
```

## Linux

Extract the archive and run `./ReproCase`. Chromium's system libraries are needed; most desktop distributions already have them.

On Ubuntu 24.04 and newer, AppArmor blocks the user namespaces that Electron's sandbox uses, and the app exits with a sandbox error. Either allow them for this app with an AppArmor profile, or, on a machine you control, run:

```sh
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

Do not start ReproCase with `--no-sandbox`.

## Native desktop control

The AI assistant's native window, screenshot, pointer, keyboard, clipboard and accessibility tools are implemented for **Windows only**. On macOS and Linux these tools are not offered; everything else (cases, runs, Quick proof, Burp import, MCP) works the same.

Ctrl+Alt+Esc cancels active agent work and managed scans. Already-started server changes and detached applications are not rolled back.

## Build from source

```sh
npm ci --ignore-scripts
npm run desktop:setup
npm run browsers:install
npm run desktop:build
npm run desktop
```

`npm run desktop:package` packages for the current platform and architecture (override with `REPROCASE_PACKAGE_PLATFORM` / `REPROCASE_PACKAGE_ARCH`). A manifest records the bundled `chromium-NNNN` folder and the executable inside it. `REPROCASE_PACKAGE_CHROMIUM` (plus `REPROCASE_PACKAGE_CHROMIUM_EXECUTABLE` on macOS/Linux) can select a specific installed Chromium. `REPROCASE_PACKAGE_OUT` must point to a new directory when the default output already exists. On macOS the `.icns` icon is generated from `desktop/assets/reprocase.png` with `sips` and `iconutil`.

See README, SECURITY.md and docs/EXPORTS.md for scope, session-only program headers, and exported proof requirements.
