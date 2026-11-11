# Security reporting

For sensitive vulnerabilities, use GitHub private vulnerability reporting if enabled on the repository, or contact the repository owner privately. Do not post working credentials, private targets or personal captures in public issues. There is no invented security contact address.

Include affected version, minimal owned/local reproduction and expected/observed behavior. Avoid testing other users' machines or third-party targets to demonstrate a product issue.

This release is an experimental beta. Terminal, desktop and MCP tools can change the user's computer after permissions are granted. Autonomous mode deliberately removes prompts and persists locally. It is not isolation. Scope/rate controls cover ReproCase-managed target requests, not arbitrary terminal programs or external MCP servers.

Program headers are memory-only. Provider/MCP saved credentials use the Windows vault. Local chat history, screenshots and file backups may contain confidential data. Protect ReproCase-data and keep it out of releases.

See docs/VERIFICATION.md for tested scope and known limitations, including development dependency advisories and unsigned Windows binaries.
