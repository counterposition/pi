# Providers & Custom Models

Pi supports subscription-based providers via OAuth, API-key providers via env vars or `auth.json`, and custom providers via `models.json` or extensions.

## Subscription Providers

Use `/login` in interactive mode, then select a provider. The `/login` selector is fuzzy-searchable and shows where each entry's auth comes from (`--api-key`, env var, custom provider) without leaking the secret.

- Anthropic Claude Pro / Max — third-party usage draws from extra usage and is billed per token (suppress the warning via `warnings.anthropicExtraUsage`)
- OpenAI ChatGPT Plus / Pro (Codex) — `/login` defaults to browser auth but can use a device-code flow for headless environments
- GitHub Copilot
- OpenRouter (Pi 0.82.0) — `/login openrouter` runs a PKCE flow that mints a user-controlled API key billed from OpenRouter credits; on headless/SSH hosts paste the redirect URL or authorization code into the prompt (Pi 0.83.0). `OPENROUTER_API_KEY` still works via **Use an API key**
- xAI (Grok/X subscription, Pi 0.80.8) — `/login xai` then **Use a subscription** (device-code OAuth); `XAI_API_KEY` remains available via **Use an API key**
- Radius (Pi 0.80.8) — a dynamic `pi-messages` gateway; `/login radius` stores OAuth tokens, and custom Radius gateways can be declared in `models.json` with `"oauth": "radius"` plus a gateway `baseUrl`

`/login <provider>` with autocomplete works since Pi 0.80.4, and login methods are provider-owned since 0.80.8 (registered pi-ai providers expose their own auth options and status in `/login`). Use `/logout` to clear stored OAuth credentials. Pi 0.71.0 removed built-in Google Gemini CLI and Google Antigravity providers. `pi auth check [provider|model]` (Pi 0.84.1) preflights credential readiness; `pi auth print-api-key` / `pi auth print-bearer-token` (Pi 0.83.0) export resolved credentials to external clients, refreshing OAuth as needed.

Since Pi 0.80.8, built-in catalogs are complemented by dynamic ones: `/model` refreshes configured providers in the background, `pi update --models` forces an immediate refresh, and refreshed catalogs are cached in `~/.pi/agent/models-store.json` for offline use. Refreshes revalidate with `If-None-Match` since Pi 0.82.1 so unchanged catalogs answer `304`.

## API Key Providers

| Provider | Env Var | `auth.json` key |
|----------|---------|-----------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Ant Ling | `ANT_LING_API_KEY` | `ant-ling` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` | `azure-openai-responses` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| NVIDIA NIM | `NVIDIA_API_KEY` | `nvidia` |
| Google Gemini | `GEMINI_API_KEY` | `google` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Groq | `GROQ_API_KEY` | `groq` |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras` |
| Cloudflare AI Gateway | `CLOUDFLARE_API_KEY` (+ `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`) | `cloudflare-ai-gateway` |
| Cloudflare Workers AI | `CLOUDFLARE_API_KEY` (+ `CLOUDFLARE_ACCOUNT_ID`) | `cloudflare-workers-ai` |
| xAI | `XAI_API_KEY` | `xai` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `vercel-ai-gateway` |
| ZAI | `ZAI_API_KEY` | `zai` |
| ZAI Coding Plan (China) | `ZAI_CODING_CN_API_KEY` | `zai-coding-cn` |
| OpenCode Zen | `OPENCODE_API_KEY` | `opencode` |
| OpenCode Go | `OPENCODE_API_KEY` | `opencode-go` |
| Amazon Bedrock | `AWS_BEARER_TOKEN_BEDROCK` | `amazon-bedrock` |
| Radius | `RADIUS_API_KEY` | `radius` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| Together AI | `TOGETHER_API_KEY` | `together` |
| Baseten | `BASETEN_API_KEY` | `baseten` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| Qwen Token Plan / Individual | `QWEN_TOKEN_PLAN_API_KEY` | `qwen-token-plan` / `qwen-token-plan-individual` (Pi 0.81.0 / 0.84.1) |
| Qwen Token Plan (China) | `QWEN_TOKEN_PLAN_CN_API_KEY` | `qwen-token-plan-cn` (Pi 0.81.0) |
| Xiaomi MiMo | `XIAOMI_API_KEY` | `xiaomi` |
| Xiaomi MiMo Token Plan (CN/AMS/SGP) | `XIAOMI_TOKEN_PLAN_{CN,AMS,SGP}_API_KEY` | `xiaomi-token-plan-{cn,ams,sgp}` |

## Auth File

`~/.pi/agent/auth.json` stores API keys and OAuth tokens with `0600` permissions:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "!op read 'OpenAI API Key'" },
  "google": { "type": "api_key", "key": "$GEMINI_API_KEY" },
  "cloudflare-ai-gateway": {
    "type": "api_key",
    "key": "$CLOUDFLARE_API_KEY",
    "env": {
      "CLOUDFLARE_ACCOUNT_ID": "account-id",
      "CLOUDFLARE_GATEWAY_ID": "gateway-id"
    }
  }
}
```

`key` values can be:

- A literal secret
- `$ENV_VAR` / `${ENV_VAR}` environment interpolation (works inside larger literals). Plain uppercase names without `$` are treated as literals since Pi 0.79.4 — the old bare-env-var-name form no longer resolves.
- A shell command prefixed with `!` (stdout is used, cached for the process lifetime)

Entries may include an `env` object (Pi 0.79.5) for provider-scoped environment overrides — Cloudflare account/gateway IDs, Azure endpoints, Vertex project/location, Bedrock config, cache retention, proxies — applied without changing the project shell.

## Credential Resolution Order

1. `--api-key`
2. `auth.json`
3. Environment variables
4. Custom provider keys from `models.json`

## Cloud Providers

### Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_BASE_URL=https://your-resource.openai.azure.com
# Cognitive Services and modern Microsoft Foundry endpoint URLs are also
# supported; root endpoints are auto-normalized to /openai/v1:
# export AZURE_OPENAI_BASE_URL=https://your-resource.cognitiveservices.azure.com
# export AZURE_OPENAI_BASE_URL=https://your-resource.ai.azure.com
# Or supply the resource name only:
export AZURE_OPENAI_RESOURCE_NAME=your-resource

export AZURE_OPENAI_API_VERSION=2024-02-01
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP=gpt-4o=my-gpt4o
```

### Amazon Bedrock

`/login amazon-bedrock` stores a Bedrock API key (Pi 0.80.7). Ambient AWS credential flows also work — these keep using SigV4 authentication:

- `AWS_PROFILE`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `AWS_BEARER_TOKEN_BEDROCK`

Useful extras:

- `AWS_REGION`
- `AWS_BEDROCK_FORCE_CACHE=1` for application inference profiles
- `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` / `AWS_BEDROCK_SKIP_AUTH` / `AWS_BEDROCK_FORCE_HTTP1` for proxies

### Cloudflare AI Gateway / Workers AI

`/login` stores `CLOUDFLARE_API_KEY`. Account ID (and gateway slug for AI Gateway) must be set as env vars:

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_GATEWAY_ID=...   # AI Gateway only

pi --provider cloudflare-ai-gateway --model "claude-sonnet-4-5"
pi --provider cloudflare-workers-ai --model "@cf/moonshotai/kimi-k2.6"
```

### Google Vertex AI

Use ADC:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1
```

## Custom Providers via `models.json`

Use `models.json` for OpenAI-compatible, Anthropic-compatible, Google-compatible, or other supported APIs:

```json
{
  "providers": [
    {
      "name": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "unused",
      "models": [
        {
          "id": "llama3.2",
          "name": "Llama 3.2",
          "contextWindow": 128000,
          "maxTokens": 4096,
          "input": ["text"],
          "thinkingLevelMap": {
            "off": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "high"
          }
        }
      ]
    }
  ]
}
```

`apiKey` is optional (Pi 0.80.0): omit it when auth comes from `/login`, `auth.json`, or CLI `--api-key`. Like `auth.json` keys, `apiKey` and `headers` values support `!command` execution and `$ENV_VAR` interpolation; plain uppercase strings are literals. Keyless local servers (e.g. Ollama) should keep a dummy value so their models appear in `/model`.

Common `api` values:

- `"openai-completions"`
- `"openai-responses"`
- `"anthropic-messages"`
- `"google-generative-ai"`
- `"google-vertex"`
- `"azure-openai-responses"`
- `"mistral-conversations"`
- `"bedrock-converse-stream"`

### Model & Compatibility Knobs

- `samplingParams` (Pi 0.84.0) is a free-form object merged verbatim into every request body after pi's own fields (its keys win) — for OpenAI-compatible APIs only (`openai-completions`, `openai-responses`, `azure-openai-responses`). Use it for server-specific knobs like llama.cpp `min_p` or vLLM `top_k`; in `modelOverrides` it merges per key.
- `thinkingLevelMap` (Pi 0.72) replaces `compat.reasoningEffortMap`. Map pi levels (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) to provider values; use `null` to hide a level. Maps may contain holes (Pi 0.80.6) — e.g. expose `high` and `max` without `xhigh`. When a key is omitted, standard levels through `high` use the provider default mapping, but the extended `xhigh`/`max` levels are unsupported.
- `cost` supports request-wide input pricing tiers (Pi 0.80.6): a `tiers` array where each tier supplies a complete alternate rate set and applies to the whole request when total input usage (`input + cacheRead + cacheWrite`) exceeds `inputTokensAbove`; the highest matching threshold wins. Also usable in `modelOverrides` and extension-registered providers.
- `modelOverrides` applies to built-in and (since Pi 0.80.4) extension-registered provider models; per-model fields: `name`, `reasoning`, `thinkingLevelMap`, `input`, `cost` (partial), `contextWindow`, `maxTokens`, `samplingParams`, `headers`, `compat`.
- `openRouterRouting` is forwarded as-is in the OpenRouter `provider` field (fallbacks, ZDR, ignore lists, throughput/latency).
- `compat.thinkingFormat` supports OpenAI-compatible reasoning variants: `openrouter` sends `reasoning: { effort }`, `together` sends `reasoning: { enabled }` plus `reasoning_effort` when supported, `qwen-chat-template` targets local Qwen-compatible servers that read `chat_template_kwargs.enable_thinking`, `chat-template` (Pi 0.79.9) sends configurable `chat_template_kwargs` via `compat.chatTemplateKwargs` — e.g. `{ "thinking": { "$var": "thinking.enabled" } }` for DeepSeek models behind vLLM/Hugging Face chat templates — and `baseten` (Pi 0.84.0) sends `chat_template_args` via `compat.chatTemplateArgs`.
- **Breaking (Pi 0.80.7):** `compat.sendSessionIdHeader` was removed. Session affinity is now controlled by `compat.sessionAffinityFormat` (`"openai"` sends `session_id`/`x-client-request-id`, `"openai-nosession"` omits the underscore-containing `session_id` header, `"openrouter"` sends `x-session-id`; default auto-detected). Replace `sendSessionIdHeader: false` with `sessionAffinityFormat: "openai-nosession"`. `sendSessionAffinityHeaders` still gates the behavior for `openai-completions`.
- `compat.deferredToolsMode: "kimi"` (Pi 0.80.9) enables Kimi's deferred tool serialization; `compat.supportsToolReferences` / `compat.supportsToolSearch` enable native dynamic tool loading on verified custom endpoints, and `compat.supportsStrictTools` / `compat.supportsOpenAIGrammarTools` / per-model `constrainedSampling` gate constrained sampling (see `references/extensions.md`). `compat.supportsFinishReason: false` (Pi 0.84.0) tells pi to infer stop/toolUse for OpenAI-compatible streams that omit `finish_reason`.
- Advanced `compat` flags exist for proxy quirks (`cacheControlFormat` — now also covering tool-result text content, `supportsReasoningEffort`, `supportsLongCacheRetention`, `supportsEagerToolInputStreaming`, `supportsStrictMode`). See [Pi `docs/models.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) when a proxy rejects pi's defaults.

### Context Overflow Recovery

Pi can auto-compact and retry when a provider fails with a recognized context-window overflow. For custom providers whose overflow text Pi does not recognize, use a provider-scoped `message_end` extension handler to rewrite the finalized assistant `errorMessage` so it starts with `context_length_exceeded`.

### llama.cpp

Pi supports the llama.cpp router server (Pi 0.81.0): configure with `/login llama.cpp`, search/download Hugging Face models and load/unload with live progress via `/llama`, then select loaded models in `/model`. The model catalog persists across restarts (fixed in Pi 0.82.1). See [Pi `docs/llama-cpp.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/llama-cpp.md).

## Custom Providers via Extensions

Use extensions when you need custom streaming, custom headers, OAuth/device-flow logic, or want to override an existing provider's `baseUrl`/`headers`:

```typescript
// Full registration
pi.registerProvider("my-provider", {
  name: "My Provider",                        // optional friendly /login label
  baseUrl: "https://api.example.com",
  api: "openai-completions",
  apiKey: "MY_PROVIDER_KEY",
  models: [
    {
      id: "my-model",
      name: "My Model",
      contextWindow: 128000,
      maxTokens: 4096,
      baseUrl: "https://us-east.api.example.com",   // per-model override
    },
  ],
});

// Override-only: re-route an existing built-in provider through a proxy
pi.registerProvider("anthropic", { baseUrl: "https://proxy.example.com" });
```

## SDK / Extension Auth Lookup

If extension code needs auth for a specific model request, use `getApiKeyAndHeaders(model)` rather than the removed `getApiKey(model)`:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) throw new Error(auth.error);

const { apiKey, headers } = auth;
```

This matters for providers whose headers or auth values resolve dynamically on every request. In SDK code, use `ModelRuntime.getAuth(providerOrModel)` instead (Pi 0.80.8) — passing a model also resolves built-in, `models.json`, and extension model headers; see `references/sdk.md`.
