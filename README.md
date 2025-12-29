# DEVORA CLI - Agentic Coding

[![License](https://img.shields.io/github/license/uglyswap/devora-cli)](https://github.com/uglyswap/devora-cli/blob/main/LICENSE)

```
══════════════════════════════════════════════════
██████╗ ███████╗██╗   ██╗ ██████╗ ██████╗  █████╗
██╔══██╗██╔════╝██║   ██║██╔═══██╗██╔══██╗██╔══██╗
██║  ██║█████╗  ██║   ██║██║   ██║██████╔╝███████║
██║  ██║██╔══╝  ╚██╗ ██╔╝██║   ██║██╔══██╗██╔══██║
██████╔╝███████╗ ╚████╔╝ ╚██████╔╝██║  ██║██║  ██║
╚═════╝ ╚══════╝  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
══════════════════════════════════════════════════
                ▓▒░ DEVORA CLI ░▒▓
               ⚡ Agentic Coding ⚡
══════════════════════════════════════════════════
```

> **DEVORA is an open-source AI agent that brings the power of multiple LLMs directly
> into your terminal. Supports OpenAI-compatible providers (Z.AI, OpenRouter,
> Ollama, LM Studio) without requiring Google authentication.**

## 🆕 Features

- ✅ **No Google authentication required** when using external providers
- ✅ **Interactive `/provider` command** - Configure providers directly in the CLI
- ✅ **Z.AI support** with GLM-4.7 model
- ✅ **OpenRouter support** for 100+ models
- ✅ **Ollama support** for local inference
- ✅ **LM Studio support** for local models
- ✅ **12 pre-configured providers** with dynamic model fetching
- ✅ Streaming and function/tool calling support
- ✅ **Automatic agent routing** - Complex tasks automatically delegated to specialized agents

## 🚀 Quick Start

```bash
# 1. Clone this repo
git clone https://github.com/uglyswap/devora-cli
cd devora-cli

# 2. Install and build
npm install
npm run build

# 3. Link globally to use "devora" command
npm link

# 4. Run DEVORA
devora
```

## ⚙️ Interactive Provider Configuration

The easiest way to configure providers is through the interactive `/provider` command:

```bash
# Open the configuration dialog
/provider

# Or configure a specific provider directly
/provider openrouter
```

### Available Commands

| Command                 | Description                           |
| ----------------------- | ------------------------------------- |
| `/provider`             | Open interactive configuration dialog |
| `/provider list`        | List all configured providers         |
| `/provider switch <id>` | Switch to a different provider        |
| `/provider remove <id>` | Remove a provider configuration       |
| `/provider status`      | Show current provider status          |

### Supported Providers (12)

| Provider          | Type   | Description                         |
| ----------------- | ------ | ----------------------------------- |
| **Google Gemini** | Cloud  | Google's Gemini models              |
| **OpenRouter**    | Cloud  | 100+ models from multiple providers |
| **Z.AI**          | Cloud  | GLM-4 models                        |
| **OpenAI**        | Cloud  | GPT-4, GPT-4o, o1 models            |
| **Anthropic**     | Cloud  | Claude 3.5, Claude 3 models         |
| **Groq**          | Cloud  | Ultra-fast inference                |
| **Together AI**   | Cloud  | Open-source models                  |
| **Mistral AI**    | Cloud  | Mistral Large, Codestral            |
| **DeepSeek**      | Cloud  | DeepSeek Coder, Chat                |
| **Ollama**        | Local  | Run models locally                  |
| **LM Studio**     | Local  | Local model server                  |
| **Custom**        | Custom | Any OpenAI-compatible endpoint      |

## 🔐 Authentication Options (Environment Variables)

### Option 1: Z.AI (GLM-4.7)

```bash
export OPENAI_COMPATIBLE_API_KEY="your_zai_key"
export OPENAI_COMPATIBLE_BASE_URL="https://api.z.ai/api/coding/paas/v4"
devora
```

### Option 2: OpenRouter (100+ Models)

```bash
export OPENAI_COMPATIBLE_API_KEY="sk-or-v1-..."
export OPENAI_COMPATIBLE_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_COMPATIBLE_MODEL="anthropic/claude-3.5-sonnet"
devora
```

### Option 3: Ollama (Local, Free)

```bash
# Start Ollama first: ollama serve
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:11434/v1"
export OPENAI_COMPATIBLE_API_KEY="ollama"
export OPENAI_COMPATIBLE_MODEL="llama3.2"
devora
```

### Option 4: LM Studio (Local)

```bash
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:1234/v1"
export OPENAI_COMPATIBLE_API_KEY="lm-studio"
devora
```

## 📋 Environment Variables

| Variable                     | Required | Description         |
| ---------------------------- | -------- | ------------------- |
| `OPENAI_COMPATIBLE_BASE_URL` | Yes\*    | API endpoint URL    |
| `OPENAI_COMPATIBLE_API_KEY`  | Yes\*    | API key             |
| `OPENAI_COMPATIBLE_MODEL`    | No       | Override model name |

\*Required only when using OpenAI-compatible providers.

## 📦 Installation

### From Source

```bash
git clone https://github.com/uglyswap/devora-cli
cd devora-cli
npm install
npm run build
npm link  # Install globally as "devora" command
```

### Pre-requisites

- Node.js version 20 or higher
- macOS, Linux, or Windows

## 📋 Core Features

### Code Understanding & Generation

- Query and edit large codebases
- Generate new apps from PDFs, images, or sketches
- Debug issues with natural language

### Automation & Integration

- Automate operational tasks
- Use MCP servers for custom integrations
- Run non-interactively in scripts

### Built-in Tools

- 🔧 File operations (read, write, edit)
- 🔧 Shell command execution
- 🔧 Web fetching and Google Search grounding
- 🔧 MCP (Model Context Protocol) support

## 🤖 Agentic Mode

DEVORA includes an **enhanced multi-agent orchestration system** that's **enabled by default**.

### What is Agentic Mode?

Agentic mode uses **28 specialized AI agents** organized into **8 domain teams** that work together to complete complex tasks.

### 🔄 Automatic Routing

When you send a message, DEVORA **automatically analyzes** your query and routes it to the appropriate specialized agents:

```
You: "Create a React component with authentication"
     ↓
🔍 AgentSelector analyzes keywords → matches Frontend + Security agents
     ↓
🤖 HybridModeManager orchestrates multi-agent execution
     ↓
📊 ExecutionReport shows agent contributions and results
```

**No manual intervention needed** - just describe your task naturally!

### 🏗️ Agent Teams

- 🎨 **Frontend Team** (5 agents) - React, TypeScript, UI/UX, Accessibility, Performance
- ⚙️ **Backend Team** (5 agents) - APIs, Architecture, Microservices, Integration, GraphQL
- 🗄️ **Database Team** (3 agents) - PostgreSQL, Query Optimization, Migrations
- 🔒 **Security Team** (3 agents) - OWASP, Penetration Testing, Compliance
- 🧪 **Testing Team** (3 agents) - Unit Tests, E2E, Code Review
- 🚀 **DevOps Team** (3 agents) - Docker, Kubernetes, CI/CD
- 🤖 **AI/ML Team** (3 agents) - LLM APIs, MLOps, Prompt Engineering
- 📚 **Documentation Team** (3 agents) - Technical Writing, API Docs, Architecture

### ⚡ Execution Modes

DEVORA supports 3 execution modes to balance **speed** vs **quality**:

| Mode         | Description                                                      | Use Case                           |
| ------------ | ---------------------------------------------------------------- | ---------------------------------- |
| `SPEED`      | Maximum parallelization, all independent agents run concurrently | Quick prototyping, iterations      |
| `BALANCED`   | Domain-level parallelization with standard validation            | Regular development                |
| `CONFIDENCE` | Sequential execution with full validation **(DEFAULT)**          | Production code, critical features |

```bash
# Set execution mode via environment variable
export DEVORA_EXECUTION_MODE=confidence

# Or in DEVORA.md configuration
# executionMode: confidence
```

**CONFIDENCE mode** (default) ensures:

- Implicit consensus through domain-ordered execution (security → database → backend → frontend → testing → docs)
- Full quality gate validation
- DiffValidator for code change verification
- Best for **perfect code** quality

### 🔄 Parallel Execution

In `SPEED` and `BALANCED` modes, agents are grouped by domain dependencies:

```
Group 1 (parallel): security + database
     ↓ (wait)
Group 2 (parallel): backend + api-architect
     ↓ (wait)
Group 3 (parallel): frontend + ui-ux + accessibility
     ↓ (wait)
Group 4 (parallel): testing + e2e + code-review
     ↓ (wait)
Group 5 (parallel): documentation + devops
```

This ensures proper dependency order while maximizing parallelism.

### 🧠 Enhanced Workflow Components

DEVORA includes advanced components for **production-quality code generation**:

| Component              | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **AnalyzerAgent**      | Analyzes your codebase before generation (conventions, frameworks, patterns, tests) |
| **ValidationPipeline** | Integrated TypeScript + ESLint + Security scanning after each change                |
| **FeedbackLoop**       | Intelligent retry with exponential backoff and max iterations                       |
| **ErrorMemory**        | Learns from errors across sessions to suggest fixes faster                          |
| **TDDWorkflow**        | Test-driven development with RED → GREEN → REFACTOR phases                          |
| **RefactorAgent**      | Detects code smells and suggests optimizations post-review                          |
| **DocAgent**           | Generates README, API docs, and architecture diagrams                               |

#### How It Works

```
1. INIT     → AnalyzerAgent scans codebase, creates TechContextDocument
2. EXPLAIN  → Plan generation with trust-based privileges
3. SNAPSHOT → Safety backup before execution
4. EXECUTE  → Agents run with shared context
5. VALIDATE → ValidationPipeline checks types, lint, security
6. REPORT   → ErrorMemory records patterns for learning
```

#### Error Learning

ErrorMemory persists error patterns to `.devora/error-memory.json`:

- Tracks error frequency across sessions
- Suggests fixes based on history
- Improves over time with each correction

### 🔧 Quick Commands

```bash
# Check agentic status
/agentic status

# Disable agentic mode
/agentic disable

# Execute a task with agents
/agentic implement user authentication with JWT

# View agent trust scores
/agentic trust

# List available agents
/agentic agents
```

## 🚀 Usage Examples

### Start in current directory

```bash
devora
```

### Use specific model

```bash
devora -m gemini-2.5-flash
# or with Z.AI
devora -m glm-4.7
```

### Non-interactive mode

```bash
devora -p "Explain the architecture of this codebase"
```

### JSON output for scripts

```bash
devora -p "List all functions" --output-format json
```

## 📚 Documentation

- [**Quickstart Guide**](./docs/get-started/index.md)
- [**Configuration Guide**](./docs/get-started/configuration.md)
- [**Commands Reference**](./docs/cli/commands.md)
- [**MCP Server Integration**](./docs/tools/mcp-server.md)
- [**OpenAI-Compatible Providers Guide**](./docs/OPENAI_COMPATIBLE_PROVIDERS.md)

## 🔗 Links

- **Z.AI Docs**: [docs.z.ai](https://docs.z.ai)
- **OpenRouter**: [openrouter.ai](https://openrouter.ai)

## 🤝 Contributing

Contributions welcome! Based on the original [Gemini CLI](https://github.com/google-gemini/gemini-cli) which is Apache 2.0 licensed.

## 📄 License

Apache License 2.0 - See [LICENSE](LICENSE)

---

<p align="center">
  <strong>DEVORA CLI</strong> • ⚡ Agentic Coding ⚡
</p>
