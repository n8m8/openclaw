/**
 * Auto-Compaction Plugin for OpenClaw
 *
 * Automatically compacts sessions when approaching token limits using
 * binary search and tool-pair-aware algorithms.
 *
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import { createSubsystemLogger } from "openclaw/logging";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  executeCompaction,
  applyCompaction,
  formatCompactionNotification,
} from "./src/executor.js";
import { shouldAutoCompact } from "./src/integration.js";
import { calculateTokenBudget } from "./src/token-budget.js";
import type { AutoCompactionConfig } from "./src/types.js";

const log = createSubsystemLogger("plugin:auto-compact");

// Track ongoing compactions to prevent concurrent execution
const compacting = new Set<string>();

export function register(api: OpenClawPluginApi) {
  log.info("Auto-Compaction plugin registered");

  // Hook into message:sent to trigger proactive compaction
  api.hooks.on("message:sent", async (event) => {
    try {
      await handleMessageSent(event, api);
    } catch (err) {
      log.error("Auto-compaction failed in message:sent hook", err);
    }
  });

  // Also check after receiving messages (catch-all for edge cases)
  api.hooks.on("message:received", async (event) => {
    try {
      await handleMessageReceived(event, api);
    } catch (err) {
      log.error("Auto-compaction failed in message:received hook", err);
    }
  });

  log.info("Auto-Compaction hooks registered (message:sent, message:received)");
}

async function handleMessageSent(event: any, api: OpenClawPluginApi) {
  const sessionKey = event.sessionKey;
  if (!sessionKey) {
    return; // No session to compact
  }

  await checkAndCompact(sessionKey, api);
}

async function handleMessageReceived(event: any, api: OpenClawPluginApi) {
  const sessionKey = event.sessionKey;
  if (!sessionKey) {
    return; // No session to compact
  }

  await checkAndCompact(sessionKey, api);
}

async function checkAndCompact(sessionKey: string, api: OpenClawPluginApi) {
  // Prevent concurrent compaction for the same session
  if (compacting.has(sessionKey)) {
    log.debug(`Auto-compaction already in progress for ${sessionKey}`);
    return;
  }

  // Get plugin config
  const pluginConfig = api.config.plugins?.entries?.["auto-compact"]?.config;
  if (!pluginConfig?.enabled) {
    return; // Plugin disabled
  }

  const autoConfig: AutoCompactionConfig = {
    enabled: pluginConfig.enabled ?? true,
    triggerPercentage: pluginConfig.triggerPercentage ?? 90,
    minTokensToKeep: pluginConfig.minTokensToKeep ?? 20000,
    maxTokensToKeep: pluginConfig.maxTokensToKeep ?? 50000,
    targetAfterCompact: pluginConfig.targetAfterCompact ?? 30000,
    preserveRecentTurns: pluginConfig.preserveRecentTurns ?? 10,
    notifyUser: pluginConfig.notifyUser ?? true,
    summaryModel: pluginConfig.summaryModel,
  };

  try {
    compacting.add(sessionKey);

    // Load session (this is the tricky part - need to access OpenClaw's session store)
    // For now, we'll use the session manager API if available
    const session = await loadSession(sessionKey, api);
    if (!session) {
      log.warn(`Could not load session ${sessionKey} for auto-compaction`);
      return;
    }

    // Get context window for this agent
    const contextWindow = getContextWindow(session, api);

    // Check if compaction should trigger
    if (!shouldAutoCompact(session.messages, autoConfig, contextWindow)) {
      return; // Not needed yet
    }

    log.info(
      `Auto-compaction triggered for ${sessionKey} at ${calculateTokenBudget(
        session.messages,
        contextWindow,
      ).percentUsed.toFixed(1)}% token usage`,
    );

    // Execute compaction
    const result = await executeCompaction(session.messages, autoConfig, {
      model: autoConfig.summaryModel,
      customInstructions: undefined,
    });

    if (result.compacted) {
      // Apply compaction to session
      session.messages = applyCompaction(session.messages, result);

      // Save session back
      await saveSession(sessionKey, session, api);

      log.info(
        `Auto-compaction complete for ${sessionKey}: ` +
          `reclaimed ${result.tokensReclaimed.toLocaleString()} tokens, ` +
          `${result.messagesBefore} → ${result.messagesAfter} messages`,
      );

      // Notify user if configured
      if (autoConfig.notifyUser) {
        const notification = formatCompactionNotification(result);
        await sendNotification(sessionKey, notification, api);
      }
    }
  } finally {
    compacting.delete(sessionKey);
  }
}

// Session management functions
async function loadSession(sessionKey: string, api: OpenClawPluginApi): Promise<any | null> {
  try {
    // Use plugin runtime API to get session messages
    const result = await api.runtime.subagent.getSessionMessages({
      sessionKey,
    });

    if (!result.messages || result.messages.length === 0) {
      return null;
    }

    return {
      messages: result.messages,
      sessionKey,
    };
  } catch (err) {
    log.error(`Failed to load session ${sessionKey}`, err);
    return null;
  }
}

async function saveSession(
  sessionKey: string,
  session: any,
  api: OpenClawPluginApi,
): Promise<void> {
  // LIMITATION: Plugin API doesn't expose session write-back
  //
  // Workarounds explored:
  // 1. Direct file write - Possible but bypasses OpenClaw's session manager
  // 2. Trigger agent command - Could work but hacky
  // 3. Use deleteSession + recreate - Would lose metadata
  //
  // Best solution: Add api.runtime.subagent.updateSessionMessages() to plugin SDK
  //
  // For now, we'll use direct file write as a temporary solution

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Resolve session file path using channel API
    const sessionDir = api.runtime.channel.session.resolveStorePath(api.config);
    const sessionFile = path.join(sessionDir, `${sessionKey}.jsonl`);

    // Write modified messages back to session file
    // Each line is a JSON object representing a turn
    const lines = session.messages.map((msg: any) => JSON.stringify(msg));
    await fs.writeFile(sessionFile, lines.join("\n") + "\n");

    log.info(`Saved session ${sessionKey} with ${session.messages.length} messages`);
  } catch (err) {
    log.error(`Failed to save session ${sessionKey}`, err);
    throw err;
  }
}

function getContextWindow(session: any, api: OpenClawPluginApi): number {
  // TODO: Get context window from agent config
  // For now, use OpenClaw's default of 200k
  // Could potentially read from api.config.agents.defaults.contextWindow
  return 200000;
}

async function sendNotification(
  sessionKey: string,
  message: string,
  api: OpenClawPluginApi,
): Promise<void> {
  try {
    // Use subagent.run to send a message to the session
    await api.runtime.subagent.run({
      sessionKey,
      message,
      deliver: true, // Deliver to the session's channel
      extraSystemPrompt:
        "This is a system notification. Deliver it as-is without adding commentary.",
    });

    log.info(`Sent notification to ${sessionKey}`);
  } catch (err) {
    log.error(`Failed to send notification to ${sessionKey}`, err);
  }
}
