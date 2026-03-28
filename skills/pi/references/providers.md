# Providers & Custom Models

Pi supports 20+ LLM providers out of the box and allows adding custom providers via `models.json` or extensions.

## Built-in Providers

### Subscription-based (OAuth via `/login`)

| Provider | Subscription |
|----------|-------------|
| Anthropic | Claude Pro / Max |
| OpenAI | ChatGPT Plus / Pro |
| GitHub Copilot | Copilot subscription |
| Google | Google AI / Vertex |

### API Key Providers

| Provider | Env Variable | Auth.json Key |
|----------|-------------|---------------|
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| Google | `GOOGLE_API_KEY` | `google` |
| xAI | `XAI_API_KEY` | `xai` |
| Groq | `GROQ_API_KEY` | `groq` |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| Together | `TOGETHER_API_KEY` | `together` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| Sambanova | `SAMBANOVA_API_KEY` | `sambanova` |

## Credential Priority

1. CLI flags (`--api-key`)
2. `~/.pi/agent/auth.json` entries
3. Environment variables
4. Custom provider config in `models.json`

## Auth File Format

`~/.pi/agent/auth.json` (permissions: `0600`):

```json
{
  "anthropic": {
    "key": "sk-ant-..."
  },
  "openai": {
    "key": "!op read 'OpenAI API Key'"
  },
  "google": {
    "key": "GOOGLE_API_KEY"
  }
}
```

Key value resolution:

- **Literal:** `"sk-ant-..."` — used directly
- **Shell command:** `"!command"` — executes command, uses stdout
- **Env variable:** `"ENV_VAR_NAME"` — reads from environment

## Custom Models via models.json

`~/.pi/agent/models.json`:

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
          "reasoning": false
        }
      ]
    }
  ]
}
```

### Supported API Types

| API | Value |
|-----|-------|
| OpenAI Chat Completions | `"openai-completions"` |
| OpenAI Responses | `"openai-responses"` |
| Anthropic Messages | `"anthropic-messages"` |
| Google Generative AI | `"google-generative-ai"` |
| Google Vertex AI | `"google-vertex"` |
| Azure OpenAI | `"azure-openai-responses"` |
| Mistral | `"mistral-conversations"` |
| Amazon Bedrock | `"bedrock-converse-stream"` |

### Model Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | string | Model ID sent to API |
| `name` | No | string | Human-readable display name |
| `reasoning` | No | boolean | Supports extended thinking |
| `input` | No | string[] | `["text"]` or `["text", "image"]` |
| `contextWindow` | No | number | Max context tokens |
| `maxTokens` | No | number | Max output tokens |
| `cost` | No | object | `{ input, output, cacheRead, cacheWrite }` per million tokens |

### Provider Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Provider identifier |
| `baseUrl` | Yes | API endpoint URL |
| `api` | Yes | API type (see table above) |
| `apiKey` | Yes | API key (literal, env var, or shell command) |
| `models` | Yes | Array of model definitions |
| `headers` | No | Custom HTTP headers (same value resolution as apiKey) |

### Compatibility Settings

For partially OpenAI-compatible APIs, use the `compat` field on models:

```json
{
  "compat": {
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false,
    "supportsStreamOptions": true,
    "openRouterProviderOrder": ["anthropic", "google"]
  }
}
```

## Cloud Providers

### Azure OpenAI

```json
{
  "name": "azure-openai",
  "baseUrl": "https://myresource.openai.azure.com",
  "api": "azure-openai-responses",
  "apiKey": "AZURE_OPENAI_API_KEY",
  "models": [{ "id": "gpt-4o", "name": "GPT-4o" }]
}
```

### Amazon Bedrock

Uses AWS credentials (profile, IAM keys, or bearer tokens). Set `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Pi auto-enables Bedrock for Claude models when credentials are available.

### Google Vertex AI

Uses Application Default Credentials: `gcloud auth application-default login`.

## Custom Provider via Extension

For full control (custom streaming, OAuth, etc.):

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", {
    baseUrl: "https://api.example.com",
    api: "openai-completions",
    apiKey: "my-key",
    models: [
      { id: "my-model", name: "My Model", contextWindow: 128000, maxTokens: 4096 }
    ],
    // Optional: custom streaming for non-standard APIs
    streamSimple: async (model, context, options) => {
      // Return AsyncIterable<AssistantMessageEvent>
    },
    // Optional: OAuth device flow
    oauth: {
      deviceCodeUrl: "https://auth.example.com/device",
      tokenUrl: "https://auth.example.com/token",
      clientId: "my-client-id",
      scopes: ["chat"],
    },
  });
}
```

## Overriding Built-in Providers

To route a built-in provider through a proxy while keeping its models:

```json
{
  "providers": [
    {
      "name": "anthropic",
      "baseUrl": "https://my-proxy.example.com/v1",
      "apiKey": "proxy-key"
    }
  ]
}
```

Models.json reloads automatically when accessing `/model` — no restart needed.
