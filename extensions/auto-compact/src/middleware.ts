/**
 * Auto-Compaction Middleware
 *
 * Post-turn hook that checks token usage and triggers compaction.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  executeCompaction,
  applyCompaction,
  createHistoryEntry,
  formatCompactionNotification,
  isCompactionWorthwhile,
} from "./executor.js";
import {
  calculateTokenBudget,
  shouldTriggerCompaction,
  getWarningLevel,
  generateWarningMessage,
} from "./token-budget.js";
import type { AutoCompactionConfig, SessionCompactionMetadata, TokenBudget } from "./types.js";

const log = createSubsystemLogger("auto-compact-middleware");

const DEFAULT_CONFIG: AutoCompactionConfig = {
  enabled: true,
  triggerPercentage: 90,
  minTokensToKeep: 20000,
  maxTokensToKeep: 50000,
  targetAfterCompact: 30000,
  preserveRecentTurns: 10,
  notifyUser: true,
};

/**
 * Session state that includes compaction metadata
 */
export interface SessionWithCompaction {
  messages: AgentMessage[];
  tokenLimit?: number;
  autoCompaction?: AutoCompactionConfig;
  compactionMetadata?: SessionCompactionMetadata;
}

/**
 * Result of compaction check
 */
export interface CompactionCheckResult {
  /** Updated messages (may be compacted) */
  messages: AgentMessage[];

  /** Whether compaction was triggered */
  compacted: boolean;

  /** Notification message for user (if any) */
  notification?: string;

  /** Updated metadata */
  metadata: SessionCompactionMetadata;

  /** Current token budget */
  budget: TokenBudget;
}

/**
 * Check if auto-compaction should trigger and execute if needed
 *
 * This is the main middleware function called after each agent turn.
 */
export async function checkAutoCompaction(
  session: SessionWithCompaction,
  options?: {
    force?: boolean;
    customInstructions?: string;
    model?: string;
  },
): Promise<CompactionCheckResult> {
  const config = { ...DEFAULT_CONFIG, ...session.autoCompaction };
  const tokenLimit = session.tokenLimit || 200000;

  // Initialize metadata if not present
  const metadata: SessionCompactionMetadata = session.compactionMetadata || {
    autoCompactCount: 0,
    history: [],
    warned75: false,
    warned90: false,
    warned95: false,
  };

  // Calculate current token budget
  const budget = calculateTokenBudget(session.messages, tokenLimit);

  log.debug(
    `Token usage: ${budget.used}/${budget.limit} (${budget.percentUsed.toFixed(1)}%), ` +
      `${budget.estimatedTurnsLeft} turns left`,
  );

  // Check if we should send warnings (without compacting)
  const warningLevel = getWarningLevel(budget);
  let notification: string | undefined;

  if (warningLevel === "low" && !metadata.warned75) {
    notification = generateWarningMessage(budget) || undefined;
    metadata.warned75 = true;
  } else if (warningLevel === "medium" && !metadata.warned90) {
    notification = generateWarningMessage(budget) || undefined;
    metadata.warned90 = true;
  } else if (warningLevel === "high" && !metadata.warned95) {
    notification = generateWarningMessage(budget) || undefined;
    metadata.warned95 = true;
  }

  // Check if compaction should trigger
  const shouldCompact =
    options?.force || (config.enabled && shouldTriggerCompaction(budget, config.triggerPercentage));

  if (!shouldCompact) {
    return {
      messages: session.messages,
      compacted: false,
      notification,
      metadata,
      budget,
    };
  }

  // Check if compaction would be worthwhile
  if (!options?.force && !isCompactionWorthwhile(session.messages, config)) {
    log.info("Compaction skipped: wouldn't reclaim meaningful tokens");

    return {
      messages: session.messages,
      compacted: false,
      notification:
        notification ||
        "⚠️ Token limit approaching but compaction wouldn't help. Consider /continue to start fresh.",
      metadata,
      budget,
    };
  }

  log.info(`Auto-compaction triggered at ${budget.percentUsed.toFixed(1)}% token usage`);

  try {
    // Execute compaction
    const result = await executeCompaction(session.messages, config, {
      model: options?.model,
      customInstructions: options?.customInstructions,
    });

    if (!result.compacted) {
      log.warn("Compaction executed but didn't compact (validation failed?)");

      return {
        messages: session.messages,
        compacted: false,
        notification:
          "⚠️ Auto-compaction attempted but couldn't compress session. Consider /continue.",
        metadata,
        budget,
      };
    }

    // Apply compaction
    const newMessages = applyCompaction(session.messages, result);

    // Update metadata
    const historyEntry = createHistoryEntry(result, options?.force ? "manual" : "auto");
    metadata.autoCompactCount++;
    metadata.lastAutoCompactAt = result.timestamp;
    metadata.history.unshift(historyEntry);

    // Keep only last 10 history entries
    if (metadata.history.length > 10) {
      metadata.history = metadata.history.slice(0, 10);
    }

    // Reset warning flags after successful compaction
    metadata.warned75 = false;
    metadata.warned90 = false;
    metadata.warned95 = false;

    // Generate notification
    const compactionNotification = config.notifyUser
      ? formatCompactionNotification(result)
      : undefined;

    log.info(
      `Auto-compaction successful: ` +
        `${result.messagesBefore} → ${result.messagesAfter} messages, ` +
        `reclaimed ${result.tokensReclaimed.toLocaleString()} tokens`,
    );

    return {
      messages: newMessages,
      compacted: true,
      notification: compactionNotification,
      metadata,
      budget: calculateTokenBudget(newMessages, tokenLimit),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Auto-compaction failed: ${errorMsg}`);

    return {
      messages: session.messages,
      compacted: false,
      notification: "❌ Auto-compaction failed. Session may hit token limit. Consider /continue.",
      metadata,
      budget,
    };
  }
}

/**
 * Get compaction statistics for a session
 */
export function getCompactionStats(metadata: SessionCompactionMetadata): {
  totalCompactions: number;
  totalTokensReclaimed: number;
  averageTokensReclaimed: number;
  lastCompactedAt?: Date;
} {
  const totalTokensReclaimed = metadata.history.reduce(
    (sum, entry) => sum + entry.tokensReclaimed,
    0,
  );

  return {
    totalCompactions: metadata.autoCompactCount,
    totalTokensReclaimed,
    averageTokensReclaimed:
      metadata.autoCompactCount > 0
        ? Math.round(totalTokensReclaimed / metadata.autoCompactCount)
        : 0,
    lastCompactedAt: metadata.lastAutoCompactAt ? new Date(metadata.lastAutoCompactAt) : undefined,
  };
}

/**
 * Format compaction stats for display
 */
export function formatCompactionStats(metadata: SessionCompactionMetadata): string {
  const stats = getCompactionStats(metadata);

  if (stats.totalCompactions === 0) {
    return "No auto-compactions performed yet.";
  }

  const lastCompacted = stats.lastCompactedAt ? stats.lastCompactedAt.toLocaleString() : "never";

  return (
    `📊 **Compaction Statistics**\n\n` +
    `Total compactions: ${stats.totalCompactions}\n` +
    `Total tokens reclaimed: ${stats.totalTokensReclaimed.toLocaleString()}\n` +
    `Average per compaction: ${stats.averageTokensReclaimed.toLocaleString()}\n` +
    `Last compacted: ${lastCompacted}`
  );
}
