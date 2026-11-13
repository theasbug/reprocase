# Case templates

Starting points for common authorization bugs. Each file is a complete, schema-valid `.reprocase.json` package. Copy one, then adjust it to your target:

1. Change the `path` values and JSON Pointers (`idPointer`, `tenantPointer`, `rolePointer`, captures) to match the target's API.
2. Rewrite `policy.statement` so it describes the access rule the program actually documents.
3. Validate it with `npm run cli -- validate templates/<file>`, then import it and bind your own test accounts.

| Template | Bug class | Actors | Witness |
|---|---|---|---|
| [`horizontal-idor-read`](horizontal-idor-read.reprocase.json) | IDOR / BOLA read | Two members of the **same** tenant | The other member reads the owner's fresh marker |
| [`horizontal-idor-write`](horizontal-idor-write.reprocase.json) | IDOR / BOLA write | Two members of the **same** tenant | The owner independently observes the other member's change |
| [`vertical-privilege-read`](vertical-privilege-read.reprocase.json) | Broken function-level authorization (BFLA) | Admin and member, same tenant | The member reads an admin-only object's fresh marker |

Cross-tenant read and write cases live in [`examples/`](../examples/) and run against the built-in demo.

The templates use the demo's `/me` and `/documents` shape as placeholders. Against the built-in demo, whose accounts are in different tenants, the same-tenant templates correctly stop as **inconclusive** at the precondition check. That is the intended behavior.

## Contributing a template

New patterns are very welcome: mass assignment of `ownerId`, GraphQL node IDs, UUID-in-body IDOR, export or report endpoints, invite flows. Keep templates generic. Do not include real program hosts, IDs or captured data. Open a PR with the template, a row in the table above, and a passing `validate` output.
