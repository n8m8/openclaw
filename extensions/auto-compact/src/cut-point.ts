/**
 * Cut Point Calculator
 *
 * Binary search algorithm to find optimal compression point.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { adjustCutPointForToolPairs } from "./tool-pair-adjuster.js";
import type { AutoCompactionConfig, CutPointResult } from "./types.js";

/**
 * Calculate optimal cut point using binary search
 *
 * Finds the message index where:
 * - Messages after cut point stay within targetAfterCompact tokens
 * - Messages before cut point will be summarized
 * - Tool use/result pairs are not orphaned
 */
export function calculateCutPoint(
  messages: AgentMessage[],
  config: AutoCompactionConfig,
): CutPointResult {
  if (messages.length === 0) {
    return {
      cutIndex: 0,
      tokensBeforeCut: 0,
      tokensAfterCut: 0,
      adjustedForToolPairs: false,
      messagesToCompact: 0,
      messagesToKeep: 0,
    };
  }

  // Always preserve at least preserveRecentTurns messages
  const minMessagesToKeep = Math.min(config.preserveRecentTurns, messages.length);

  // Binary search for optimal cut point
  let low = 0;
  let high = messages.length - minMessagesToKeep;
  let bestCutIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const tokensAfter = estimateMessagesTokens(messages.slice(mid));

    if (tokensAfter > config.maxTokensToKeep) {
      // Too many tokens after cut - need to cut later (keep fewer messages)
      low = mid + 1;
    } else if (tokensAfter < config.minTokensToKeep) {
      // Too few tokens after cut - cut earlier (keep more messages)
      high = mid - 1;
    } else {
      // Within acceptable range
      bestCutIndex = mid;

      // Try to get closer to target
      if (tokensAfter > config.targetAfterCompact) {
        low = mid + 1;
      } else if (tokensAfter < config.targetAfterCompact) {
        high = mid - 1;
      } else {
        // Perfect match
        break;
      }
    }
  }

  // Ensure we keep at least minMessagesToKeep messages
  bestCutIndex = Math.min(bestCutIndex, messages.length - minMessagesToKeep);

  // Adjust for tool pairs
  const adjustedResult = adjustCutPointForToolPairs(messages, bestCutIndex);

  const tokensBeforeCut = estimateMessagesTokens(messages.slice(0, adjustedResult.cutIndex));
  const tokensAfterCut = estimateMessagesTokens(messages.slice(adjustedResult.cutIndex));

  return {
    cutIndex: adjustedResult.cutIndex,
    tokensBeforeCut,
    tokensAfterCut,
    adjustedForToolPairs: adjustedResult.adjusted,
    messagesToCompact: adjustedResult.cutIndex,
    messagesToKeep: messages.length - adjustedResult.cutIndex,
  };
}

/**
 * Estimate total tokens for an array of messages
 */
function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

/**
 * Validate cut point doesn't violate constraints
 */
export function validateCutPoint(
  result: CutPointResult,
  config: AutoCompactionConfig,
): { valid: boolean; reason?: string } {
  if (result.messagesToKeep < config.preserveRecentTurns) {
    return {
      valid: false,
      reason:
        `Cut point would keep only ${result.messagesToKeep} messages, ` +
        `but preserveRecentTurns requires ${config.preserveRecentTurns}`,
    };
  }

  if (result.tokensAfterCut > config.maxTokensToKeep) {
    return {
      valid: false,
      reason:
        `Tokens after cut (${result.tokensAfterCut}) exceeds max ` + `(${config.maxTokensToKeep})`,
    };
  }

  if (result.tokensAfterCut < config.minTokensToKeep && result.messagesToCompact > 0) {
    return {
      valid: false,
      reason:
        `Tokens after cut (${result.tokensAfterCut}) below min ` + `(${config.minTokensToKeep})`,
    };
  }

  return { valid: true };
}

/**
 * Calculate percentage of tokens that would be reclaimed
 */
export function calculateReclaimPercentage(result: CutPointResult): number {
  const totalTokens = result.tokensBeforeCut + result.tokensAfterCut;
  if (totalTokens === 0) return 0;

  // Assume summary will be ~10% of original compacted content
  const estimatedSummaryTokens = Math.ceil(result.tokensBeforeCut * 0.1);
  const tokensAfterCompaction = result.tokensAfterCut + estimatedSummaryTokens;

  const tokensReclaimed = totalTokens - tokensAfterCompaction;
  return (tokensReclaimed / totalTokens) * 100;
}
