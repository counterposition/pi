# Providers & Custom Models

Pi supports subscription-based providers via OAuth, API-key providers via env vars or `auth.json`, and custom providers via `models.json` or extensions.

## Subscription Providers

Use `/login` in interactive mode, then select a provider. The `/login` selector is fuzzy-searchable and shows where each entry's auth comes from (`--api-key`, env var, custom provider) without leaking the secret.

- Anthropic Claude Pro / Max — third-party usage draws from extra usage and is billed per token (suppress the warning via `warnings.anthropicExtraUsage`). Since Pi 1.0.0 `/login anthropic` offers browser login (default) or **copy code** login, which shows the authorization code on Anthropic's page for pasting into Pi when the browser runs on another machine
- OpenAI with a ChatGPT subscription (Pi 0.99.0) — `/login openai` offers **Sign in with ChatGPT**, an OAuth login that uses the subscription with the OpenAI API on the regular `openai` provider. Pi stores a stable `deviceId` for it in global settings. Subscription usage-limit errors are not retried
- OpenAI Codex (legacy) — the older `openai-codex` provider, renamed in Pi 0.99.0 and superseded by Sign in with ChatGPT. Its `/login` still offers browser auth or a device-code flow; its default model is `gpt-6.1-sol` (Pi 0.99.1). Prefer Sign in with ChatGPT on `openai` for new setups
- GitHub Copilot
- OpenRouter (Pi 0.82.0) — `/login openrouter` runs a PKCE flow that mints a user-controlled API key billed from OpenRouter credits; on headless/SSH hosts paste the redirect URL or authorization code into the prompt (Pi 0.83.0). `OPENROUTER_API_KEY` still works via **Use an API key**
- xAI (Grok/X subscription, Pi 0.80.8) — `/login xai` then **Use a subscription** (device-code OAuth); `XAI_API_KEY` remains available via **Use an API key**
- Radius (Pi 0.80.8) — a dynamic `pi-messages` gateway; `/login radius` stores OAuth tokens, and custom Radius gateways can be declared in `models.json` with `"oauth": "radius"` plus a gateway `baseUrl`. Since Pi 0.86.0 a public Radius catalog ships for immediate/offline selection (cached and live gateway catalogs overlay it); custom gateways use their own catalog. Since Pi 1.0.0 `/login` lists **Sign in with Radius** at the top level and, after sign-in, offers to add the Radius MCP server to the global `mcp.json` with `"auth": { "provider": "radius" }`
- Meta Muse (Pi 0.86.1) — `/login meta` with automatic Model API key refresh; `META_API_KEY` also works

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
| TypeSafe (classifier models only) | `TYPESAFE_API_KEY` | `typesafe` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| Together AI | `TOGETHER_API_KEY` | `together` |
| Baseten | `BASETEN_API_KEY` | `baseten` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| Meta (Muse) | `META_API_KEY` | `meta` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| Qwen Token Plan / Individual | `QWEN_TOKEN_PLAN_API_KEY` | `qwen-token-plan` / `qwen-token-plan-individual` (Pi 0.81.0 / 0.84.1) |
| Qwen Token Plan (China) | `QWEN_TOKEN_PLAN_CN_API_KEY` | `qwen-token-plan-cn` (Pi 0.81.0) |
| Xiaomi MiMo | `XIAOMI_API_KEY` | `xiaomi` |
| Xiaomi MiMo Token Plan (CN/AMS/SGP) | `XIAOMI_TOKEN_PLAN_{CN,AMS,SGP}_API_KEY` | `xiaomi-token-plan-{cn,ams,sgp}` |

With no Anthropic key or token set, Pi 0.99.2+ uses Anthropic workload identity federation when `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, and `ANTHROPIC_IDENTITY_TOKEN_FILE` are set (plus optional `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_WORKSPACE_ID`). The Anthropic SDK exchanges and refreshes the token, re-reading the identity token file, so keep that file fresh for long sessions.

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

1. `--api-key` (runtime override)
2. `auth.json`
3. `apiKey` from `models.json`
4. Environment variables or ambient cloud credentials

Provider extensions can define their own authentication behavior.

## Provider-Specific Setup

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
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
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
  }
}
```

`providers` is an object keyed by provider ID, not an array; the optional `name` field is only a display label. A `models` entry adds or replaces a model with the same ID on that provider; use `modelOverrides` to change metadata of an existing built-in or extension model.

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

- `samplingParams` (Pi 0.84.0) is a free-form object merged verbatim into every request body after pi's own fields (its keys win) — for OpenAI-compatible APIs only (`openai-completions`, `openai-responses`, `azure-openai-responses`). Use it for server-specific knobs like llama.cpp `min_p` or vLLM `top_k`; in `modelOverrides` it merges per key. `samplingParamsByThinkingLevel` (Pi 1.0.2) overrides it per Pi thinking level (`off` … `max`, not `thinkingLevelMap` values): Pi clamps the level, then merges model `samplingParams`, the level's entry, and request-level `samplingParams`, later keys winning.
- `thinkingLevelMap` (Pi 0.72) replaces `compat.reasoningEffortMap`. Map pi levels (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) to provider values; use `null` to hide a level. Maps may contain holes (Pi 0.80.6) — e.g. expose `high` and `max` without `xhigh`. When a key is omitted, standard levels through `high` use the provider default mapping, but the extended `xhigh`/`max` levels are unsupported.
- `cost` supports request-wide input pricing tiers (Pi 0.80.6): a `tiers` array where each tier supplies a complete alternate rate set and applies to the whole request when total input usage (`input + cacheRead + cacheWrite`) exceeds `inputTokensAbove`; the highest matching threshold wins. Also usable in `modelOverrides` and extension-registered providers.
- `modelOverrides` applies to built-in and (since Pi 0.80.4) extension-registered provider models; per-model fields: `name`, `reasoning`, `thinkingLevelMap`, `input`, `cost` (partial), `contextWindow`, `maxTokens`, `samplingParams`, `headers`, `compat`, `inputLimits`, `promptCache`.
- `inputLimits.images.resize` (Pi 0.87.0) sets per-model cache-safe image encoding — `maxWidth`, `maxHeight`, `maxBytes` (base64 payload), `jpegQuality`; defaults 2000×2000, 4.5 MiB, quality 80 — applied once to attachments, `read` images, and tool-result images (switching models does not re-encode history).
- `promptCache: { short?, long? }` (Pi 0.86.0) declares best-effort cache lifetimes in seconds per retention tier; models without a lifetime for the active tier are not eligible for cache warming (see `cacheWarming` in `references/settings.md`).
- `compat.allowedFallbackModels` (Pi 0.86.0) overrides or disables Anthropic server-side fallback models; `compat.supportsMidConvoEffort` (Pi 0.84.4) marks custom Anthropic Messages models that accept per-turn effort changes.
- OpenAI-compatible local servers: `vllmPriority` and `supportsMaxOutputTokens` (Pi 0.85.0) plus configurable thinking-token budget fields for vLLM, Qwen/SGLang, and llama.cpp (Pi 0.84.3).
- `openRouterRouting` is forwarded as-is in the OpenRouter `provider` field (fallbacks, ZDR, ignore lists, throughput/latency).
- `compat.thinkingFormat` supports OpenAI-compatible reasoning variants: `openrouter` sends `reasoning: { effort }`, `together` sends `reasoning: { enabled }` plus `reasoning_effort` when supported, `qwen-chat-template` targets local Qwen-compatible servers that read `chat_template_kwargs.enable_thinking`, `chat-template` (Pi 0.79.9) sends configurable `chat_template_kwargs` via `compat.chatTemplateKwargs` — e.g. `{ "thinking": { "$var": "thinking.enabled" } }` for DeepSeek models behind vLLM/Hugging Face chat templates — and `baseten` (Pi 0.84.0) sends `chat_template_args` via `compat.chatTemplateArgs`.
- **Breaking (Pi 0.80.7):** `compat.sendSessionIdHeader` was removed. Session affinity is now controlled by `compat.sessionAffinityFormat` (`"openai"` sends `session_id`/`x-client-request-id`, `"openai-nosession"` omits the underscore-containing `session_id` header, `"openrouter"` sends `x-session-id`; default auto-detected). Replace `sendSessionIdHeader: false` with `sessionAffinityFormat: "openai-nosession"`. `sendSessionAffinityHeaders` still gates the behavior for `openai-completions`.
- `compat.deferredToolsMode: "kimi"` (Pi 0.80.9) enables Kimi's deferred tool serialization; `compat.supportsToolReferences` / `compat.supportsToolSearch` enable native dynamic tool loading on verified custom endpoints, and `compat.supportsStrictTools` / `compat.supportsOpenAIGrammarTools` / per-model `constrainedSampling` gate constrained sampling (see `references/extensions.md`). `compat.supportsFinishReason: false` (Pi 0.84.0) tells pi to infer stop/toolUse for OpenAI-compatible streams that omit `finish_reason`.
- Advanced `compat` flags exist for proxy quirks (`cacheControlFormat` — now also covering tool-result text content, `supportsReasoningEffort`, `supportsLongCacheRetention`, `supportsEagerToolInputStreaming`, `supportsStrictMode`). See [Pi `docs/models.md`](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/models.md) when a proxy rejects pi's defaults.

### Context Overflow Recovery

Pi can auto-compact and retry when a provider fails with a recognized context-window overflow. For custom providers whose overflow text Pi does not recognize, use a provider-scoped `message_end` extension handler to rewrite the finalized assistant `errorMessage` so it starts with `context_length_exceeded`.

### llama.cpp

Pi supports the llama.cpp router server (Pi 0.81.0): configure with `/login llama.cpp`, search/download Hugging Face models and load/unload with live progress via `/llama`, then select loaded models in `/model`. The model catalog persists across restarts (fixed in Pi 0.82.1). Every llama.cpp chat model is also listed as a classifier model (see [Classifier Models](#classifier-models)). `"extensions": ["-builtin:llama.cpp"]` removes the provider and `/llama`. See [Pi `docs/llama-cpp.md`](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/llama-cpp.md).

## Model Types

Since Pi 0.99.0 catalogs hold typed models: `type` is `"chat"` (the default when omitted), `"image"`, or `"classifier"`. Chat-facing reads (`getModels()`, `getAvailable()`, `ctx.modelRegistry.getAll()`, `/model`) stay chat-only. `ModelRuntime`, `ctx.modelRegistry`, and pi-ai `Models` all have `getModelsOfType(type, provider?)`, `getModelOfType(type, provider, id)`, and async `getAvailableOfType(type, provider?)`. Only `ModelRuntime` and `Models` have `getAllModels()` and `getAllAvailable()` for every type; `ctx.modelRegistry` adds `findOfType(type, provider, id)` instead. pi-ai exports `isModelType()` and `getModelType()` for mixed lists. One upstream ID may have separate chat and image entries. Sources: [models.md](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/models.md#use-classifier-models), [pi-ai types](https://github.com/earendil-works/pi/blob/v1.0.2/packages/ai/src/types.ts).

### Classifier Models

Classifiers do not chat. They answer typed questions about JSON state with probabilities, and do not appear in `/model`.

| Provider | Model IDs | Auth |
|----------|-----------|------|
| `typesafe` | `jev-latest` | `TYPESAFE_API_KEY` |
| `openrouter` | `typesafe/jev-1.13`, `~typesafe/jev-latest` | `OPENROUTER_API_KEY` or `/login` |
| `cloudflare-workers-ai` | `typesafe/jev`, `@cf/cloudflare/clef`, `@cf/cloudflare/clef-flash` (Clef, Pi 1.0.1) | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` (or the credential's `env` in `auth.json`) |
| `vercel-ai-gateway` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |
| `opencode` | `jev-1.13`, `jev-1.13-free` | `OPENCODE_API_KEY` |
| llama.cpp router | every loaded chat model ID | `/login llama.cpp` |

```typescript
const jev = ctx.modelRegistry.findOfType("classifier", "typesafe", "jev-latest");
if (jev) {
  const result = await ctx.modelRegistry.classify(
    jev,
    {
      state: { message: "The change works, thanks." },
      questions: {
        approved: {
          type: "bool",
          instructions: "Does the user approve of the result?",
          criteria: { true: "Approval", false: "No approval" },
        },
      },
    },
    { signal: ctx.signal },
  );
  const answer = result.stopReason === "stop" ? result.answers.approved : undefined;
  if (answer?.type === "bool") console.log(answer.probability);
}
```

- Question types: `choice` (`criteria` maps labels to descriptions; answer has `choice`, `probabilities`, `confidence`), `bool` (`criteria: { true, false }`; answer has `probability`), and `score` (`criteria` is an ordered list; answer has `score`, `confidence`). Pi translates `bool` to TypeSafe's wire format.
- `classify()` never rejects. Failures and aborts return `stopReason: "error"` or `"aborted"` with `errorMessage`. Check `stopReason` and each answer's `type` before use, and validate probabilities yourself if a decision depends on them (for example finite and within `[0, 1]`).
- `result.usage` carries token counts and catalog cost when the service reports them; TypeSafe's direct `jev-latest` has no catalog price.
- `jev-latest` moves with the service. Pin a versioned ID such as `openrouter`'s `typesafe/jev-1.13` when thresholds were tuned against one model.
- Codemode scripts reach classifiers through `models.classify()` (see `references/codemode.md`). The SDK equivalent is `modelRuntime.classify()`. A llama.cpp classifier accepts a per-request `temperature` to soften overconfident label probabilities.

A gate that fails closed on classifier errors is in `examples/classifier-gate.ts`.

### Image Generation

`ModelRuntime.generateImages(model, { input }, options?)` (Pi 0.99.0) generates images with runtime-resolved auth; list image models with `getModelsOfType("image")`. OpenRouter image models such as `google/gemini-2.5-flash-image` appear under the `openrouter` provider with its credential. Like `classify()`, it returns an error result rather than rejecting. Image models do not appear in `/model`: extensions call `ctx.modelRegistry.generateImages()` and codemode scripts call `models.generateImages()` (both Pi 1.0.0). Codemode adds a script's image usage to its result; an extension tool must report the returned `usage` on its own tool result, combined across calls. `input` takes text blocks plus `{ type: "image", data, mimeType }` blocks to edit or use as references; output images are base64 blocks and are not saved to disk.

In pi-ai, image models live in the same catalog as chat models: `builtinModels()` includes them, `models.getModelOfType("image", provider, id)` finds one (type `ImageModel`), `models.generateImages()` runs it, and `createProvider({ models, images })` registers image implementations. The separate `*Images*` API was removed in pi-ai 0.99.0.

## Virtual Models

A virtual model (experimental, Pi 0.99.0) is a selectable entry that routes each request to a physical model. It is for routing by task, cost, or conversation state, not for permission decisions. Source: [virtual-models.md](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/virtual-models.md), [`jev-router.ts`](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/examples/extensions/jev-router.ts).

```typescript
pi.registerVirtualModel({
  provider: "router",
  id: "auto",
  name: "Auto",
  thinkingLevels: ["low", "high"],
  route(request, ctx) {
    const sticky = request.failed ?? request.previous;
    if (request.reason !== "user" && sticky) {
      return { model: sticky.model, thinkingLevel: sticky.thinkingLevel ?? "medium" };
    }
    const id = request.thinkingLevel === "high" ? "claude-sonnet-4-5" : "claude-haiku-4-5";
    const model = ctx.modelRegistry.find("anthropic", id);
    if (!model) throw new Error(`anthropic/${id} is not in the catalog`);
    return { model, thinkingLevel: "medium" };
  },
});
```

- `route()` runs before every request with `reason` (`user`, `continuation`, `retry`, `direct`), `previous`, `failed`, `state`, `messages`, and `signal`. Returning `previous` for continuations and `failed` for retries keeps prompt caches and thinking signatures valid.
- Returned `state` (JSON) is stored on the session branch and comes back as `request.state`; `direct` requests (compaction summaries, `ctx.modelRegistry.streamSimple()`) have none.
- The route must be a physical model with credentials; throwing or returning a virtual model ends the request with an error.
- Selection (`ctx.model`, `model_change`) names the virtual model; each assistant message records the physical `provider`/`model`/`thinkingLevel`. The footer shows both; `/session` lists cost per physical model.
- `pi.unregisterVirtualModel(provider, id)` removes one (`unregisterProvider()` does not). SDK code can call `modelRuntime.registerVirtualModel(definition)`.

## Custom Providers via Extensions

Use extensions when you need custom streaming, custom headers, OAuth/device-flow logic, or want to override an existing provider's `baseUrl`/`headers`:

A config-form `models` list replaces the provider's models across chat, image, and classifier operations; image and classifier entries need an explicit `type` and implementations keyed by `api` through `images` and `classifiers`. Registering only `baseUrl` or `headers` keeps the built-in models. See [custom-provider.md](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/custom-provider.md).

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

### Custom Streaming (Breaking, Pi 0.86.0)

Custom `streamSimple` implementations receive a normalized `TranscriptContext` instead of `Context`. System prompts and tool declarations live in transcript system messages: read them with `getCurrentSystemPrompt(context.messages)` and `getCurrentTools(context.messages)` (not `context.systemPrompt` / `context.tools`), and call `collapseSystemMessages(context)` if the backend cannot accept mid-conversation system messages. `ToolCall.arguments` and `ToolResultMessage.details` must be JSON-compatible. Pi 0.84.3 also renamed `GoogleThinkingLevel` to `GoogleApiThinkingLevel`.

## SDK / Extension Auth Lookup

If extension code needs auth for a specific model request, use `getApiKeyAndHeaders(model)` rather than the removed `getApiKey(model)`:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) throw new Error(auth.error);

const { apiKey, headers } = auth;
```

This matters for providers whose headers or auth values resolve dynamically on every request. For nested model calls, `ctx.modelRegistry.streamSimple(model, context, options)` (Pi 0.86.0) resolves auth itself. In SDK code, use `ModelRuntime.getAuth(providerOrModel)` instead (Pi 0.80.8) — passing a model also resolves built-in, `models.json`, and extension model headers; see `references/sdk.md`.
