/**
 * Cut Point Calculator Tests
 */

import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { calculateCutPoint, validateCutPoint, calculateReclaimPercentage } from "./cut-point.js";
import type { AutoCompactionConfig } from "./types.js";

const DEFAULT_CONFIG: AutoCompactionConfig = {
  enabled: true,
  triggerPercentage: 90,
  minTokensToKeep: 2000,
  maxTokensToKeep: 5000,
  targetAfterCompact: 3000,
  preserveRecentTurns: 3,
  notifyUser: true
};

function createMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }]
  };
}

function createMessages(count: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      createMessage("user", `User message ${i + 1}`),
      createMessage("assistant", `Assistant message ${i + 1}`)
    );
  }
  return messages;
}

describe("calculateCutPoint", () => {
  it("should return zero cut index for empty messages", () => {
    const result = calculateCutPoint([], DEFAULT_CONFIG);
    
    expect(result.cutIndex).toBe(0);
    expect(result.messagesToCompact).toBe(0);
    expect(result.messagesToKeep).toBe(0);
  });

  it("should preserve minimum recent turns", () => {
    const messages = createMessages(10); // 20 messages total
    const result = calculateCutPoint(messages, DEFAULT_CONFIG);
    
    // Should preserve at least preserveRecentTurns (3) messages
    expect(result.messagesToKeep).toBeGreaterThanOrEqual(DEFAULT_CONFIG.preserveRecentTurns);
  });

  it("should not compact if too few messages", () => {
    const messages = createMessages(2); // 4 messages total
    const config = { ...DEFAULT_CONFIG, preserveRecentTurns: 5 };
    
    const result = calculateCutPoint(messages, config);
    
    // Can't compact because we need to preserve 5 messages but only have 4
    expect(result.cutIndex).toBe(0);
    expect(result.messagesToCompact).toBe(0);
  });

  it("should find cut point within token bounds", () => {
    const messages = createMessages(50); // 100 messages
    const result = calculateCutPoint(messages, DEFAULT_CONFIG);
    
    // Tokens after cut should be within bounds
    expect(result.tokensAfterCut).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minTokensToKeep);
    expect(result.tokensAfterCut).toBeLessThanOrEqual(DEFAULT_CONFIG.maxTokensToKeep);
  });

  it("should compact older messages and keep recent ones", () => {
    const messages = createMessages(20); // 40 messages
    const result = calculateCutPoint(messages, DEFAULT_CONFIG);
    
    // Should compact some messages
    expect(result.messagesToCompact).toBeGreaterThan(0);
    expect(result.messagesToKeep).toBeGreaterThan(0);
    expect(result.cutIndex).toBeGreaterThan(0);
    expect(result.cutIndex).toBeLessThan(messages.length);
  });
});

describe("validateCutPoint", () => {
  it("should validate a good cut point", () => {
    const messages = createMessages(20);
    const cutPoint = calculateCutPoint(messages, DEFAULT_CONFIG);
    const validation = validateCutPoint(cutPoint, DEFAULT_CONFIG);
    
    expect(validation.valid).toBe(true);
    expect(validation.reason).toBeUndefined();
  });

  it("should reject cut point with too few messages kept", () => {
    const cutPoint = {
      cutIndex: 100,
      tokensBeforeCut: 10000,
      tokensAfterCut: 3000,
      adjustedForToolPairs: false,
      messagesToCompact: 100,
      messagesToKeep: 2 // Less than preserveRecentTurns (3)
    };
    
    const validation = validateCutPoint(cutPoint, DEFAULT_CONFIG);
    
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("preserveRecentTurns");
  });

  it("should reject cut point with too many tokens kept", () => {
    const cutPoint = {
      cutIndex: 5,
      tokensBeforeCut: 1000,
      tokensAfterCut: 6000, // Exceeds maxTokensToKeep (5000)
      adjustedForToolPairs: false,
      messagesToCompact: 5,
      messagesToKeep: 10
    };
    
    const validation = validateCutPoint(cutPoint, DEFAULT_CONFIG);
    
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("exceeds max");
  });
});

describe("calculateReclaimPercentage", () => {
  it("should calculate correct reclaim percentage", () => {
    const cutPoint = {
      cutIndex: 50,
      tokensBeforeCut: 10000,
      tokensAfterCut: 3000,
      adjustedForToolPairs: false,
      messagesToCompact: 50,
      messagesToKeep: 20
    };
    
    const percentage = calculateReclaimPercentage(cutPoint);
    
    // Total: 13000, After compaction: ~4000 (3000 + 10% of 10000)
    // Reclaimed: ~9000 / 13000 = ~69%
    expect(percentage).toBeGreaterThan(60);
    expect(percentage).toBeLessThan(75);
  });

  it("should return 0 for empty session", () => {
    const cutPoint = {
      cutIndex: 0,
      tokensBeforeCut: 0,
      tokensAfterCut: 0,
      adjustedForToolPairs: false,
      messagesToCompact: 0,
      messagesToKeep: 0
    };
    
    const percentage = calculateReclaimPercentage(cutPoint);
    expect(percentage).toBe(0);
  });
});
