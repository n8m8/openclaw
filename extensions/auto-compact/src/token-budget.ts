/**
 * Token Budget Tracking
 *
 * Real-time token usage monitoring and threshold detection.
 * See: https://github.com/n8m8/openclaw/issues/4
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { TokenBudget } from "./types.js";

const DEFAULT_TOKEN_LIMIT = 200000;
const DEFAULT_AVG_TOKENS_PER_TURN = 2000;

/**
 * Calculate token budget status for a session
 */
export function calculateTokenBudget(
  messages: AgentMessage[],
  tokenLimit: number = DEFAULT_TOKEN_LIMIT,
): TokenBudget {
  if (messages.length === 0) {
    return {
      limit: tokenLimit,
      used: 0,
      remaining: tokenLimit,
      percentUsed: 0,
      estimatedTurnsLeft: Math.floor(tokenLimit / DEFAULT_AVG_TOKENS_PER_TURN),
      averageTokensPerTurn: DEFAULT_AVG_TOKENS_PER_TURN,
    };
  }

  // Calculate total tokens used
  const used = messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
  const remaining = Math.max(0, tokenLimit - used);
  const percentUsed = (used / tokenLimit) * 100;

  // Calculate average tokens per turn (user + assistant pair = 1 turn)
  const turnCount = Math.ceil(messages.filter((m) => m.role === "user").length);
  const averageTokensPerTurn =
    turnCount > 0 ? Math.ceil(used / turnCount) : DEFAULT_AVG_TOKENS_PER_TURN;

  const estimatedTurnsLeft =
    averageTokensPerTurn > 0 ? Math.floor(remaining / averageTokensPerTurn) : 0;

  return {
    limit: tokenLimit,
    used,
    remaining,
    percentUsed,
    estimatedTurnsLeft,
    averageTokensPerTurn,
  };
}

/**
 * Check if compaction should be triggered based on token usage
 */
export function shouldTriggerCompaction(
  budget: TokenBudget,
  triggerPercentage: number = 90,
): boolean {
  return budget.percentUsed >= triggerPercentage;
}

/**
 * Get warning level based on token usage
 *
 * @returns 'none' | 'low' | 'medium' | 'high' | 'critical'
 */
export function getWarningLevel(
  budget: TokenBudget,
): "none" | "low" | "medium" | "high" | "critical" {
  if (budget.percentUsed >= 98) return "critical";
  if (budget.percentUsed >= 95) return "high";
  if (budget.percentUsed >= 90) return "medium";
  if (budget.percentUsed >= 75) return "low";
  return "none";
}

/**
 * Format token budget for user display
 */
export function formatTokenBudget(budget: TokenBudget): string {
  const percent = budget.percentUsed.toFixed(1);
  const used = budget.used.toLocaleString();
  const limit = budget.limit.toLocaleString();
  const turnsLeft = budget.estimatedTurnsLeft;

  return `📊 Tokens: ${used} / ${limit} (${percent}%)\n` + `Estimated turns left: ~${turnsLeft}`;
}

/**
 * Generate warning message based on budget status
 */
export function generateWarningMessage(budget: TokenBudget): string | null {
  const level = getWarningLevel(budget);

  if (level === "none") {
    return null;
  }

  const percent = budget.percentUsed.toFixed(1);
  const used = budget.used.toLocaleString();
  const limit = budget.limit.toLocaleString();
  const turnsLeft = budget.estimatedTurnsLeft;

  if (level === "critical") {
    return (
      `🚨 **Token Budget Critical**\n\n` +
      `You've used ${used} / ${limit} tokens (${percent}%)\n` +
      `~${turnsLeft} turns left before limit\n\n` +
      `**Auto-compaction will trigger shortly**`
    );
  }

  if (level === "high") {
    return (
      `⚠️ **Token Budget High**\n\n` +
      `You've used ${used} / ${limit} tokens (${percent}%)\n` +
      `~${turnsLeft} turns left before limit\n\n` +
      `Consider:\n` +
      `• /compact - Compress old messages now\n` +
      `• /continue - Start fresh session with summary`
    );
  }

  if (level === "medium") {
    return (
      `⚠️ **Token Budget Warning**\n\n` +
      `You've used ${used} / ${limit} tokens (${percent}%)\n` +
      `~${turnsLeft} turns remaining\n\n` +
      `Auto-compaction will trigger at 90%`
    );
  }

  if (level === "low") {
    return `ℹ️ Token usage: ${percent}% (${used} / ${limit})\n` + `~${turnsLeft} turns remaining`;
  }

  return null;
}
