/**
 * Tool Pair Adjuster
 *
 * Ensures tool_use and tool_result pairs are never orphaned during compaction.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ToolCallPair } from "./types.js";

/**
 * Result of tool pair adjustment
 */
export interface ToolPairAdjustmentResult {
  /** Adjusted cut index */
  cutIndex: number;

  /** Whether adjustment was necessary */
  adjusted: boolean;

  /** Original cut index */
  originalCutIndex: number;

  /** Orphaned tool pairs that were detected */
  orphanedPairs: ToolCallPair[];
}

/**
 * Adjust cut point to avoid orphaning tool_use without tool_result
 *
 * Scans backwards from cut point to find any tool_use that doesn't have
 * a matching tool_result before the cut. Moves cut point earlier to include
 * both tool_use and tool_result, or excludes both.
 */
export function adjustCutPointForToolPairs(
  messages: AgentMessage[],
  cutIndex: number,
): ToolPairAdjustmentResult {
  const originalCutIndex = cutIndex;
  const orphanedPairs: ToolCallPair[] = [];

  // Find all tool pairs in the messages
  const toolPairs = findToolPairs(messages);

  // Check for orphaned pairs at the cut point
  for (const pair of toolPairs) {
    // Case 1: tool_use before cut, tool_result after cut (or missing)
    if (pair.toolUseIndex < cutIndex) {
      if (pair.toolResultIndex >= cutIndex || pair.toolResultIndex === -1) {
        // This pair will be orphaned - tool_use in summary, result in context
        orphanedPairs.push(pair);
      }
    }

    // Case 2: tool_use after cut, tool_result before cut (shouldn't happen but check anyway)
    if (
      pair.toolUseIndex >= cutIndex &&
      pair.toolResultIndex < cutIndex &&
      pair.toolResultIndex !== -1
    ) {
      orphanedPairs.push(pair);
    }
  }

  if (orphanedPairs.length === 0) {
    return {
      cutIndex,
      adjusted: false,
      originalCutIndex,
      orphanedPairs: [],
    };
  }

  // Adjust cut point to avoid orphaning
  // Strategy: Move cut point to BEFORE the earliest orphaned tool_use
  let adjustedCutIndex = cutIndex;

  for (const pair of orphanedPairs) {
    if (pair.toolUseIndex < adjustedCutIndex) {
      adjustedCutIndex = pair.toolUseIndex;
    }
  }

  // Ensure we don't move cut point to 0 (would compact nothing)
  if (adjustedCutIndex === 0 && cutIndex > 0) {
    // Alternative strategy: Move cut point to AFTER the latest orphaned tool_result
    for (const pair of orphanedPairs) {
      if (pair.toolResultIndex !== -1 && pair.toolResultIndex + 1 > adjustedCutIndex) {
        adjustedCutIndex = pair.toolResultIndex + 1;
      }
    }
  }

  return {
    cutIndex: adjustedCutIndex,
    adjusted: true,
    originalCutIndex,
    orphanedPairs,
  };
}

/**
 * Find all tool_use/tool_result pairs in messages
 */
export function findToolPairs(messages: AgentMessage[]): ToolCallPair[] {
  const pairs: ToolCallPair[] = [];
  const toolUseMap = new Map<string, number>(); // toolCallId -> message index

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Find tool_use blocks
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block === "object" && block.type === "tool_use" && "id" in block) {
          toolUseMap.set(block.id as string, i);
        }
      }
    }

    // Find tool_result blocks
    if (message.role === "user" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block === "object" && block.type === "tool_result" && "tool_use_id" in block) {
          const toolCallId = block.tool_use_id as string;
          const toolUseIndex = toolUseMap.get(toolCallId);

          if (toolUseIndex !== undefined) {
            pairs.push({
              toolUseIndex,
              toolResultIndex: i,
              toolCallId,
              isComplete: true,
            });
            toolUseMap.delete(toolCallId); // Matched, remove from pending
          }
        }
      }
    }
  }

  // Add any orphaned tool_use (no matching result found)
  for (const [toolCallId, toolUseIndex] of toolUseMap.entries()) {
    pairs.push({
      toolUseIndex,
      toolResultIndex: -1,
      toolCallId,
      isComplete: false,
    });
  }

  return pairs;
}

/**
 * Check if a cut point would orphan any tool pairs
 */
export function wouldOrphanToolPairs(messages: AgentMessage[], cutIndex: number): boolean {
  const pairs = findToolPairs(messages);

  for (const pair of pairs) {
    // tool_use before cut, tool_result after (or missing)
    if (
      pair.toolUseIndex < cutIndex &&
      (pair.toolResultIndex >= cutIndex || pair.toolResultIndex === -1)
    ) {
      return true;
    }

    // tool_use after cut, tool_result before
    if (
      pair.toolUseIndex >= cutIndex &&
      pair.toolResultIndex < cutIndex &&
      pair.toolResultIndex !== -1
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Get statistics about tool pairs
 */
export function getToolPairStats(messages: AgentMessage[]): {
  totalPairs: number;
  completePairs: number;
  orphanedPairs: number;
} {
  const pairs = findToolPairs(messages);

  return {
    totalPairs: pairs.length,
    completePairs: pairs.filter((p) => p.isComplete).length,
    orphanedPairs: pairs.filter((p) => !p.isComplete).length,
  };
}
