# Gemini CLI (Fork with OpenAI-Compatible Providers)

[![Version](https://img.shields.io/npm/v/@google/gemini-cli)](https://www.npmjs.com/package/@google/gemini-cli)
[![License](https://img.shields.io/github/license/google-gemini/gemini-cli)](https://github.com/google-gemini/gemini-cli/blob/main/LICENSE)

> **This fork adds support for OpenAI-compatible providers (Z.AI, OpenRouter, Ollama, LM Studio) without requiring Google authentication.**

![Gemini CLI Screenshot](./docs/assets/gemini-screenshot.png)

Gemini CLI is an open-source AI agent that brings the power of Gemini directly
into your terminal. This fork extends it to work with any OpenAI-compatible API.

## 🆕 What's New in This Fork

- ✅ **No Google authentication required** when using external providers
- ✅ **Z.AI support** with GLM-4.7 model
- ✅ **OpenRouter support** for 100+ models
- ✅ **Ollama support** for local inference
- ✅ **LM Studio support** for local models
- ✅ Streaming and function/tool calling support
- ✅ Backward compatible with original Google auth

## 🚀 Quick Start with Z.AI (GLM-4.7)

```bash
# 1. Clone this fork
git clone https://github.com/uglyswap/gemini-cli
cd gemini-cli

# 2. Install and build
npm install
npm run build

# 3. Configure Z.AI
export OPENAI_COMPATIBLE_API_KEY="your_zai_api_key"
export OPENAI_COMPATIBLE_BASE_URL="https://api.z.ai/api/coding/paas/v4"

# 4. Run
npm start
```

## 🔐 Authentication Options

### Option 1: Z.AI (GLM-4.7) — No Google Account Needed

```bash
export OPENAI_COMPATIBLE_API_KEY="your_zai_key"
export OPENAI_COMPATIBLE_BASE_URL="https://api.z.ai/api/coding/paas/v4"
gemini
```

### Option 2: OpenRouter (100+ Models)

```bash
export OPENAI_COMPATIBLE_API_KEY="sk-or-v1-..."
export OPENAI_COMPATIBLE_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_COMPATIBLE_MODEL="anthropic/claude-3.5-sonnet"  # or any model
gemini
```

### Option 3: Ollama (Local, Free)

```bash
# Start Ollama first: ollama serve
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:11434/v1"
export OPENAI_COMPATIBLE_API_KEY="ollama"
export OPENAI_COMPATIBLE_MODEL="llama3.2"
gemini
```

### Option 4: LM Studio (Local)

```bash
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:1234/v1"
export OPENAI_COMPATIBLE_API_KEY="lm-studio"
gemini
```

### Option 5: Original Google Auth (Still Supported)

All original authentication methods still work:

- **Login with Google**: Free tier with 60 req/min
- **Gemini API Key**: `export GEMINI_API_KEY="..."`
- **Vertex AI**: Enterprise features

See [Authentication Guide](./docs/get-started/authentication.md) for details.

## 📋 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_COMPATIBLE_BASE_URL` | Yes* | API endpoint URL |
| `OPENAI_COMPATIBLE_API_KEY` | Yes* | API key |
| `OPENAI_COMPATIBLE_MODEL` | No | Override model name |

*Required only when using OpenAI-compatible providers.

### Legacy Variables (Also Supported)

| Variable | Maps To |
|----------|--------|
| `OPENROUTER_BASE_URL` | `OPENAI_COMPATIBLE_BASE_URL` |
| `OPENROUTER_API_KEY` | `OPENAI_COMPATIBLE_API_KEY` |

## 📦 Installation

### From Source (Recommended for this fork)

```bash
git clone https://github.com/uglyswap/gemini-cli
cd gemini-cli
npm install
npm run build
npm link  # Optional: install globally
```

### Pre-requisites

- Node.js version 20 or higher
- macOS, Linux, or Windows

## 📋 Features

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

## 🤖 Agentic Mode (NEW)

This fork includes an **enhanced multi-agent orchestration system** that's **enabled by default**.

### What is Agentic Mode?

Agentic mode uses **28 specialized AI agents** organized into **8 domain teams** that work together to complete complex tasks. Each agent has deep expertise in its domain and collaborates with others when needed.

**All agents use your selected model** for maximum quality - no tier-based degradation.

### 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enhanced Orchestrator                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Agent   │  │  Trust   │  │ Snapshot │  │  Quality Gates   │ │
│  │ Selector │  │  Engine  │  │ Manager  │  │  (Pre/Post)      │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Session    │      │   Session    │      │   Session    │
│   Manager    │      │   Manager    │      │   Manager    │
│  (Agent A)   │      │  (Agent B)   │      │  (Agent C)   │
└──────────────┘      └──────────────┘      └──────────────┘
```

### 📋 Complete Agent Registry (28 Agents)

#### 🎨 Frontend Team (5 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Frontend Developer** | React, TypeScript, Tailwind, components | `react`, `component`, `ui`, `tsx`, `tailwind` |
| **UI/UX Designer** | Design systems, themes, layouts | `design`, `style`, `layout`, `ux`, `theme` |
| **Accessibility Expert** | WCAG, ARIA, screen readers | `a11y`, `accessibility`, `wcag`, `aria` |
| **Performance Optimizer** | Core Web Vitals, bundle optimization | `performance`, `optimize`, `lighthouse`, `lcp` |
| **Animation Specialist** | Framer Motion, GSAP, transitions | `animation`, `transition`, `motion`, `framer` |

#### ⚙️ Backend Team (5 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Backend Developer** | Node.js APIs, Express, Fastify, Hono | `api`, `endpoint`, `server`, `middleware` |
| **API Architect** | OpenAPI, versioning, rate limiting | `architecture`, `api design`, `swagger` |
| **Microservices Expert** | Kafka, RabbitMQ, CQRS, Saga | `microservice`, `distributed`, `event-driven` |
| **Integration Specialist** | OAuth, webhooks, third-party APIs | `integration`, `webhook`, `oauth`, `stripe` |
| **GraphQL Developer** | Apollo, resolvers, subscriptions | `graphql`, `query`, `mutation`, `resolver` |

#### 🗄️ Database Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Database Architect** | PostgreSQL, Prisma, Drizzle, RLS | `database`, `schema`, `postgres`, `prisma` |
| **Query Optimizer** | Execution plans, indexes, N+1 | `query`, `slow query`, `index`, `explain` |
| **Migration Specialist** | Zero-downtime migrations, rollbacks | `migration`, `schema change`, `rollback` |

#### 🔒 Security Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Security Engineer** | OWASP Top 10, Auth, RLS, encryption | `security`, `auth`, `owasp`, `xss`, `injection` |
| **Penetration Tester** | Vulnerability scanning, threat modeling | `pentest`, `vulnerability`, `security audit` |
| **Compliance Auditor** | GDPR, HIPAA, SOC2, PCI | `compliance`, `gdpr`, `hipaa`, `privacy` |

#### 🧪 Testing Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Test Engineer** | Jest, Vitest, TDD, mocking | `test`, `unit test`, `coverage`, `jest` |
| **E2E Tester** | Playwright, Cypress, visual regression | `e2e`, `playwright`, `cypress`, `browser test` |
| **Code Reviewer** | Code quality, SOLID, technical debt | `review`, `code review`, `refactor`, `quality` |

#### 🚀 DevOps Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **DevOps Engineer** | Docker, Kubernetes, monitoring | `devops`, `deploy`, `docker`, `kubernetes` |
| **Infrastructure Architect** | Terraform, AWS, GCP, Azure, IaC | `infrastructure`, `terraform`, `aws`, `vpc` |
| **CI/CD Specialist** | GitHub Actions, GitLab CI, pipelines | `ci`, `cd`, `github actions`, `pipeline` |

#### 🤖 AI/ML Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **AI Engineer** | LLM APIs, LangChain, RAG, embeddings | `ai`, `llm`, `openai`, `langchain`, `rag` |
| **MLOps Specialist** | Model training, serving, experiment tracking | `mlops`, `model`, `training`, `inference` |
| **Prompt Engineer** | System prompts, few-shot, chain-of-thought | `prompt`, `prompt engineering`, `template` |

#### 📚 Documentation Team (3 agents)

| Agent | Specialization | Trigger Keywords |
|-------|----------------|------------------|
| **Technical Writer** | README, tutorials, guides | `documentation`, `readme`, `docs`, `guide` |
| **API Documenter** | OpenAPI specs, Postman collections | `api docs`, `swagger`, `api reference` |
| **Architecture Documenter** | ADRs, C4 diagrams, system design | `adr`, `architecture decision`, `diagram` |

### 🛡️ Trust Cascade System

Agents earn trust through successful task completion. Trust level determines autonomy:

| Level | Name | Requirements | Privileges |
|-------|------|--------------|------------|
| **L4** | Autonomous Expert | 50+ tasks, 95% success | Skip reviews, auto-approve, 5 parallel agents |
| **L3** | Trusted Agent | 20+ tasks, 85% success | Standard oversight, 3 parallel agents |
| **L2** | Guided Agent | 5+ tasks, 70% success | Full quality checks, 2 parallel agents |
| **L1** | Supervised | New agent | Enhanced supervision, 1 agent at a time |
| **L0** | Quarantine | Critical failures | Disabled, read-only |

**Trust builds automatically** - successful executions promote agents, failures demote them.

### ⚡ 6-Phase Execution Workflow

```
┌─────────┐   ┌─────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌────────┐
│  INIT   │ → │ EXPLAIN │ → │ SNAPSHOT │ → │ EXECUTE │ → │ VALIDATE │ → │ REPORT │
└─────────┘   └─────────┘   └──────────┘   └─────────┘   └──────────┘   └────────┘
    │              │              │              │              │             │
 Select        Generate       Create         Run          Quality        Final
 agents         plan         backup        agents         gates         summary
```

1. **INIT**: Analyze task and select appropriate agents
2. **EXPLAIN**: Generate execution plan with trust-based privileges
3. **SNAPSHOT**: Create safety backup before modifications
4. **EXECUTE**: Run agents with isolated sessions
5. **VALIDATE**: Run quality gates (TypeScript, ESLint, security)
6. **REPORT**: Generate comprehensive execution report

### ✅ Quality Gates

Built-in quality checks run automatically:

| Gate | Timing | Description |
|------|--------|-------------|
| **TypeScript** | Post | Type checking with `tsc --noEmit` |
| **ESLint** | Post | Code quality with configured rules |
| **Security Scan** | Post | `npm audit` for vulnerabilities |
| **Secrets Detection** | Pre | Scan for API keys, passwords, tokens |
| **Test Coverage** | Post | Jest/Vitest coverage thresholds |
| **File Size** | Post | Warn about files > 500KB |
| **Complexity** | Post | Function/file length analysis |

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

# Force specific agents
/agentic --agents=security-engineer,test-engineer review this code
```

### ⚙️ Configuration

In your `GEMINI.md`:
```yaml
enableAgentic: true           # Enable/disable (default: true)
agenticSnapshots: true        # Code snapshots for rollback
agenticMaxSessions: 5         # Max concurrent agent sessions
agenticQualityGates:          # Quality checks to run
  - typescript
  - eslint
  - security-scan
  - secrets-detection
```

Or via environment:
```bash
export GEMINI_AGENTIC_MODE=false  # Disable agentic mode
```

### 🎯 Key Benefits

| Benefit | Description |
|---------|-------------|
| **Best Quality Always** | All agents use your selected model (no flash/pro switching) |
| **Context Isolation** | Each agent has its own session, preventing context overflow |
| **Trust System** | Agents build reputation through successful task completion |
| **Quality Gates** | Automatic TypeScript/ESLint/security checks |
| **Snapshots** | Automatic code backups with easy rollback |
| **Multi-Provider** | Works with Gemini, Z.AI, OpenRouter, Ollama, LM Studio |
| **Domain Expertise** | 28 specialized agents covering all development areas |

## 🚀 Usage Examples

### Start in current directory

```bash
gemini
```

### Use specific model

```bash
gemini -m gemini-2.5-flash
# or with Z.AI
gemini -m glm-4.7
```

### Non-interactive mode

```bash
gemini -p "Explain the architecture of this codebase"
```

### JSON output for scripts

```bash
gemini -p "List all functions" --output-format json
```

## 📚 Documentation

- [**Quickstart Guide**](./docs/get-started/index.md)
- [**Configuration Guide**](./docs/get-started/configuration.md)
- [**Commands Reference**](./docs/cli/commands.md)
- [**MCP Server Integration**](./docs/tools/mcp-server.md)
- [**OpenAI-Compatible Providers Guide**](./docs/OPENAI_COMPATIBLE_PROVIDERS.md)

## 🔗 Links

- **Original Repo**: [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- **Z.AI Docs**: [docs.z.ai](https://docs.z.ai)
- **OpenRouter**: [openrouter.ai](https://openrouter.ai)

## 🤝 Contributing

Contributions welcome! This fork is based on the original [Gemini CLI](https://github.com/google-gemini/gemini-cli) which is Apache 2.0 licensed.

## 📄 License

Apache License 2.0 - See [LICENSE](LICENSE)

---

<p align="center">
  Fork maintained by <a href="https://github.com/uglyswap">uglyswap</a> • Original by Google
</p>
