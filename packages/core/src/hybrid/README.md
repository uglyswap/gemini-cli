# Agentic Hybrid System

This module adds multi-agent orchestration capabilities to gemini-cli, combining the CLI's robust TypeScript runtime with advanced agent coordination concepts.

## Quick Start

### Enable Agentic Mode

**Option 1: GEMINI.md Configuration**

Add to your `GEMINI.md`:

```markdown
## Agentic Mode Configuration

enableAgentic: true
agenticSnapshots: true
agenticQualityGates:
  - typescript
  - eslint
  - security-scan
agenticMaxSessions: 5
```

**Option 2: Environment Variable**

```bash
export GEMINI_AGENTIC_MODE=true
gemini
```

**Option 3: CLI Command**

```bash
gemini
> /agentic enable
```

### Using Agentic Mode

```bash
# Execute a task with multi-agent orchestration
> /agentic Add user authentication with JWT tokens and refresh rotation

# Check status
> /agentic status

# List available agents
> /agentic agents

# View trust levels
> /agentic trust
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HybridModeManager                         │
│  (CLI Integration Point)                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           EnhancedAgentOrchestrator                  │    │
│  │  (6-Phase Workflow)                                  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │                                                      │    │
│  │  Phase 1: INIT ──────► Phase 2: EXPLAIN             │    │
│  │      │                      │                        │    │
│  │      ▼                      ▼                        │    │
│  │  AgentSelector          ExecutionPlan                │    │
│  │                              │                        │    │
│  │                              ▼                        │    │
│  │  Phase 3: SNAPSHOT ◄────────┘                        │    │
│  │      │                                               │    │
│  │      ▼                                               │    │
│  │  SnapshotManager                                     │    │
│  │      │                                               │    │
│  │      ▼                                               │    │
│  │  Phase 4: EXECUTE ──────► AgentSessionManager        │    │
│  │      │                         │                     │    │
│  │      │                         ▼                     │    │
│  │      │                    AgentSession (isolated)    │    │
│  │      │                         │                     │    │
│  │      ▼                         ▼                     │    │
│  │  Phase 5: VALIDATE ◄──── TrustCascadeEngine          │    │
│  │      │                                               │    │
│  │      ▼                                               │    │
│  │  GateRunner (Quality Gates)                          │    │
│  │      │                                               │    │
│  │      ▼                                               │    │
│  │  Phase 6: REPORT                                     │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Trust Cascade Engine

Manages dynamic trust levels for agents based on execution history.

```typescript
import { TrustCascadeEngine, TrustLevel } from './hybrid';

const trustEngine = new TrustCascadeEngine(workingDirectory);

// Get trust level for an agent
const level = trustEngine.calculateTrustLevel('react-specialist');
// Returns: TrustLevel.L1_SUPERVISED (for new agents)

// Get privileges based on trust
const privileges = trustEngine.getPrivileges('react-specialist');
// Returns: { allowedTools: ['read', 'edit'], requiresApproval: true, ... }

// Record successful execution (trust increases over time)
trustEngine.recordExecution('react-specialist', true);
```

**Trust Levels:**
- `L0_QUARANTINE`: Disabled agents (repeated failures)
- `L1_SUPERVISED`: New or recovering agents (strict oversight)
- `L2_GUIDED`: Standard supervision (default)
- `L3_TRUSTED`: Reduced oversight (proven reliability)
- `L4_AUTONOMOUS`: Expert agents (minimal intervention)

### 2. Agent Registry

28 specialized agents across 8 domains:

| Domain | Agents |
|--------|--------|
| Frontend | react-specialist, css-architect, accessibility-expert, performance-optimizer |
| Backend | api-designer, database-architect, auth-security, integration-specialist |
| Database | schema-designer, query-optimizer, migration-manager, data-modeler |
| Security | security-auditor, penetration-tester, compliance-checker, secret-scanner |
| Testing | unit-test-writer, e2e-test-architect, test-coverage-analyzer |
| DevOps | ci-cd-engineer, docker-specialist, infrastructure-architect |
| AI/ML | ml-engineer, prompt-engineer, vector-db-specialist |
| Documentation | technical-writer, api-documenter, architecture-diagrammer |

```typescript
import { AgentSelector, getAgentById } from './hybrid';

const selector = new AgentSelector();

// Select agents for a task
const selected = selector.selectAgents('Add JWT authentication with refresh tokens');
// Returns: [auth-security, api-designer, unit-test-writer, ...]

// Get execution order
const ordered = selector.getExecutionOrder(selected);
```

### 3. Agent Sessions (Context Isolation)

Each agent operates in its own isolated context:

```typescript
import { AgentSessionManager } from './hybrid';

const sessionManager = new AgentSessionManager(config, contentGenerator, {
  workingDirectory: '/project',
  maxConcurrentSessions: 5,
  reuseAgentSessions: true,
});

// Execute with isolated context
const result = await sessionManager.executeAgentTask(
  agent,
  'Implement the authentication middleware',
);

// Each agent has:
// - Own conversation history
// - Own token budget
// - Specialized system prompt
// - Domain-specific tool access
```

### 4. Safety Net

**Snapshots:**
```typescript
import { SnapshotManager } from './hybrid';

const snapshots = new SnapshotManager({
  workingDirectory: '/project',
  maxSnapshots: 10,
  excludePatterns: ['node_modules', '.git'],
});

// Create before risky operations
const snapshotId = await snapshots.createSnapshot('Before auth implementation');

// Restore if something goes wrong
await snapshots.restoreSnapshot(snapshotId);
```

**Quality Gates:**
```typescript
import { GateRunner, BUILT_IN_GATES } from './hybrid';

const gates = BUILT_IN_GATES.filter(g => 
  ['typescript', 'eslint', 'security-scan'].includes(g.name)
);

const runner = new GateRunner(gates, workingDirectory);
const results = await runner.runPostGates();
// Returns: [{ name: 'typescript', passed: true }, ...]
```

### 5. Enhanced Orchestrator

```typescript
import { createOrchestrator } from './hybrid';

const orchestrator = createOrchestrator(cliConfig, contentGenerator, {
  workingDirectory: '/project',
  enableSnapshots: true,
  qualityGates: ['typescript', 'eslint', 'security-scan'],
});

const report = await orchestrator.executeTask(
  'Add user authentication with JWT tokens',
  {
    onPhaseChange: (phase) => console.log(`Phase: ${phase}`),
    onApprovalRequired: async (plan) => {
      // Review plan and approve/reject
      console.log('Plan:', plan);
      return true; // or prompt user
    },
  }
);

console.log('Success:', report.success);
console.log('Agents used:', report.agentExecutions.map(e => e.agentName));
```

## Configuration Reference

### GEMINI.md Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableAgentic` | boolean | false | Enable agentic mode |
| `agenticSnapshots` | boolean | true | Create safety snapshots |
| `agenticQualityGates` | string[] | ['typescript', 'eslint'] | Gates to run |
| `agenticMaxSessions` | number | 5 | Max concurrent sessions |
| `agenticApprovalLevel` | string | 'L2_GUIDED' | Trust level requiring approval |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_AGENTIC_MODE` | Set to 'true' to enable |

## Programmatic Usage

```typescript
import { createHybridModeManager } from '@anthropic/gemini-cli-core';

const manager = createHybridModeManager(cliConfig, contentGenerator, {
  enableAgentic: true,
  agenticSnapshots: true,
});

// Execute task
const report = await manager.executeTask(
  'Refactor the payment service',
  workingDirectory,
);
```

## Best Practices

1. **Start with specific tasks**: "Add JWT auth" works better than "improve security"
2. **Review execution plans**: Always check the plan before complex operations
3. **Use snapshots**: Keep them enabled for any file-modifying operations
4. **Monitor trust levels**: Agents earn trust over time through successful executions
5. **Configure quality gates**: Enable relevant gates for your project type

## Troubleshooting

**Agents not being selected:**
- Check task keywords match agent triggers
- Use `/agentic agents` to see available agents

**Trust too low:**
- Agents start at L1_SUPERVISED
- Successful executions increase trust
- Check trust with `/agentic trust`

**Validation failures:**
- Quality gates run after execution
- Fix issues and re-run, or disable failing gates
- Snapshots auto-restore on critical failures
