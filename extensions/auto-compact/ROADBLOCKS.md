# Roadblocks from Initial Implementation

**Date:** 2026-04-01
**Problem:** Session write-back "workaround" is broken

---

## Issue 1: No Session Write API

**Problem:**
Plugin SDK provides `api.runtime.subagent.getSessionMessages()` to READ sessions, but NO equivalent to WRITE sessions back.

**What We Tried:**

```typescript
const sessionDir = api.runtime.channel.session.resolveStorePath(api.config);
const sessionFile = path.join(sessionDir, `${sessionKey}.jsonl`);
await fs.writeFile(sessionFile, lines.join("\n") + "\n");
```

**Why This is Broken:**

1. **Wrong API signature:** `resolveStorePath()` expects `(store, { agentId })` not `(config)`
2. **Channel-specific:** `api.runtime.channel.session` is only for channel plugins, not general hooks
3. **File format assumption:** Assumes sessions are `.jsonl` files (might not be true)
4. **Session manager bypass:** Direct file write bypasses OpenClaw's session manager (metadata, locks, etc.)
5. **Race conditions:** No locking, could corrupt session if agent writes simultaneously

**Actual Error (if it runs):**
Likely fails silently or throws when trying to resolve path with wrong args.

---

## Issue 2: Import Problems

**Problem:**
Initial implementation used `import { createSubsystemLogger } from "openclaw/logging"` which doesn't exist in plugin context.

**Solution:**
Use console-based logging instead:

```typescript
const log = {
  info: (...args) => console.log("[auto-compact]", ...args),
  // ...
};
```

**Why:** Plugins can't import from `openclaw/*` paths except `openclaw/plugin-sdk/*`.

---

## Issue 3: Export Format

**Problem:**
Initially used `export function register()` instead of `export default function register()`.

**Solution:**
Must export default function for OpenClaw plugin loader to find it.

---

## Issue 4: Hook API Mismatch

**Problem:**
Used `api.hooks.on()` instead of `api.registerHook()`.

**Solution:**
Plugin API is `api.registerHook(event, handler)` not an event emitter pattern.

---

## Real Solution for Session Writing

### Option 1: Don't Write Sessions (BEST for Micro-Compaction)

**Insight:** True micro-compaction from Claude Code **doesn't write sessions back at all**!

It uses **cache edits** - tells the API "these tool results should be cleared from cache" on the NEXT API call.

**For OpenClaw without cache edits:**
We could hook into the **pre-API-call** phase and mutate messages there, before they're sent to the LLM. No session write needed!

**Advantages:**

- No session write-back needed
- No file corruption risk
- Respects session manager
- Faster (no I/O)

**How:**

```typescript
// Hook into message:preprocessed or similar
api.registerHook("message:preprocessed", (event) => {
  // Mutate event.messages in-place
  clearToolOutputs(event.messages);
  // Return mutated messages
  return { messages: event.messages };
});
```

### Option 2: Request SDK Enhancement (FUTURE)

Ask OpenClaw maintainers to add:

```typescript
api.runtime.subagent.updateSessionMessages({
  sessionKey: string,
  messages: AgentMessage[]
})
```

Until then, we **can't safely write sessions from plugins**.

---

## Updated Implementation Strategy

### ❌ What We Can't Do

- Persist cleared tool outputs to session files
- Safely modify sessions from plugins

### ✅ What We CAN Do

- Clear tool outputs **in-flight** (before LLM sees them)
- Hook into message preprocessing
- Reduce tokens sent to API without session mutation

### 🎯 Micro-Compaction Strategy

1. Hook into **pre-API-call** phase (not `message:sent`)
2. Clear tool outputs in message array **before** sending to LLM
3. Don't write back to session
4. Tool outputs stay in session history but aren't sent to LLM

**Result:** Same token savings, no session write-back needed!

---

## Updated Plan

### Phase 2.1: Find Correct Hook Point (15 min)

**Research:**

- What hooks fire before LLM API call?
- Can we mutate messages in those hooks?
- What's the message format at that point?

**Verification:**

- Hook exists and fires at right time
- We can mutate messages safely
- Messages are in expected format

### Phase 2.2: Implement In-Flight Clearing (30 min)

**Implementation:**

```typescript
api.registerHook("agent:query:before", (event) => {
  const clearedCount = clearToolOutputs(event.messages, config);
  if (clearedCount > 0) {
    log.info(`Cleared ${clearedCount} tool outputs before API call`);
  }
});
```

**Advantages:**

- No session write-back
- No file corruption risk
- Works immediately
- Simple and safe

**Trade-off:**

- Tool outputs remain in session file (disk usage)
- Need to clear on EVERY API call (check performance)

### Phase 2.3: Session-Level Clearing (OPTIONAL, FUTURE)

If we want to persist cleared outputs to session:

- Wait for SDK enhancement
- Or contribute PR to OpenClaw with proper session write API

---

## Lessons

1. **Verify workarounds actually work** - Don't claim success without testing
2. **Read the plugin SDK docs** - Don't assume APIs exist
3. **True micro-compaction doesn't write sessions** - It uses cache edits or in-flight mutation
4. **Test file writes in isolation** - Don't ship broken code

---

## Next Steps

1. Research correct hook point for pre-API-call mutation
2. Implement in-flight clearing (no session write)
3. Test with real session
4. Ship working version
5. (Optional) Request SDK enhancement for session persistence
