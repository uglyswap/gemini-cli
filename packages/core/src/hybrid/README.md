# Hybrid Agentic System

This module combines the best features of **gemini-cli's** execution engine with **Agentic Dev System's** multi-agent orchestration concepts.

## Features

### 1. Trust Cascade (L0-L4)

Dynamic trust levels that evolve based on agent execution history:

| Level | Name | Description | Privileges |
|-------|------|-------------|------------|
| L4 | Autonomous Expert | 50+ successful executions, 95%+ success rate | Skip explanations, auto-approve |
| L3 | Trusted Agent | 20+ executions, 85%+ success rate | Standard oversight |
| L2 | Guided Agent | 5+ executions, 70%+ success rate | Full quality checks |
| L1 | Supervised Agent | New or recovering agent | Enhanced supervision |
| L0 | Quarantined | Critical failures or security issues | Disabled |

### 2. Multi-Agent System (28 Specialized Agents)

Intelligent routing to domain-specific agents:

- **Frontend** (5): frontend-developer, ui-ux-designer, accessibility-expert, performance-optimizer, animation-specialist
- **Backend** (5): backend-developer, api-architect, microservices-expert, integration-specialist, graphql-developer
- **Database** (3): database-architect, query-optimizer, migration-specialist
- **Security** (3): security-engineer, penetration-tester, compliance-auditor
- **Testing** (3): test-engineer, e2e-tester, code-reviewer
- **DevOps** (3): devops-engineer, infrastructure-architect, ci-cd-specialist
- **AI/ML** (3): ai-engineer, ml-ops-specialist, prompt-engineer
- **Documentation** (3): technical-writer, api-documenter, architecture-documenter

### 3. Safety Net

**Snapshots:**
- Automatic file snapshots before risky operations
- One-click rollback to previous state
- Diff comparison between snapshot and current state

**Quality Gates:**
- Pre-execution validation (secrets detection, etc.)
- Post-execution checks (TypeScript, ESLint, tests, etc.)
- Configurable strictness levels

### 4. Enhanced Orchestrator

6-phase execution workflow:

1. **INIT**: Task analysis, agent selection, trust check
2. **EXPLAIN**: Present plan for user approval (low-trust levels)
3. **SNAPSHOT**: Create safety snapshot
4. **EXECUTE**: Run selected agents sequentially
5. **VALIDATE**: Run post-execution quality gates
6. **REPORT**: Generate execution summary

## Quick Start

```typescript
import { createOrchestrator } from './hybrid';

// Create with defaults
const orchestrator = createOrchestrator();

// Or with custom options
const orchestrator = createOrchestrator(process.cwd(), {
  enableTrustCascade: true,
  enableMultiAgent: true,
  enableSnapshots: true,
  enableQualityGates: true,
  verbose: true,
});

// Execute a task
const result = await orchestrator.executeTask({
  description: 'Add user authentication with JWT',
  affectedFiles: ['src/auth/**/*.ts', 'src/middleware/*.ts'],
  requireApproval: true,
});

console.log(`Success: ${result.success}`);
console.log(`Quality: ${result.averageQuality}%`);
console.log(`Agents: ${result.agentResults.map(a => a.agentName).join(' → ')}`);
```

## Configuration

```typescript
import { EnhancedAgentOrchestrator, TrustLevel } from './hybrid';

const orchestrator = new EnhancedAgentOrchestrator({
  // Project settings
  projectRoot: process.cwd(),
  
  // Feature flags
  enableTrustCascade: true,
  enableMultiAgent: true,
  enableSnapshots: true,
  enableQualityGates: true,
  
  // Trust settings
  snapshotTrustThreshold: TrustLevel.L2_GUIDED,
  
  // Agent settings
  maxAgentsPerTask: 4,
  
  // Quality settings
  strictQualityGates: false,
  autoRollbackOnFailure: true,
  
  // Logging
  verbose: false,
  
  // Model configuration
  modelConfig: {
    fastModel: 'gemini-1.5-flash',
    balancedModel: 'gemini-1.5-pro',
    powerfulModel: 'gemini-1.5-pro',
  },
});
```

## Events & Callbacks

### Phase Callbacks

```typescript
orchestrator.onPhaseChange((phase, data) => {
  console.log(`Phase: ${phase}`, data);
});
```

### Approval Callback

```typescript
orchestrator.setApprovalCallback(async (task, agents, context) => {
  console.log('Agents to execute:', agents.map(a => a.name));
  const approved = await askUser('Approve? (y/n)');
  return approved === 'y';
});
```

## Direct Module Access

### Trust Engine

```typescript
import { TrustCascadeEngine, TrustLevel } from './hybrid';

const trustEngine = new TrustCascadeEngine(projectRoot);

// Get current level
const level = trustEngine.calculateTrustLevel('frontend-developer');
console.log(TrustLevel[level]); // "L3_TRUSTED"

// Get privileges
const privileges = trustEngine.getPrivileges('frontend-developer');
console.log(privileges.autoApproveChanges); // "low_risk_only"

// Record execution
trustEngine.recordExecution('frontend-developer', {
  success: true,
  qualityScore: 92,
  durationMs: 5000,
});
```

### Agent Selector

```typescript
import { AgentSelector, AGENT_REGISTRY } from './hybrid';

const selector = new AgentSelector();

// Select agents for a task
const result = selector.selectAgents('Add React component with authentication');
console.log(result.agents.map(a => a.name));
// ["Security Engineer", "Frontend Developer"]

console.log(result.complexity); // "moderate"
console.log(result.reasoning);
```

### Snapshot Manager

```typescript
import { SnapshotManager } from './hybrid';

const snapshots = new SnapshotManager(projectRoot);

// Create snapshot
const snapshot = await snapshots.createSnapshot(
  ['src/auth.ts', 'src/config.ts'],
  'Before auth changes',
  { agentId: 'security-engineer', taskDescription: 'Add JWT', trustLevel: 2 }
);

// Compare with current state
const diff = snapshots.diffSnapshot(snapshot.id);
console.log(`Modified: ${diff.summary.modified}, Deleted: ${diff.summary.deleted}`);

// Restore if needed
await snapshots.restoreSnapshot(snapshot.id);
```

### Quality Gates

```typescript
import { GateRunner, BUILT_IN_GATES } from './hybrid';

const gates = new GateRunner({ strictMode: true });

// Run pre-execution gates
const preResult = await gates.runPreGates({
  projectRoot,
  modifiedFiles: ['src/api.ts'],
  agentId: 'backend-developer',
  taskDescription: 'Add endpoint',
  trustLevel: 2,
  options: {},
});

if (!preResult.passed) {
  console.log('Blocking issues:', preResult.blockingIssues);
}
```

## File Structure

```
packages/core/src/
├── hybrid/
│   ├── index.ts          # Main exports
│   └── README.md         # This file
│
├── trust/
│   ├── types.ts          # Trust type definitions
│   ├── trust-engine.ts   # Trust cascade engine
│   └── index.ts
│
├── agents/
│   └── specialized/
│       ├── types.ts          # Agent type definitions
│       ├── agent-registry.ts # 28 specialized agents
│       ├── agent-selector.ts # Intelligent agent routing
│       └── index.ts
│
├── safety/
│   ├── snapshot/
│   │   ├── types.ts           # Snapshot types
│   │   ├── snapshot-manager.ts # Snapshot operations
│   │   └── index.ts
│   │
│   └── quality-gates/
│       ├── types.ts         # Gate types
│       ├── gate-runner.ts   # Gate execution
│       ├── built-in-gates.ts # Default gates
│       └── index.ts
│
└── orchestrator/
    ├── types.ts                  # Orchestrator types
    ├── enhanced-orchestrator.ts  # Main orchestrator
    └── index.ts
```

## Inspired By

- **gemini-cli**: TypeScript execution engine, tool registry, MCP protocol
- **Agentic Dev System v3.1 "Fusion"**: Trust cascade, specialized agents, safety protocols

## License

Apache-2.0
