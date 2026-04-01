# Auto-Compaction Service

Automatic micro-compaction to prevent token limit overruns while preserving context.

## Overview

This service implements intelligent auto-compaction that:
- Triggers at 90% of token budget (configurable)
- Preserves recent turns verbatim (last 10-20 messages)
- Uses binary search to find optimal cut points
- Respects tool_use/tool_result pairing (never orphans)
- Provides graceful degradation vs abrupt termination

## Architecture

```
Token Usage Monitor → Threshold Check → Cut Point Calculator
                                              ↓
                                     Tool Pair Adjuster
                                              ↓
                                     Compaction Executor
                                              ↓
                                     Summary Generator
```

## Key Components

### 1. Token Budget Tracker (`token-budget.ts`)
- Real-time session token monitoring
- Warning thresholds (75%, 90%, 95%)
- Estimated turns left calculation

### 2. Cut Point Calculator (`cut-point.ts`)
- Binary search for optimal compression point
- Respects minTokensToKeep and maxTokensToKeep bounds
- Accounts for tool call boundaries

### 3. Tool Pair Adjuster (`tool-pair-adjuster.ts`)
- Detects orphaned tool_use without tool_result
- Moves cut point to preserve complete tool cycles
- Prevents broken conversation context

### 4. Micro-Compaction Executor (`executor.ts`)
- Orchestrates the full compaction flow
- Generates summaries of dropped messages
- Tracks compaction history per session

## Configuration

```typescript
interface AutoCompactionConfig {
  enabled: boolean              // Master switch
  triggerPercentage: number     // Trigger at X% of budget (default: 90)
  minTokensToKeep: number       // Min recent context (default: 20000)
  maxTokensToKeep: number       // Max recent context (default: 50000)
  targetAfterCompact: number    // Target size post-compact (default: 30000)
  preserveRecentTurns: number   // Keep last N turns verbatim (default: 10)
  notifyUser: boolean           // Send compaction notifications
}
```

## Usage

```typescript
import { checkAutoCompaction } from './services/auto-compact/middleware.js'

// In agent turn handler
const session = await checkAutoCompaction(currentSession, config)
```

## Testing

Run tests:
```bash
npm test -- src/services/auto-compact
```

## References

- Issue: https://github.com/n8m8/openclaw/issues/5
- Upstream: https://github.com/openclaw/openclaw/issues/31787
- Claude Code: `src/services/compact/autoCompact.ts`
