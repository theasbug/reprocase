# Public release checks

## Privacy and artifacts

Before the first public release on 11 November 2026:

- Inspected both ZIP file lists for local workspace databases, session/profile folders, credential files, environment files and Git history.
- Scanned 125 source text files and 11,717 text files from the Windows archive for local user/machine identifiers, personal email addresses and credential patterns. Pattern hits were reviewed as a documented sample AWS key, dependency lexer content and a PEM parser marker.
- Ran Gitleaks 8.30.1 against the final source directory and the packaged application directory, including its JavaScript dependencies: no leaks detected.
- Visually reviewed bundled screenshots. They use disposable local demo accounts and local mock-provider data.
- Kept third-party license and copyright notices intact. Public maintainer attribution uses the GitHub login and GitHub noreply address.

These checks describe the inspected release, not a guarantee for future user-generated exports. New application data, chats, captures and screenshots may contain confidential material. Never redistribute your populated `ReproCase-data` folder.

The Windows binary and source archive are distributed separately with SHA-256 checksums. GitHub also provides source archives for the release tag.

## Verification

See [verification](VERIFICATION.md) for local test results and [hosted checks](https://github.com/theasbug/reprocase/actions/workflows/ci.yml) for the public workflow's actual status.

The pre-publication npm audit reported no runtime advisories. The complete development tree had five moderate affected package records in Electron packaging dependencies. The executable is unsigned. Both limitations are disclosed in the release notes.
