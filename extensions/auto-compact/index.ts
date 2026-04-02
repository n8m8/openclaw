/**
 * Micro-Compaction Plugin for OpenClaw
 *
 * Automatically clears verbose tool outputs when approaching token limits.
 * Based on Claude Code's micro-compaction algorithm.
 *
 * Key differences from traditional compaction:
 * - Clears tool outputs in-place (no message deletion)
 * - No summarization (just string replacement)
 * - Lightweight (milliseconds not seconds)
 * - Can run frequently without disrupting conversation
 *
 * See: https://github.com/n8m8/openclaw/issues/5
 * Spec: /Users/n8m8/.openclaw/media/inbound/claurst-main/spec/06_services_context_state.md
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  clearToolOutputs,
  shouldMicroCompact,
  type MicroCompactConfig,
} from "./src/micro-compact.js";
import { calculateTokenBudget } from "./src/token-budget.js";

const log = {
  info: (...args: any[]) => console.log("[auto-compact]", ...args),
  warn: (...args: any[]) => console.warn("[auto-compact]", ...args),
  error: (...args: any[]) => console.error("[auto-compact]", ...args),
  debug: (...args: any[]) => console.debug("[auto-compact]", ...args),
};

export default function register(api: OpenClawPluginApi) {
  log.info("Micro-Compaction plugin registered");

  // Hook into message:preprocessed to clear tool outputs BEFORE sending to LLM
  // This is the key difference from wrong implementation - we don't write sessions,
  // we just mutate messages in-flight
  api.registerHook(
    "message:preprocessed",
    async (event) => {
      try {
        await handleMessagePreprocessed(event, api);
      } catch (err) {
        log.error("Micro-compaction failed in message:preprocessed hook", err);
      }
    },
    {
      name: "micro-compaction",
      description: "Clear verbose tool outputs when approaching token limit",
    },
  );

  log.info("Micro-Compaction hook registered (message:preprocessed)");
}

async function handleMessagePreprocessed(event: any, api: OpenClawPluginApi) {
  // Get plugin config
  const pluginConfig = api.config.plugins?.entries?.["auto-compact"]?.config;
  if (!pluginConfig?.enabled) {
    return; // Plugin disabled
  }

  // Get messages from event
  const messages = event.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  // Build config
  const microConfig: MicroCompactConfig = {
    preserveRecentResults: pluginConfig.preserveRecentResults ?? 5,
    compactableTools: pluginConfig.compactableTools
      ? new Set(pluginConfig.compactableTools)
      : undefined,
  };

  // Calculate current token usage
  const contextWindow = 200000; // TODO: Get from agent config
  const budget = calculateTokenBudget(messages, contextWindow);

  // Check if we should trigger
  const triggerPercentage = pluginConfig.triggerPercentage ?? 90;
  if (!shouldMicroCompact(messages, budget.used, contextWindow, triggerPercentage)) {
    return; // Not at threshold yet
  }

  log.info(
    `Micro-compaction triggering at ${budget.percentUsed.toFixed(1)}% ` +
      `(${budget.used.toLocaleString()}/${budget.limit.toLocaleString()} tokens)`,
  );

  // Clear tool outputs in-place
  const result = clearToolOutputs(messages, microConfig);

  if (result.modified) {
    log.info(
      `Micro-compaction complete: cleared ${result.clearedCount} tool outputs, ` +
        `saved ${result.tokensSaved.toLocaleString()} tokens ` +
        `(tools: ${result.clearedTools.join(", ")})`,
    );

    // Notify user if configured
    if (pluginConfig.notifyUser) {
      const notification = formatNotification(result, budget);
      await sendNotification(event.sessionKey, notification, api);
    }
  } else {
    log.debug("Micro-compaction triggered but no outputs needed clearing");
  }
}

function formatNotification(
  result: { clearedCount: number; tokensSaved: number; clearedTools: string[] },
  budget: { used: number; limit: number; percentUsed: number },
): string {
  return (
    `🧹 **Micro-Compaction**\n\n` +
    `Cleared ${result.clearedCount} verbose tool output${result.clearedCount === 1 ? "" : "s"} ` +
    `(${result.clearedTools.join(", ")})\n` +
    `Saved ${result.tokensSaved.toLocaleString()} tokens this turn\n\n` +
    `Current usage: ${budget.used.toLocaleString()}/${budget.limit.toLocaleString()} ` +
    `(${budget.percentUsed.toFixed(1)}%)\n\n` +
    `_Tool outputs cleared before LLM sees them, preserved in session history_`
  );
}

async function sendNotification(
  sessionKey: string | undefined,
  message: string,
  api: OpenClawPluginApi,
): Promise<void> {
  if (!sessionKey) {
    return;
  }

  try {
    // Use subagent.run to send a message to the session
    await api.runtime.subagent.run({
      sessionKey,
      message,
      deliver: true,
      extraSystemPrompt:
        "This is a system notification about token management. Deliver it as-is without adding commentary.",
    });

    log.info(`Sent notification to ${sessionKey}`);
  } catch (err) {
    log.error(`Failed to send notification to ${sessionKey}`, err);
  }
}
