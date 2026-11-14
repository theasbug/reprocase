# CLI reference

Invoke commands with `npm run cli -- COMMAND ...`. Node 24.18+ is required. The default local workspace is `.reprocase/`; use `--workspace PATH` to select another workspace. Do not commit workspace runtime files or private binding files.

## Serve and demo

```sh
npm run cli -- serve --dev --port 4317
npm run cli -- demo --dev --mode vulnerable
```

`serve` starts the local workbench. `demo` also starts the owned example application and remains running. Use `--mode secure` to start its enforcing variant. Build the web UI with `npm run build` when omitting `--dev`.

The server prints a loopback bootstrap URL containing its management token in the fragment. A stdio MCP bridge uses the local workspace's runtime metadata to attach to that same server.

## Import and validate

```sh
npm run cli -- import capture.har --kind har
npm run cli -- import request-and-response.txt --kind http
npm run cli -- import examples/cross-tenant.reprocase.json --kind package
npm run cli -- validate cross-tenant-document
npm run cli -- validate examples/cross-tenant.reprocase.json
```

## IDOR candidates from Arjun and ffuf

```sh
npm run cli -- candidates arjun.json --kind arjun
npm run cli -- candidates ffuf.json --kind ffuf --draft 1
```

`candidates` reads Arjun JSON (`arjun -u URL -oJ arjun.json`) or ffuf JSON (`ffuf ... -of json -o ffuf.json`) and lists leads ranked by identifier signals. `--kind` is detected from the content when omitted. `--draft N` creates a case draft from lead `N` through the regular raw-HTTP importer. Parsing sends no requests. Captured `Cookie` and `Authorization` headers are never copied into the draft, so bind your own test accounts before running. The same ranking is available through the MCP tool `idor_candidates` and the **Arjun** and **ffuf** tabs of **Import evidence**.

Imports do not access recorded targets. HAR/HTTP traffic becomes an unapproved draft; review identity probes, actor assignment, resource producers, and witness conditions in the UI. Validation accepts a workspace case ID or a case/package file.

## Guided creation, preflight and comparison

```sh
npm run cli -- create examples/guided-document.json --target http://127.0.0.1:YOUR_LAB_PORT
npm run cli -- plan CASE_ID --targets targets.json --budget 100
npm run cli -- compare BEFORE_RUN_ID AFTER_RUN_ID --output comparison.json
```

`create` uses the same schema and builder as the UI. It saves an unapproved draft; `--target` is an optional local origin mapping, kept outside the shareable case. Endpoint examples match the controlled lab. Edit the expected policy and mappings before acknowledging the case in the workbench. No target requests are sent by `create`.

`plan` prints a read-only inspection of a saved case: binding gaps, origin mappings, request effects, dependencies and a request estimate including live identity checks. It never logs in, creates resources or verifies an identity. `ready: false` is a valid inspection result and does not change the command exit code; inspect `ready` and `issues` in automation. When the service is offline, memory-only sessions are unavailable and appear as missing bindings.

`compare` reads two finished runs of the same case, including offline runs saved in SQLite. It compares already sanitized evidence and does not contact the target. Different case revisions are explicitly labeled. `create`, `plan` and `compare` accept `--output FILE`; without it they print JSON.

## Connect accounts and run

Create `targets.json` locally:

```json
{
  "api": "https://YOUR-AUTHORIZED-API.example"
}
```

Create a private `local.bindings.json` file:

```json
{
  "actors": {
    "owner": {
      "origin": "https://YOUR-AUTHORIZED-API.example",
      "token": "env:REPROCASE_OWNER_TOKEN"
    },
    "researcher": {
      "origin": "https://YOUR-AUTHORIZED-API.example",
      "token": "env:REPROCASE_RESEARCHER_TOKEN"
    }
  }
}
```

Set the two environment variables in your shell, then run:

```sh
npm run cli -- run examples/cross-tenant.reprocase.json \
  --targets targets.json --bindings local.bindings.json \
  --expect reproduced --interval 250 --budget 100
```

Use your shell's multiline syntax or one line. `--targets` also accepts an inline JSON object. `--bindings` names a private JSON file; account entries support `origin`, `token`, `cookie`, `headers`, and an optional `login` recipe. A login recipe has `path`, optional `method`, and optional JSON `body`. The origin is separate and the recipe path is relative to it. Values starting with `env:` are resolved from the current process environment by the CLI, not by the shared case format.

For a cookie-based service, use `"cookie": "env:REPROCASE_OWNER_COOKIE"` instead of a token. For an explicit API login recipe:

```json
{
  "actors": {
    "owner": {
      "origin": "https://YOUR-AUTHORIZED-API.example",
      "login": {
        "path": "/auth/login",
        "method": "POST",
        "body": {
          "email": "env:REPROCASE_OWNER_EMAIL",
          "password": "env:REPROCASE_OWNER_PASSWORD"
        }
      }
    }
  }
}
```

Add all actors required by the case. A successful login still needs the case's live identity/relationship checks. A browser-specific or device-bound session may remain unsupported by the API path; the outcome must not be mistaken for an explicit access denial.

The run emits sanitized JSON. Exit codes:

- `0`: the verdict matches `--expect` (default: `reproduced`).
- `1`: command/configuration error.
- `2`: a `not_reproduced` verdict did not match the expectation.
- `3`: an `inconclusive` verdict did not match the expectation.

`--interval` configures spacing between requests in milliseconds. `--budget` bounds the request count. Both are per-run constraints, not permission to exceed the target program's own rules.

## Export

```sh
npm run cli -- export cross-tenant-document --run RUN_ID --format package --output finding.reprocase.json
npm run cli -- export cross-tenant-document --run RUN_ID --format html --output report.html
npm run cli -- export cross-tenant-document --run RUN_ID --format markdown --output report.md
```

Exports retain the exact case revision associated with the selected historical run. Preview reports for application-specific personal/confidential information before sharing. A saved verdict describes that recorded observation; recipients must connect their own accounts and run the package to obtain a fresh result.

## MCP

Start the local service in one terminal, then configure your host to launch:

```sh
npm run --silent cli -- mcp --workspace .reprocase
```

The bridge uses stdio for protocol messages and stderr for diagnostics. Its workspace must match the running service. It does not start a public MCP HTTP endpoint or overwrite your AI client's settings.

The `case_build`, `run_plan` and `run_compare` MCP tools use the same service as their UI and CLI counterparts. Case creation never acknowledges the policy. Preflight cannot bypass the current revision requirement or the execution checks.

## Environment

- `REPROCASE_LISTEN_HOST`: `127.0.0.1` (default), `0.0.0.0` or `::`. Use a non-loopback value only inside a container whose port is published on loopback (`-p 127.0.0.1:4317:4317`). Requests must still carry a loopback `Host`, a loopback `Origin` when present, and the per-start token.
- `REPROCASE_HEADLESS=1`: run the managed Chromium headless.
