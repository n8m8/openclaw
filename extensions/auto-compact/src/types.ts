/**
 * Type definitions for micro-compaction
 */

export interface TokenBudget {
  limit: number;
  used: number;
  remaining: number;
  percentUsed: number;
  estimatedTurnsLeft: number;
  averageTokensPerTurn: number;
}
