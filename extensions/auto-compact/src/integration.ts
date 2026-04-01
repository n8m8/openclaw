/**
 * Auto-Compaction Integration
 *
 * Wrappers and helpers to integrate auto-compaction into OpenClaw's
 * existing agent lifecycle.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { calculateCutPoint } from "./cut-point.js";
import { isCompactionWorthwhile } from "./executor.js";
import { calculateTokenBudget, shouldTriggerCompaction } from "./token-budget.js";
import type { AutoCompactionConfig } from "./types.js";

const log = createSubsystemLogger("auto-compact-integration");

/**
 * Check if auto-compaction should trigger for a session
 *
 * This is called BEFORE the existing safeguard compaction logic.
 * Returns true if the session should be auto-compacted.
 */
export function shouldAutoCompact(
  messages: AgentMessage[],
  config?: AutoCompactionConfig,
  contextWindow?: number,
): boolean {
  if (!config?.enabled) {
    return false;
  }

  const tokenLimit = contextWindow || 200000;
  const budget = calculateTokenBudget(messages, tokenLimit);

  // Check if we've hit the trigger threshold
  if (!shouldTriggerCompaction(budget, config.triggerPercentage)) {
    return false;
  }

  // Check if compaction would be worthwhile
  if (!isCompactionWorthwhile(messages, config)) {
    log.info(
      `Auto-compaction skipped at ${budget.percentUsed.toFixed(1)}%: ` +
        `wouldn't reclaim meaningful tokens`,
    );
    return false;
  }

  log.info(
    `Auto-compaction should trigger at ${budget.percentUsed.toFixed(1)}% ` +
      `(${budget.used.toLocaleString()}/${budget.limit.toLocaleString()} tokens)`,
  );

  return true;
}

/**
 * Get recommended preserveRecentTokens for traditional compaction
 *
 * When auto-compaction triggers, we use the cut point calculator to determine
 * how many tokens to preserve. This provides a smarter value than the default.
 */
export function getRecommendedPreserveTokens(
  messages: AgentMessage[],
  config: AutoCompactionConfig,
): number {
  const cutPoint = calculateCutPoint(messages, config);

  // Return the tokens that would be preserved after cut
  return cutPoint.tokensAfterCut;
}

/**
 * Estimate session token usage
 *
 * Helper that matches OpenClaw's token estimation approach.
 */
export function estimateSessionTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

/**
 * Check if session is approaching token limit
 *
 * Returns warning level if approaching limit, null otherwise.
 */
export function getSessionWarningLevel(
  messages: AgentMessage[],
  contextWindow: number = 200000,
): { level: "low" | "medium" | "high" | "critical"; percentage: number } | null {
  const budget = calculateTokenBudget(messages, contextWindow);

  if (budget.percentUsed >= 98) {
    return { level: "critical", percentage: budget.percentUsed };
  }
  if (budget.percentUsed >= 95) {
    return { level: "high", percentage: budget.percentUsed };
  }
  if (budget.percentUsed >= 90) {
    return { level: "medium", percentage: budget.percentUsed };
  }
  if (budget.percentUsed >= 75) {
    return { level: "low", percentage: budget.percentUsed };
  }

  return null;
}

/**
 * Get auto-compaction config from agent defaults
 *
 * Extracts and validates auto-compaction settings from OpenClaw config.
 */
export function resolveAutoCompactionConfig(
  agentConfig?: unknown,
): AutoCompactionConfig | undefined {
  const auto = agentConfig?.compaction?.auto;

  if (!auto) {
    return undefined;
  }

  return {
    enabled: auto.enabled ?? true,
    triggerPercentage: auto.triggerPercentage ?? 90,
    minTokensToKeep: auto.minTokensToKeep ?? 20000,
    maxTokensToKeep: auto.maxTokensToKeep ?? 50000,
    targetAfterCompact: auto.targetAfterCompact ?? 30000,
    preserveRecentTurns: auto.preserveRecentTurns ?? 10,
    notifyUser: auto.notifyUser ?? true,
    summaryModel: auto.summaryModel,
  };
}

/**
 * Format auto-compaction trigger message for logs
 */
export function formatAutoCompactTrigger(
  messages: AgentMessage[],
  contextWindow: number,
  config: AutoCompactionConfig,
): string {
  const budget = calculateTokenBudget(messages, contextWindow);
  const cutPoint = calculateCutPoint(messages, config);

  return (
    `Auto-compaction triggered: ` +
    `${budget.used.toLocaleString()}/${budget.limit.toLocaleString()} tokens (${budget.percentUsed.toFixed(1)}%), ` +
    `will compact ${cutPoint.messagesToCompact} messages, ` +
    `preserve ${cutPoint.messagesToKeep} recent messages`
  );
}
