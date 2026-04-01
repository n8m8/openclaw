/**
 * Micro-Compaction - Lightweight Tool Output Clearing
 *
 * Based on Claude Code's micro-compaction algorithm:
 * - Clears verbose tool outputs in-place
 * - Preserves message structure
 * - No summarization or message deletion
 * - Fast (milliseconds, not seconds)
 *
 * See: /Users/n8m8/.openclaw/media/inbound/claurst-main/spec/06_services_context_state.md
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";

/**
 * Compactable tool types (mapped from Claude Code)
 *
 * Claude Code compacts: file_read, shell, grep, glob, web_search, web_fetch, file_edit, file_write
 * OpenClaw equivalents:
 */
const COMPACTABLE_TOOLS = new Set([
  "Read", // file_read
  "exec", // shell
  "grep_tool", // grep
  "glob_tool", // glob
  "web_search", // web_search
  "web_fetch", // web_fetch
  "Edit", // file_edit
  "Write", // file_write
]);

const CLEARED_MARKER = "[Tool output cleared to save tokens]";

export interface MicroCompactResult {
  /** Number of tool outputs cleared */
  clearedCount: number;

  /** Tokens saved by clearing */
  tokensSaved: number;

  /** Tool names that were cleared */
  clearedTools: string[];

  /** Whether any changes were made */
  modified: boolean;
}

export interface MicroCompactConfig {
  /** Preserve last N tool results (don't clear recent outputs) */
  preserveRecentResults?: number;

  /** Custom set of compactable tool names */
  compactableTools?: Set<string>;

  /** Marker text to use for cleared outputs */
  clearedMarker?: string;
}

/**
 * Clear verbose tool outputs from messages in-place
 *
 * Modifies the message array by replacing tool result content with a marker.
 * Preserves message structure - does NOT delete messages.
 *
 * @param messages - Message array to compact (MUTATED IN PLACE)
 * @param config - Configuration options
 * @returns Statistics about what was cleared
 */
export function clearToolOutputs(
  messages: AgentMessage[],
  config: MicroCompactConfig = {},
): MicroCompactResult {
  const {
    preserveRecentResults = 5,
    compactableTools = COMPACTABLE_TOOLS,
    clearedMarker = CLEARED_MARKER,
  } = config;

  let clearedCount = 0;
  let tokensSaved = 0;
  const clearedTools = new Set<string>();

  // Find all tool_result messages
  const toolResults: Array<{ index: number; toolName: string; content: any }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Look for tool_result in content array
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          // Find the corresponding tool_use to get the tool name
          const toolName = findToolName(messages, block.tool_use_id, i);

          if (toolName) {
            toolResults.push({
              index: i,
              toolName,
              content: block,
            });
          }
        }
      }
    }
  }

  // Preserve recent results (skip last N)
  // Handle case where there are fewer results than preserveRecentResults
  const numToPreserve = Math.min(preserveRecentResults, toolResults.length);
  const resultsToProcess = toolResults.slice(0, toolResults.length - numToPreserve);

  // Clear compactable tool outputs
  for (const result of resultsToProcess) {
    const { toolName, content } = result;

    // Skip if not compactable
    if (!compactableTools.has(toolName)) {
      continue;
    }

    // Skip if already cleared
    if (typeof content.content === "string" && content.content.includes(clearedMarker)) {
      continue;
    }

    // Calculate tokens before clearing
    const tokensBefore = estimateContentTokens(content.content);

    // Clear the content
    content.content = clearedMarker;

    // Calculate tokens after (now it's the marker)
    const tokensAfter = estimateContentTokens(clearedMarker);
    const saved = tokensBefore - tokensAfter;

    // Always count as cleared (even if marker is longer than content)
    // The benefit is preventing future growth, not just immediate savings
    clearedCount++;
    tokensSaved += Math.max(0, saved); // Don't count negative savings
    clearedTools.add(toolName);
  }

  return {
    clearedCount,
    tokensSaved,
    clearedTools: Array.from(clearedTools),
    modified: clearedCount > 0,
  };
}

/**
 * Find the tool name for a given tool_use_id
 *
 * Searches backwards from the tool_result to find the corresponding tool_use
 */
function findToolName(
  messages: AgentMessage[],
  toolUseId: string,
  startIndex: number,
): string | null {
  // Search backwards from the result
  for (let i = startIndex - 1; i >= 0; i--) {
    const msg = messages[i];

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id === toolUseId) {
          return block.name || null;
        }
      }
    }
  }

  return null;
}

/**
 * Estimate tokens in content (handles strings, objects, arrays)
 */
function estimateContentTokens(content: any): number {
  if (typeof content === "string") {
    return Math.ceil(content.length / 4); // Rough estimate: 4 chars per token
  }

  if (Array.isArray(content)) {
    return content.reduce((sum, item) => sum + estimateContentTokens(item), 0);
  }

  if (typeof content === "object" && content !== null) {
    return estimateContentTokens(JSON.stringify(content));
  }

  return 0;
}

/**
 * Check if a message array should trigger micro-compaction
 *
 * @param messages - Messages to check
 * @param currentTokens - Current token count
 * @param tokenLimit - Token limit (context window)
 * @param triggerPercentage - Percentage at which to trigger (default 90)
 * @returns True if micro-compaction should run
 */
export function shouldMicroCompact(
  messages: AgentMessage[],
  currentTokens: number,
  tokenLimit: number,
  triggerPercentage: number = 90,
): boolean {
  const percentUsed = (currentTokens / tokenLimit) * 100;
  return percentUsed >= triggerPercentage;
}
