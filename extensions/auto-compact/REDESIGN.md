# True Micro-Compaction Implementation Plan

**Status:** PLANNING
**Created:** 2026-04-01
**Issue:** Implemented wrong algorithm - did full summarization instead of lightweight tool output clearing

---

## Problem Analysis

### What We Built (WRONG)

- Full conversation summarization with binary search
- Removes old messages and replaces with summary
- Targets keeping 30k tokens (hardcoded)
- This is **traditional compaction**, not micro-compaction

### What Claude Code Actually Does (CORRECT)

- **Clears verbose tool outputs** in-place
- Keeps ALL messages in conversation
- No summarization or message removal
- Uses API cache edits when supported
- Falls back to direct content mutation

### Why This Matters

- Micro-compaction is **lightweight** (ms not seconds)
- Can run **frequently** without disrupting conversation
- Preserves **full conversation structure**
- Only removes **redundant tool output content**

---

## Claude Code Micro-Compaction Spec

### From `spec/06_services_context_state.md`:

**Two Paths:**

1. **Cached Microcompact** (preferred when available)
   - Uses API `cache_edits` feature
   - Registers tool results to delete via cache system
   - Queues `CacheEditsBlock` for next API call
   - Does NOT mutate message content directly

2. **Time-Based Microcompact** (fallback)
   - Triggers after idle gap (e.g., 30 min since last assistant message)
   - Directly mutates tool result `content` to `[Old tool result content cleared]`
   - Resets cached MC state

**Compactable Tools:**

```typescript
const COMPACTABLE_TOOLS = new Set([
  "file_read",
  "shell",
  "grep",
  "glob",
  "web_search",
  "web_fetch",
  "file_edit",
  "file_write",
]);
```

**When NOT to Compact:**

- Recent tool results (last N messages)
- Non-compactable tools
- Already cleared results
- Tool calls that errored

---

## Implementation Plan

### Phase 1: Understanding & Validation (30 min)

**Task 1.1: Extract Full Spec** (5 min)

- Read all micro-compaction references in claurst spec
- Document exact algorithm
- List all edge cases
- **Verification:** Complete spec document with examples

**Task 1.2: Identify OpenClaw Message Format** (10 min)

- Examine OpenClaw's AgentMessage type
- Check how tool_use/tool_result are structured
- Verify content field structure
- **Verification:** Type definitions documented

**Task 1.3: Design Algorithm** (15 min)

- Pseudo-code for tool output clearing
- Decision tree for when to clear
- Handling of different message types
- **Verification:** Algorithm passes desk check with examples

### Phase 2: Core Implementation (60 min)

**Task 2.1: Create `micro-compact.ts`** (15 min)

- Implement `clearToolOutputs(messages, config)` function
- Returns mutated message array
- Tracks which results were cleared
- **Verification:** Unit test with 5 scenarios passes

**Task 2.2: Compactable Tool Detection** (10 min)

- Map Claude Code tool names to OpenClaw equivalents
- Create `isCompactableTool(toolName)` function
- Handle tool name variations
- **Verification:** Test with all OpenClaw tool names

**Task 2.3: Content Clearing Logic** (20 min)

- Implement in-place content mutation
- Preserve message structure
- Add cleared marker text
- Track token savings
- **Verification:** Messages retain structure, only content changes

**Task 2.4: Recent Message Protection** (15 min)

- Skip last N tool results (configurable)
- Ensure recent context stays intact
- **Verification:** Recent results never cleared

### Phase 3: Integration (45 min)

**Task 3.1: Update Plugin Configuration** (10 min)

- Remove: `targetAfterCompact`, `minTokensToKeep`, `maxTokensToKeep`
- Add: `preserveRecentResults` (default: 5)
- Add: `compactableTools` (list)
- **Verification:** Config schema updated, old config migrated

**Task 3.2: Switch to In-Flight Clearing** (20 min)

- **CRITICAL CHANGE:** Use `message:preprocessed` hook NOT `message:sent`
- Clear tool outputs BEFORE sending to LLM
- No session write-back needed
- Track stats for notification
- **Verification:** Hook fires at correct time, messages mutated

**Task 3.3: Remove Broken Session Write** (10 min)

- Delete `saveSession()` function (broken and not needed)
- Remove all file I/O code
- Messages cleared in-flight only
- **Verification:** No file operations, plugin safer

**Task 3.4: Update Notification** (5 min)

- Change message: "Cleared N tool outputs, saved X tokens this turn"
- Add note: "Tool outputs cleared before LLM, preserved in history"
- **Verification:** Notification accurate

### Phase 4: Testing & Validation (30 min)

**Task 4.1: Unit Tests** (15 min)

- Test clearing logic with various tool types
- Test recent message protection
- Test already-cleared detection
- **Verification:** All tests pass

**Task 4.2: Integration Test** (10 min)

- Create session with many tool calls
- Trigger micro-compaction
- Verify outputs cleared, structure intact
- **Verification:** Session remains functional

**Task 4.3: Token Calculation Verification** (5 min)

- Measure token savings on real session
- Verify reclaimed tokens accurate
- **Verification:** Numbers match expectations

### Phase 5: Cleanup (15 min)

**Task 5.1: Remove Dead Code** (10 min)

- Delete `cut-point.ts` (not needed)
- Delete `tool-pair-adjuster.ts` (not needed)
- Update imports
- **Verification:** Build succeeds, no dead code

**Task 5.2: Update Documentation** (5 min)

- Update README.md with correct algorithm
- Fix IMPLEMENTATION_STATUS.md
- Update PR description
- **Verification:** Docs accurate

---

## File Changes Required

### Files to Modify

- `index.ts` - Update hook handler
- `src/executor.ts` - Replace with micro-compaction
- `src/integration.ts` - Remove worthwhile check
- `src/types.ts` - Update config types
- `openclaw.plugin.json` - Update config schema

### Files to Create

- `src/micro-compact.ts` - New core algorithm

### Files to Delete

- `src/cut-point.ts` - Not needed for micro-compaction
- `src/cut-point.test.ts` - Not needed
- `src/tool-pair-adjuster.ts` - Not needed
- `src/tool-pair-adjuster.test.ts` - Not needed
- `src/middleware.ts` - Not needed (hook-based)

### Files to Keep

- `src/token-budget.ts` - Still useful for tracking
- `src/integration.ts` - Keep for trigger logic

---

## Acceptance Criteria

**Must Have:**

- [ ] Clears verbose tool outputs in-place
- [ ] Preserves all messages (no deletion)
- [ ] Preserves last N tool results (configurable)
- [ ] Only clears compactable tool types
- [ ] Triggers at 90% token usage
- [ ] Notifies user with accurate stats
- [ ] Session remains functional after compaction
- [ ] All unit tests pass
- [ ] Plugin loads without errors

**Should Have:**

- [ ] Performance < 50ms for typical session
- [ ] Token savings of 10-50% typical
- [ ] Handles edge cases gracefully

**Nice to Have:**

- [ ] Cache edits support (future, requires API support)
- [ ] Time-based triggering (idle gap)
- [ ] Configurable compactable tools

---

## Risk Assessment

**High Risk:**

- Direct message mutation (could corrupt session)
  - **Mitigation:** Extensive testing, create backup before mutation

**Medium Risk:**

- Tool name mapping (OpenClaw vs Claude Code names differ)
  - **Mitigation:** Comprehensive tool list, test all tools

**Low Risk:**

- Token calculation inaccuracy
  - **Mitigation:** Use OpenClaw's existing token estimation

---

## Timeline Estimate

- **Phase 1:** 30 min (planning)
- **Phase 2:** 60 min (implementation)
- **Phase 3:** 45 min (integration)
- **Phase 4:** 30 min (testing)
- **Phase 5:** 15 min (cleanup)

**Total:** ~3 hours (vs 3 hours wasted on wrong implementation 😞)

---

## Next Steps

1. Review this plan for completeness
2. Get approval before starting Phase 2
3. Implement Phase 2 with continuous testing
4. No rushing - verify each task before moving on

---

**Lesson Learned:** Read the spec THOROUGHLY before implementing. "Micro" compaction means "small/lightweight", not "mini version of full compaction".
