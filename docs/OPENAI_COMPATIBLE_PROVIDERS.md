# OpenAI-Compatible Providers Support

This fork of Gemini CLI supports OpenAI-compatible API providers, allowing you to use:

- **Z.AI** with GLM-4.7 model
- **OpenRouter** with any supported model
- **Ollama** for local inference
- **LM Studio** for local models
- Any other OpenAI-compatible API

## Quick Start

### Z.AI (GLM-4.7)

```bash
export OPENAI_COMPATIBLE_API_KEY="your_zai_api_key"
export OPENAI_COMPATIBLE_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_COMPATIBLE_MODEL="glm-4.7"  # optional, defaults to glm-4.7

# Run gemini CLI
npx @anthropic/gemini-cli
```

### OpenRouter

```bash
export OPENAI_COMPATIBLE_API_KEY="sk-or-v1-..."
export OPENAI_COMPATIBLE_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_COMPATIBLE_MODEL="anthropic/claude-3.5-sonnet"  # or any OpenRouter model

npx @anthropic/gemini-cli
```

### Ollama (Local)

```bash
# Start Ollama first: ollama serve
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:11434/v1"
export OPENAI_COMPATIBLE_API_KEY="ollama"  # can be any value
export OPENAI_COMPATIBLE_MODEL="llama3.2"

npx @anthropic/gemini-cli
```

### LM Studio (Local)

```bash
# Start LM Studio server first
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:1234/v1"
export OPENAI_COMPATIBLE_API_KEY="lm-studio"  # can be any value

npx @anthropic/gemini-cli
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_COMPATIBLE_BASE_URL` | Yes | API endpoint URL |
| `OPENAI_COMPATIBLE_API_KEY` | Yes* | API key (*some local providers don't require one) |
| `OPENAI_COMPATIBLE_MODEL` | No | Override the model name |

### Legacy Variables (Also Supported)

For backward compatibility with heartyguy's fork:

| Variable | Maps To |
|----------|--------|
| `OPENROUTER_BASE_URL` | `OPENAI_COMPATIBLE_BASE_URL` |
| `OPENROUTER_API_KEY` | `OPENAI_COMPATIBLE_API_KEY` |

## Supported Features

| Feature | Status |
|---------|--------|
| Text generation | ✅ Supported |
| Streaming | ✅ Supported |
| Function/Tool calling | ✅ Supported |
| Token counting | ⚠️ Estimated (provider-dependent) |
| Embeddings | ❌ Not supported |

## Model Mapping

When using Gemini model names, they are automatically mapped:

### Z.AI
- `gemini-*` → `glm-4.7`
- `pro` → `glm-4.7`
- `flash` → `glm-4.7`

### OpenRouter
- `gemini-2.5-pro` → `google/gemini-2.5-pro`
- `gemini-2.5-flash` → `google/gemini-2.5-flash`
- Or use any OpenRouter model ID directly

### Ollama / LM Studio
- Model names are passed through as-is
- Use the exact model name as shown in your local provider

## Troubleshooting

### "Unsupported authType" Error

Make sure `OPENAI_COMPATIBLE_BASE_URL` is set. This variable triggers the OpenAI-compatible mode.

### Connection Refused (Ollama/LM Studio)

Ensure the local server is running:
- Ollama: `ollama serve`
- LM Studio: Enable API server in settings

### Rate Limits

Z.AI and OpenRouter have their own rate limits. Check your provider's documentation.

## Building from Source

```bash
git clone https://github.com/uglyswap/gemini-cli
cd gemini-cli
git checkout feature/openai-compatible-providers
npm install
npm run build

# Set your environment variables
export OPENAI_COMPATIBLE_BASE_URL="..."
export OPENAI_COMPATIBLE_API_KEY="..."

# Run
npm start
```
