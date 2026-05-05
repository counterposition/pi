# Providers & Custom Models

Pi supports subscription-based providers via OAuth, API-key providers via env vars or `auth.json`, and custom providers via `models.json` or extensions.

## Subscription Providers

Use `/login` in interactive mode, then select a provider. The `/login` selector is fuzzy-searchable and shows where each entry's auth comes from (`--api-key`, env var, custom provider) without leaking the secret.

- Anthropic Claude Pro / Max — third-party usage draws from extra usage and is billed per token (suppress the warning via `warnings.anthropicExtraUsage`)
- OpenAI ChatGPT Plus / Pro (Codex)
- GitHub Copilot

Use `/logout` to clear stored OAuth credentials. Pi 0.71.0 removed built-in Google Gemini CLI and Google Antigravity providers.

## API Key Providers

| Provider | Env Var | `auth.json` key |
|----------|---------|-----------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` | `azure-openai-responses` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
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
| OpenCode Zen | `OPENCODE_API_KEY` | `opencode` |
| OpenCode Go | `OPENCODE_API_KEY` | `opencode-go` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| Moonshot | `MOONSHOT_API_KEY` | `moonshot` |
| Xiaomi MiMo | `XIAOMI_API_KEY` | `xiaomi` |
| Xiaomi MiMo Token Plan (CN/AMS/SGP) | `XIAOMI_TOKEN_PLAN_{CN,AMS,SGP}_API_KEY` | `xiaomi-token-plan-{cn,ams,sgp}` |

## Auth File

`~/.pi/agent/auth.json` stores API keys and OAuth tokens with `0600` permissions:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "!op read 'OpenAI API Key'" },
  "google": { "type": "api_key", "key": "GEMINI_API_KEY" }
}
```

`key` values can be:

- A literal secret
- An environment variable name
- A shell command prefixed with `!`

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
# Cognitive Services endpoints are also supported and auto-normalized to /openai/v1:
# export AZURE_OPENAI_BASE_URL=https://your-resource.cognitiveservices.azure.com
# Or supply the resource name only:
export AZURE_OPENAI_RESOURCE_NAME=your-resource

export AZURE_OPENAI_API_VERSION=2024-02-01
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP=gpt-4o=my-gpt4o
```

### Amazon Bedrock

Pi supports standard AWS auth flows:

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

- `thinkingLevelMap` (Pi 0.72) replaces `compat.reasoningEffortMap`. Map pi levels (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`) to provider values; use `null` to hide a level.
- `openRouterRouting` is forwarded as-is in the OpenRouter `provider` field (fallbacks, ZDR, ignore lists, throughput/latency).
- Advanced `compat` flags exist for proxy quirks (`cacheControlFormat`, `supportsLongCacheRetention`, `supportsEagerToolInputStreaming`, `sendSessionIdHeader`, `sendSessionAffinityHeaders`). See [pi-mono `docs/models.md`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) when a proxy rejects pi's defaults.

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

If extension or SDK code needs auth for a specific model request, use `getApiKeyAndHeaders(model)` rather than the removed `getApiKey(model)`:

```typescript
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) throw new Error(auth.error);

const { apiKey, headers } = auth;
```

This matters for providers whose headers or auth values resolve dynamically on every request.
