/**
 * Micro-Compaction Executor
 * 
 * Orchestrates the full auto-compaction flow.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { generateSummary } from "@mariozechner/pi-coding-agent";
import type { AutoCompactionConfig, CompactionResult, CompactionHistoryEntry } from "./types.js";
import { calculateCutPoint, validateCutPoint } from "./cut-point.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("auto-compact");

const COMPACTION_SUMMARY_INSTRUCTIONS = `
Summarize the conversation history that is being compacted.

MUST PRESERVE:
- Active tasks and their current status (in-progress, blocked, pending)
- The last thing the user requested and what was being done about it
- Decisions made and their rationale
- TODOs, open questions, and constraints
- Any commitments or follow-ups promised
- Important context needed to continue the conversation

PRIORITIZE:
- Recent context over older history
- What the agent was doing, not just what was discussed
- Actionable information over background

OMIT:
- Routine tool calls (file reads, status checks)
- Small talk and greetings
- Redundant information
- Intermediate steps of completed tasks

Output in 3-5 concise paragraphs.
`.trim();

/**
 * Execute micro-compaction on a session
 * 
 * This is the main entry point that:
 * 1. Calculates optimal cut point
 * 2. Validates the cut point
 * 3. Generates summary of compacted messages
 * 4. Returns new message array with summary + recent messages
 */
export async function executeCompaction(
  messages: AgentMessage[],
  config: AutoCompactionConfig,
  context?: {
    model?: string;
    customInstructions?: string;
  }
): Promise<CompactionResult> {
  const startTime = Date.now();

  // Calculate cut point
  const cutPoint = calculateCutPoint(messages, config);

  // Validate cut point
  const validation = validateCutPoint(cutPoint, config);
  if (!validation.valid) {
    log.warn(`Cut point validation failed: ${validation.reason}`);
    
    return {
      compacted: false,
      summary: "",
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      tokensBefore: cutPoint.tokensBeforeCut + cutPoint.tokensAfterCut,
      tokensAfter: cutPoint.tokensBeforeCut + cutPoint.tokensAfterCut,
      tokensReclaimed: 0,
      cutPoint,
      timestamp: Date.now()
    };
  }

  // Nothing to compact
  if (cutPoint.messagesToCompact === 0) {
    log.info("No messages to compact (cut point at beginning)");
    
    return {
      compacted: false,
      summary: "",
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      tokensBefore: cutPoint.tokensAfterCut,
      tokensAfter: cutPoint.tokensAfterCut,
      tokensReclaimed: 0,
      cutPoint,
      timestamp: Date.now()
    };
  }

  // Split messages
  const messagesToCompact = messages.slice(0, cutPoint.cutIndex);
  const messagesToKeep = messages.slice(cutPoint.cutIndex);

  log.info(
    `Compacting ${messagesToCompact.length} messages, keeping ${messagesToKeep.length} recent messages`
  );

  // Generate summary of compacted messages
  const summaryInstructions = context?.customInstructions
    ? `${COMPACTION_SUMMARY_INSTRUCTIONS}\n\nAdditional focus:\n${context.customInstructions}`
    : COMPACTION_SUMMARY_INSTRUCTIONS;

  let summary: string;
  try {
    summary = await generateSummary(
      messagesToCompact,
      {
        instructions: summaryInstructions,
        model: context?.model || config.summaryModel
      }
    );

    if (!summary || summary.trim().length === 0) {
      summary = "Previous conversation compacted (summary unavailable).";
      log.warn("generateSummary returned empty result, using fallback");
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to generate compaction summary: ${errorMsg}`);
    summary = "Previous conversation compacted (summary generation failed).";
  }

  // Create summary message
  const summaryMessage: AgentMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[Previous conversation summary - ${messagesToCompact.length} messages compacted]\n\n${summary}\n\n[Recent conversation continues below...]`
      }
    ]
  };

  // Estimate tokens in new message array
  const tokensAfter = cutPoint.tokensAfterCut + estimateMessageTokens(summaryMessage);
  const tokensReclaimed = cutPoint.tokensBeforeCut + cutPoint.tokensAfterCut - tokensAfter;

  const elapsed = Date.now() - startTime;
  log.info(
    `Compaction complete in ${elapsed}ms: ` +
    `${cutPoint.messagesToCompact} messages → summary, ` +
    `reclaimed ${tokensReclaimed.toLocaleString()} tokens`
  );

  return {
    compacted: true,
    summary,
    messagesBefore: messages.length,
    messagesAfter: messagesToKeep.length + 1, // +1 for summary message
    tokensBefore: cutPoint.tokensBeforeCut + cutPoint.tokensAfterCut,
    tokensAfter,
    tokensReclaimed,
    cutPoint,
    timestamp: Date.now()
  };
}

/**
 * Apply compaction result to message array
 * 
 * Returns new message array with summary + recent messages
 */
export function applyCompaction(
  messages: AgentMessage[],
  result: CompactionResult
): AgentMessage[] {
  if (!result.compacted) {
    return messages;
  }

  const messagesToKeep = messages.slice(result.cutPoint.cutIndex);
  
  const summaryMessage: AgentMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[Previous conversation summary - ${result.cutPoint.messagesToCompact} messages compacted]\n\n${result.summary}\n\n[Recent conversation continues below...]`
      }
    ]
  };

  return [summaryMessage, ...messagesToKeep];
}

/**
 * Create compaction history entry
 */
export function createHistoryEntry(
  result: CompactionResult,
  triggerReason: 'auto' | 'manual' | 'emergency'
): CompactionHistoryEntry {
  return {
    timestamp: result.timestamp,
    messagesBefore: result.messagesBefore,
    messagesAfter: result.messagesAfter,
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
    tokensReclaimed: result.tokensReclaimed,
    triggerReason
  };
}

/**
 * Format compaction result for user notification
 */
export function formatCompactionNotification(result: CompactionResult): string {
  if (!result.compacted) {
    return "";
  }

  const percent = ((result.tokensReclaimed / result.tokensBefore) * 100).toFixed(1);

  return `🗜️ **Auto-compaction triggered**\n\n` +
         `Compressed ${result.cutPoint.messagesToCompact} old messages into summary\n` +
         `Reclaimed ${result.tokensReclaimed.toLocaleString()} tokens (${percent}%)\n` +
         `Session continues with ${result.messagesAfter} messages preserved`;
}

/**
 * Estimate tokens for a single message
 */
function estimateMessageTokens(message: AgentMessage): number {
  // Simple char/4 heuristic (matches pi-coding-agent)
  const content = JSON.stringify(message.content);
  return Math.ceil(content.length / 4);
}

/**
 * Check if compaction would be effective
 * 
 * Returns false if compaction wouldn't reclaim meaningful tokens
 */
export function isCompactionWorthwhile(
  messages: AgentMessage[],
  config: AutoCompactionConfig
): boolean {
  if (messages.length < config.preserveRecentTurns * 2) {
    return false; // Too few messages to benefit
  }

  const cutPoint = calculateCutPoint(messages, config);
  const totalTokens = cutPoint.tokensBeforeCut + cutPoint.tokensAfterCut;
  
  // Assume summary will be ~10% of compacted content
  const estimatedSummaryTokens = Math.ceil(cutPoint.tokensBeforeCut * 0.1);
  const tokensAfterCompaction = cutPoint.tokensAfterCut + estimatedSummaryTokens;
  const tokensReclaimed = totalTokens - tokensAfterCompaction;
  
  // Only worthwhile if we reclaim at least 20% of total tokens
  return (tokensReclaimed / totalTokens) >= 0.20;
}
