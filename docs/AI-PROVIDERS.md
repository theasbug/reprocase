# Providers and model discovery

Normal setup asks for Provider and API key. Models come from the provider's API, rather than a frozen name list. Multiple profiles can coexist; the conversation model picker searches their catalogs. Advanced setup supports custom/local endpoints and Chat Completions, Responses or Anthropic Messages.

Presets and official sources, checked 10 November 2026:

- [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list): `https://api.openai.com/v1`, Responses generation and authenticated model discovery.
- [Anthropic / Claude](https://platform.claude.com/docs/en/api/models/list): `https://api.anthropic.com/v1`, native Messages and paginated models.
- [Google Gemini](https://ai.google.dev/gemini-api/docs/openai): `https://generativelanguage.googleapis.com/v1beta/openai`, compatible chat; native discovery uses Google's key header and pagination.
- [DeepSeek](https://api-docs.deepseek.com/api/list-models/): `https://api.deepseek.com`, chat and model capabilities.
- [OpenCode Go](https://opencode.ai/docs/console/go/): `https://opencode.ai/inference/go/openai/v1`, separate `/inference/go/v1/models` catalog.
- [OpenCode Zen / Console](https://opencode.ai/docs/console/api/inference/): `https://opencode.ai/inference/openai/v1`, with `/inference/v1/models`. Console free models can have different client restrictions from Go; catalog presence is not an access guarantee.
- [OpenRouter](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties): `https://openrouter.ai/api/v1`, text-model discovery and compatible chat.
- [Groq](https://console.groq.com/docs/openai): `https://api.groq.com/openai/v1`, compatible chat/models.
- [Mistral](https://docs.mistral.ai/api/endpoint/models): `https://api.mistral.ai/v1`, chat and account models.

Preset endpoints cannot be overridden by a hidden URL field; choose Advanced explicitly for a custom endpoint. A saved key is never transferred to a different endpoint/profile. Pagination stays on the original catalog URL; redirects are rejected. A discovery error can leave an older cached catalog visible with the failure recorded.

## Reasoning

Metadata takes priority: OpenCode effort arrays, DeepSeek `effort.supported_levels`, Claude capabilities and OpenRouter `reasoning.supported_efforts`. Known OpenAI and Gemini families have conservative documented defaults when catalogs omit details. Unknown models use Auto. The server rejects non-advertised levels before generation.

Requests use `reasoning.effort` for Responses/OpenRouter, `output_config.effort` for native Claude, and `reasoning_effort` for compatible Chat Completions. See [OpenAI](https://developers.openai.com/api/docs/guides/reasoning), [Claude](https://platform.claude.com/docs/en/build-with-claude/effort), [Gemini](https://ai.google.dev/gemini-api/docs/openai), and [OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Reasoning capability does not always imply configurable levels.

## OpenCode routing and tests

ReproCase sends its own user agent and a stable `x-opencode-session` per conversation to `opencode.ai`, as required by [Go's client requirements](https://opencode.ai/docs/console/go/#where-can-i-use-it). Discovery has its own ID; chat retains one ID across turns. Other hosts do not receive this OpenCode header.

This addresses the missing-header HTTP 400. Earlier connection-tool and case-proposal calls returned HTTP 200. Desktop discovery returned 30 models, including 22 with reasoning levels; the first streaming-chat attempt returned HTTP 429. Inspect the [earlier result](provider-live-test.json) and [desktop result](desktop-provider-live-test.json) for exact outcomes. Generation is not retried automatically.

Normal tests use an owned mock provider. Set `REPROCASE_TEST_API_KEY` privately and run `node --import tsx scripts/test-desktop-provider.ts` to opt into real discovery and a two-turn LongCat chat attempt. Only sanitized metadata is recorded. Other paid accounts and remote AI-assisted login have not been live-tested.

Desktop keys use Windows OS encryption; web keys stay in memory. The model receives conversation text, selected files and explicitly added case context, with known credentials removed. Other confidential text can remain in files or history; sending it chooses that provider as its recipient.
