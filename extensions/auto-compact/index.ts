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

// Session management functions (need to wire these up to OpenClaw's internals)
async function loadSession(sessionKey: string, api: any): Promise<any | null> {
  // TODO: Access OpenClaw's session manager
  // This needs to be exposed via the plugin API
  // For now, return null to avoid errors

  log.warn("Session loading not yet implemented in plugin API");
  return null;
}

async function saveSession(sessionKey: string, session: any, api: any): Promise<void> {
  // TODO: Access OpenClaw's session manager
  // This needs to be exposed via the plugin API

  log.warn("Session saving not yet implemented in plugin API");
}

function getContextWindow(session: any, api: any): number {
  // TODO: Get context window from agent config
  // Default to 200k for now
  return 200000;
}

async function sendNotification(sessionKey: string, message: string, api: any): Promise<void> {
  // TODO: Send message to session
  // This needs to be exposed via the plugin API

  log.info(`Would send notification to ${sessionKey}: ${message}`);
}
