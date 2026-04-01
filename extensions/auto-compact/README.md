# Auto-Compaction Plugin

Automatic micro-compaction for OpenClaw to prevent token limit overruns.

## Overview

This plugin automatically compacts sessions when they approach token limits (default: 90%), preventing abrupt terminations and maintaining conversation quality.

**Key Features:**

- ✅ Proactive compaction at 90% token usage (configurable)
- ✅ Binary search optimization (O(log n) cut point calculation)
- ✅ Tool call safety (never orphans tool_use/tool_result pairs)
- ✅ 4-level warning system
- ✅ Compaction history tracking
- ✅ User notifications

## Installation

The plugin is bundled with OpenClaw by default. Enable it in your config:

```yaml
plugins:
  entries:
    auto-compact:
      enabled: true
      config:
        enabled: true
        triggerPercentage: 90
        notifyUser: true
```

## Configuration

All settings are optional (defaults shown):

```yaml
plugins:
  entries:
    auto-compact:
      enabled: true
      config:
        # Enable automatic compaction
        enabled: true

        # Trigger at 90% of token budget
        triggerPercentage: 90

        # Minimum tokens to keep after compaction
        minTokensToKeep: 20000

        # Maximum tokens to keep after compaction
        maxTokensToKeep: 50000

        # Target token count after compaction
        targetAfterCompact: 30000

        # Preserve this many recent turns verbatim
        preserveRecentTurns: 10

        # Send notification when compaction occurs
        notifyUser: true

        # Optional: Use different model for summaries
        # summaryModel: "openrouter/anthropic/claude-sonnet-4-5"
```

## How It Works

### Trigger Mechanism

The plugin hooks into two lifecycle events:

1. **`message:sent`** - After agent responds (primary)
2. **`message:received`** - Before processing user message (fallback)

This proactive approach means:

- Compaction happens **before** hitting the limit
- Sessions rarely reach OpenClaw's emergency compaction
- Users get smooth, uninterrupted conversations

### Compaction Flow

```
User message → Agent processes → Agent responds
                                      ↓
                            message:sent hook fires
                                      ↓
                      Check token usage (90%?)
                                      ↓
                              YES: Compact!
                              NO: Continue
                                      ↓
                        Calculate optimal cut point
                                      ↓
                        Preserve recent turns
                                      ↓
                        Generate summary of old messages
                                      ↓
                        Save compacted session
                                      ↓
                        Notify user (if enabled)
```

### Cut Point Algorithm

Uses binary search to find the optimal compression point:

1. **Target:** Keep `targetAfterCompact` tokens (default: 30k)
2. **Bounds:** Between `minTokensToKeep` and `maxTokensToKeep`
3. **Preserve:** Last `preserveRecentTurns` messages always kept
4. **Safety:** Adjusts to avoid orphaning tool_use/tool_result pairs

**Time Complexity:** O(log n) for cut point + O(n) for tool pair check = **O(n log n)**

### Tool Call Safety

The plugin detects tool_use/tool_result pairs and ensures they stay together:

**Before adjustment:**

```
[older messages]
tool_use: read_file          ← Would be cut here
tool_result: file contents   ← Orphaned!
[recent messages]
```

**After adjustment:**

```
[older messages + both tool messages]  ← Moved cut point
[recent messages]
```

## Performance

**Benchmarks:**

- 100 messages: < 100ms
- 500 messages: < 300ms
- 1000 messages: < 500ms

**Token Efficiency:**

- Average reclaim: 40-60% of total tokens
- Minimum threshold: 20% (else skips compaction)
- Best case: 80%+ reclaim

## Examples

### Basic Usage

Default settings work for most cases:

```yaml
plugins:
  entries:
    auto-compact:
      enabled: true
```

### Aggressive Compaction

Compact earlier and keep less context:

```yaml
plugins:
  entries:
    auto-compact:
      config:
        triggerPercentage: 85 # Trigger at 85%
        targetAfterCompact: 20000 # Keep less
        preserveRecentTurns: 5 # Fewer recent turns
```

### Conservative Compaction

Wait longer and keep more context:

```yaml
plugins:
  entries:
    auto-compact:
      config:
        triggerPercentage: 95 # Wait until 95%
        targetAfterCompact: 40000 # Keep more
        preserveRecentTurns: 15 # More recent turns
```

### Silent Mode

No user notifications:

```yaml
plugins:
  entries:
    auto-compact:
      config:
        notifyUser: false
```

## User Experience

When compaction occurs, users see (if `notifyUser: true`):

```
🗜️ Auto-compaction triggered

Compressed 50 old messages into summary
Reclaimed 12,450 tokens (68%)
Session continues with 21 messages preserved
```

## Troubleshooting

### Plugin Not Running

Check if enabled:

```bash
openclaw plugins list | grep auto-compact
```

Should show:

```
✓ auto-compact (bundled)
```

### Too Frequent Compaction

Increase trigger threshold:

```yaml
triggerPercentage: 95 # Wait longer
```

### Too Much Context Lost

Increase preservation:

```yaml
preserveRecentTurns: 20 # Keep more recent turns
targetAfterCompact: 50000 # Keep more tokens overall
```

### Performance Issues

The plugin runs async and shouldn't block responses. If you see delays:

1. Check logs: `openclaw logs | grep auto-compact`
2. Consider disabling notifications: `notifyUser: false`
3. Increase `minTokensToKeep` to reduce compaction frequency

## Development

### Testing

Run unit tests:

```bash
pnpm vitest run extensions/auto-compact/src/*.test.ts
```

All 22 tests should pass.

### Debugging

Enable debug logging:

```yaml
logging:
  level: debug
  subsystems:
    plugin:auto-compact: debug
```

Then check logs:

```bash
openclaw logs | grep "plugin:auto-compact"
```

## Architecture

```
extensions/auto-compact/
├── openclaw.plugin.json    # Plugin manifest
├── package.json             # NPM metadata
├── index.ts                 # Hook handlers
├── README.md                # This file
└── src/
    ├── types.ts             # TypeScript types
    ├── token-budget.ts      # Usage monitoring
    ├── cut-point.ts         # Binary search algorithm
    ├── tool-pair-adjuster.ts # Tool call safety
    ├── executor.ts          # Compaction orchestration
    ├── middleware.ts        # Session integration
    └── integration.ts       # Helper functions
```

## Related

- **Issue:** https://github.com/n8m8/openclaw/issues/5
- **Upstream:** https://github.com/openclaw/openclaw/issues/31787
- **Inspired by:** Claude Code (Claurst) fan remake

## License

MIT
