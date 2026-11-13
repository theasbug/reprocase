# ReproCase for Burp Suite

Right-click any request in Burp and choose **Send to ReproCase**. ReproCase turns the selection into a reviewable case draft. From there you bind your own test accounts, recreate the resource and get a `reproduced`, `not_reproduced` or `inconclusive` verdict.

- Works with Burp Suite Professional and Community (Montoya API, Java 17+).
- Sends multiple selected requests at once, from Proxy history, Repeater, Logger or the message editor.
- Includes the response when Burp has one, so ReproCase can suggest captures.
- Only talks to a ReproCase service on `localhost` / `127.0.0.1`. Any other address is refused.
- Importing never sends a request to the target. Session cookies and tokens in the captured headers are not copied into the case.

## Install

1. Download `reprocase-burp-<version>.jar` from the [latest release](https://github.com/theasbug/reprocase/releases), or [build it](#build).
2. In Burp, go to **Extensions → Installed → Add**, choose **Java**, and select the jar.
3. Open the new **ReproCase** tab and connect it in one of two ways:
   - **Recommended:** browse to ReproCase's `runtime.json`. This keeps working after ReproCase restarts.
     - Desktop app: `ReproCase-data\workspace\runtime.json` next to `ReproCase.exe`
     - Source checkout: `.reprocase/runtime.json` (or `<workspace>/runtime.json` if you passed `--workspace`)
   - **Or** paste the launch URL ReproCase prints, `http://localhost:4317/#token=…`. This is the option to use with Docker. The token changes each time ReproCase starts.
4. Click **Save and test**. You should see *Connected to http://…*.

## Build

~~~sh
cd integrations/burp
gradle jar        # → build/libs/reprocase-burp-0.1.0.jar
~~~

The Montoya API is a compile-only dependency, so the jar contains only ReproCase's own classes.

## How it works

The extension serializes the selection in Burp's XML export format and posts it to ReproCase's local `/api/import` endpoint, using the per-start bearer token from `runtime.json`. That is the same import path as **Import → Burp XML** in the ReproCase interface.
