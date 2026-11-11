# Five-minute beta test

Thanks for trying ReproCase. The built-in demo needs no provider key, subscription or external target.

1. Extract the full Windows portable archive and open `ReproCase.exe`, or run the source demo.
2. Load the local demo and confirm that both accounts are connected.
3. Review and approve the case and target, inspect preflight, then run. Expected: **Reproduced**.
4. Choose **Fresh identities**. The displayed account identities should change. Approve and rerun. Expected: **Reproduced**, using the same case revision.
5. Switch to **Secure target**, approve and rerun. Expected: **Not reproduced**.
6. Export the case. Review the contents before downloading or sharing it.

## Tell us what happened

Use the repository's **Beta demo feedback** issue form. Report your OS, ReproCase version, source/portable installation method, the result at each step, and the first confusing or broken part. A failed setup or session should be described as **Inconclusive**, not assumed to prove a fixed target.

Include only a sanitized error or screenshot from the local demo. Do not attach your populated `ReproCase-data`, API keys, cookies, private captures or real-program details. Sensitive ReproCase vulnerabilities belong in [private security reporting](https://github.com/theasbug/reprocase/security/advisories/new).

No star, repost, endorsement or public quote is required to participate. We will ask separately before quoting your feedback in promotion.
