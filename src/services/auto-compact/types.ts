/**
 * Auto-Compaction Type Definitions
 * 
 * Implements micro-compaction for session management.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

/**
 * Auto-compaction configuration
 */
export interface AutoCompactionConfig {
  /** Enable automatic compaction (default: true) */
  enabled: boolean;
  
  /** Trigger compaction at this percentage of token budget (default: 90) */
  triggerPercentage: number;
  
  /** Minimum tokens to keep after compaction (default: 20000) */
  minTokensToKeep: number;
  
  /** Maximum tokens to keep after compaction (default: 50000) */
  maxTokensToKeep: number;
  
  /** Target token count after compaction (default: 30000) */
  targetAfterCompact: number;
  
  /** Preserve this many recent turns verbatim (default: 10) */
  preserveRecentTurns: number;
  
  /** Notify user when compaction occurs (default: true) */
  notifyUser: boolean;
  
  /** Model override for summarization (optional) */
  summaryModel?: string;
}

/**
 * Token budget status for a session
 */
export interface TokenBudget {
  /** Maximum tokens allowed for this session */
  limit: number;
  
  /** Tokens consumed so far */
  used: number;
  
  /** Tokens remaining */
  remaining: number;
  
  /** Percentage of budget used (0-100) */
  percentUsed: number;
  
  /** Estimated number of turns left before limit */
  estimatedTurnsLeft: number;
  
  /** Average tokens per turn (calculated from history) */
  averageTokensPerTurn: number;
}

/**
 * Cut point calculation result
 */
export interface CutPointResult {
  /** Index in messages array where to cut (messages before this index will be compacted) */
  cutIndex: number;
  
  /** Estimated tokens in messages before cut point */
  tokensBeforeCut: number;
  
  /** Estimated tokens in messages after cut point (kept) */
  tokensAfterCut: number;
  
  /** Whether cut point was adjusted to preserve tool pairs */
  adjustedForToolPairs: boolean;
  
  /** Number of messages that will be compacted */
  messagesToCompact: number;
  
  /** Number of messages that will be kept */
  messagesToKeep: number;
}

/**
 * Compaction execution result
 */
export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean;
  
  /** Summary of compacted messages */
  summary: string;
  
  /** Number of messages before compaction */
  messagesBefore: number;
  
  /** Number of messages after compaction */
  messagesAfter: number;
  
  /** Tokens before compaction */
  tokensBefore: number;
  
  /** Tokens after compaction */
  tokensAfter: number;
  
  /** Tokens reclaimed */
  tokensReclaimed: number;
  
  /** Cut point details */
  cutPoint: CutPointResult;
  
  /** Timestamp when compaction occurred */
  timestamp: number;
}

/**
 * Compaction history entry
 */
export interface CompactionHistoryEntry {
  timestamp: number;
  messagesBefore: number;
  messagesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensReclaimed: number;
  triggerReason: 'auto' | 'manual' | 'emergency';
}

/**
 * Session metadata for auto-compaction
 */
export interface SessionCompactionMetadata {
  /** Last auto-compaction timestamp */
  lastAutoCompactAt?: number;
  
  /** Number of auto-compactions performed */
  autoCompactCount: number;
  
  /** Compaction history (last 10 entries) */
  history: CompactionHistoryEntry[];
  
  /** Whether session has been warned about approaching limit */
  warned75: boolean;
  warned90: boolean;
  warned95: boolean;
}

/**
 * Tool call pairing info for orphan detection
 */
export interface ToolCallPair {
  /** Message index containing tool_use */
  toolUseIndex: number;
  
  /** Message index containing tool_result (or -1 if orphaned) */
  toolResultIndex: number;
  
  /** Tool call ID */
  toolCallId: string;
  
  /** Whether this pair is complete */
  isComplete: boolean;
}
