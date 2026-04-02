# Auto-Compact Plugin - Micro-Compaction for OpenClaw

Automatically clears verbose tool outputs when approaching token limits, based on Claude Code's micro-compaction algorithm.

## What is Micro-Compaction?

**Micro-compaction** is a lightweight token optimization technique that:

- Clears verbose tool outputs in-place (e.g., file contents, command outputs)
- Keeps ALL messages in conversation (no deletion or summarization)
- Runs in milliseconds (just string replacement)
- Can run frequently without disrupting conversation flow

### vs Traditional Compaction

| Feature  | Micro-Compaction   | Traditional Compaction |
| -------- | ------------------ | ---------------------- |
| Speed    | Milliseconds       | Seconds (LLM call)     |
| Messages | Keeps all          | Deletes old            |
| Method   | Clear tool outputs | Summarize conversation |
| Cost     | Free (no API call) | API tokens for summary |
| When     | At 90% usage       | At 100% limit          |

## How It Works

1. **Hook:** `message:preprocessed` - Runs before LLM sees messages
2. **Check:** Token usage ≥ 90% threshold
3. **Clear:** Replace verbose tool outputs with `[Tool output cleared to save tokens]`
4. **Result:** LLM sees cleared outputs, but session history preserved

### What Gets Cleared

**Compactable tools** (verbose outputs):

- `Read` - File contents
- `exec` - Command outputs
- `grep_tool` - Search results
- `glob_tool` - File listings
- `web_search` - Search results
- `web_fetch` - Fetched content
- `Edit` - Edit confirmations
- `Write` - Write confirmations

**Preserved:**

- Last 5 tool results (configurable)
- All non-compactable tools
- All message structure
- Tool use/result pairs

## Configuration

```json
{
  "plugins": {
    "entries": {
      "auto-compact": {
        "enabled": true,
        "config": {
          "triggerPercentage": 90,
          "preserveRecentResults": 5,
          "notifyUser": true,
          "compactableTools": [] // Empty = use defaults
        }
      }
    }
  }
}
```

### Options

- **enabled** (boolean, default: `true`) - Enable micro-compaction
- **triggerPercentage** (number, default: `90`) - Trigger at this % of token limit
- **preserveRecentResults** (number, default: `5`) - Keep last N tool outputs intact
- **notifyUser** (boolean, default: `true`) - Send notification when clearing
- **compactableTools** (array, optional) - Custom tool list (empty = defaults)

## Example

**Before micro-compaction:**

```
User: Read the file
Assistant: [tool_use: Read, id: tool_1]
User: [tool_result: tool_1, content: "... 1000 lines of code ..."]
Assistant: I see the file has...
```

**After micro-compaction:**

```
User: Read the file
Assistant: [tool_use: Read, id: tool_1]
User: [tool_result: tool_1, content: "[Tool output cleared to save tokens]"]
Assistant: I see the file has...
```

The LLM doesn't see the 1000 lines anymore, but the conversation structure is intact.

## Benefits

1. **Proactive** - Triggers at 90%, not at limit
2. **Fast** - Milliseconds, not seconds
3. **Safe** - No session writes, no file corruption
4. **Cheap** - No API calls for summarization
5. **Reversible** - Original outputs in session history

## Implementation Details

### Architecture

```
User message
    ↓
message:preprocessed hook fires
    ↓
Check token usage (90%?)
    ↓
YES: Clear tool outputs in-place
    ↓
Messages sent to LLM (with cleared outputs)
    ↓
Session file unchanged (originals preserved)
```

### Files

- `index.ts` - Plugin registration and hook handler
- `src/micro-compact.ts` - Core clearing algorithm
- `src/micro-compact.test.ts` - Unit tests (12 tests, all passing)
- `src/token-budget.ts` - Token usage tracking
- `src/types.ts` - Type definitions

### Tests

```bash
pnpm test extensions/auto-compact/src/micro-compact.test.ts
```

All 12 tests pass:

- ✓ Clears compactable tool outputs
- ✓ Preserves recent results
- ✓ Skips non-compactable tools
- ✓ Skips already-cleared results
- ✓ Handles edge cases
- ✓ Custom markers and token tracking

## Comparison to Claude Code

Our implementation is based on Claude Code's micro-compaction algorithm:

**Similarities:**

- Clears tool outputs in-place
- No message deletion
- No summarization
- Preserves conversation structure

**Differences:**

- Claude Code uses cache edits (API-level)
- We mutate messages before API call (no cache support needed)
- Claude Code has time-based triggers (idle gap)
- We trigger on token percentage only

## Migration from 1.0.0

Version 1.0.0 (the wrong implementation) did full summarization. To migrate:

**Old config (delete these):**

```json
{
  "minTokensToKeep": 20000,
  "maxTokensToKeep": 50000,
  "targetAfterCompact": 30000,
  "preserveRecentTurns": 10,
  "summaryModel": "..."
}
```

**New config (use these):**

```json
{
  "preserveRecentResults": 5,
  "compactableTools": []
}
```

## Troubleshooting

**Plugin not clearing outputs?**

- Check `enabled: true` in config
- Verify token usage ≥ 90%
- Look for `[auto-compact]` logs in gateway output

**Too many/few outputs cleared?**

- Adjust `preserveRecentResults` (default: 5)
- Customize `compactableTools` array

**Session file too large?**

- Micro-compaction preserves files on disk
- Use traditional `/compact` if disk space matters
- Or run manual cleanup of old sessions

## References

- Original issue: https://github.com/n8m8/openclaw/issues/5
- Claude Code spec: `claurst-main/spec/06_services_context_state.md`
- Design docs: `REDESIGN.md`, `ROADBLOCKS.md`
