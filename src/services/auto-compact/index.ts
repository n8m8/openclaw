/**
 * Auto-Compaction Service
 *
 * Automatic micro-compaction to prevent token limit overruns.
 * See: https://github.com/n8m8/openclaw/issues/5
 */

export * from "./types.js";
export * from "./token-budget.js";
export * from "./cut-point.js";
export * from "./tool-pair-adjuster.js";
export * from "./executor.js";
export * from "./middleware.js";
export * from "./integration.js";

// Re-export key functions for convenience
export { checkAutoCompaction } from "./middleware.js";
export { executeCompaction, applyCompaction } from "./executor.js";
export { calculateTokenBudget, shouldTriggerCompaction } from "./token-budget.js";
export { calculateCutPoint } from "./cut-point.js";
export { adjustCutPointForToolPairs, findToolPairs } from "./tool-pair-adjuster.js";
export { shouldAutoCompact, resolveAutoCompactionConfig } from "./integration.js";
