/**
 * Tool Pair Adjuster Tests
 */

import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { 
  adjustCutPointForToolPairs, 
  findToolPairs, 
  wouldOrphanToolPairs,
  getToolPairStats 
} from "./tool-pair-adjuster.js";

function createToolUseMessage(toolCallId: string): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "I'll use a tool" },
      { 
        type: "tool_use" as const,
        id: toolCallId,
        name: "test_tool",
        input: { test: "data" }
      }
    ]
  };
}

function createToolResultMessage(toolCallId: string, result: string): AgentMessage {
  return {
    role: "user",
    content: [
      {
        type: "tool_result" as const,
        tool_use_id: toolCallId,
        content: result
      }
    ]
  };
}

function createTextMessage(role: "user" | "assistant", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }]
  };
}

describe("findToolPairs", () => {
  it("should find complete tool pairs", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "test"),
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1")
    ];

    const pairs = findToolPairs(messages);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].toolCallId).toBe("tool1");
    expect(pairs[0].toolUseIndex).toBe(1);
    expect(pairs[0].toolResultIndex).toBe(2);
    expect(pairs[0].isComplete).toBe(true);
  });

  it("should find orphaned tool_use (no result)", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "test"),
      createToolUseMessage("tool1")
      // No tool_result
    ];

    const pairs = findToolPairs(messages);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].toolCallId).toBe("tool1");
    expect(pairs[0].toolUseIndex).toBe(1);
    expect(pairs[0].toolResultIndex).toBe(-1);
    expect(pairs[0].isComplete).toBe(false);
  });

  it("should handle multiple tool pairs", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1"),
      createToolUseMessage("tool2"),
      createToolResultMessage("tool2", "result2")
    ];

    const pairs = findToolPairs(messages);

    expect(pairs).toHaveLength(2);
    expect(pairs.every(p => p.isComplete)).toBe(true);
  });

  it("should return empty array for messages with no tools", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "hello"),
      createTextMessage("assistant", "hi")
    ];

    const pairs = findToolPairs(messages);
    expect(pairs).toHaveLength(0);
  });
});

describe("adjustCutPointForToolPairs", () => {
  it("should not adjust when cut point doesn't orphan pairs", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1"),
      createTextMessage("user", "test"),
      createTextMessage("assistant", "response")
    ];

    // Cut after complete pair
    const result = adjustCutPointForToolPairs(messages, 2);

    expect(result.adjusted).toBe(false);
    expect(result.cutIndex).toBe(2);
    expect(result.orphanedPairs).toHaveLength(0);
  });

  it("should adjust when tool_use before cut, tool_result after", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "test1"),
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1"),
      createTextMessage("user", "test2")
    ];

    // Cut between tool_use and tool_result
    const result = adjustCutPointForToolPairs(messages, 2);

    expect(result.adjusted).toBe(true);
    expect(result.cutIndex).toBeLessThan(2); // Moved earlier
    expect(result.orphanedPairs).toHaveLength(1);
  });

  it("should move cut point to before tool_use", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "msg1"),
      createTextMessage("assistant", "msg2"),
      createToolUseMessage("tool1"), // index 2
      createToolResultMessage("tool1", "result1"), // index 3
      createTextMessage("user", "msg3")
    ];

    // Cut at index 3 would orphan tool_use at index 2
    const result = adjustCutPointForToolPairs(messages, 3);

    expect(result.adjusted).toBe(true);
    expect(result.cutIndex).toBe(2); // Moved to before tool_use
  });

  it("should handle multiple orphaned pairs", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolUseMessage("tool2"),
      createToolResultMessage("tool1", "result1"),
      createToolResultMessage("tool2", "result2"),
      createTextMessage("user", "test")
    ];

    // Cut at index 2 would orphan both tool pairs
    const result = adjustCutPointForToolPairs(messages, 2);

    expect(result.adjusted).toBe(true);
    expect(result.cutIndex).toBeLessThan(2);
    expect(result.orphanedPairs.length).toBeGreaterThan(0);
  });
});

describe("wouldOrphanToolPairs", () => {
  it("should return false for safe cut points", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1"),
      createTextMessage("user", "test")
    ];

    expect(wouldOrphanToolPairs(messages, 0)).toBe(false);
    expect(wouldOrphanToolPairs(messages, 2)).toBe(false);
  });

  it("should return true when tool pair would be split", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1")
    ];

    // Cut at index 1 splits the pair
    expect(wouldOrphanToolPairs(messages, 1)).toBe(true);
  });
});

describe("getToolPairStats", () => {
  it("should return correct stats", () => {
    const messages: AgentMessage[] = [
      createToolUseMessage("tool1"),
      createToolResultMessage("tool1", "result1"),
      createToolUseMessage("tool2")
      // tool2 has no result (orphaned)
    ];

    const stats = getToolPairStats(messages);

    expect(stats.totalPairs).toBe(2);
    expect(stats.completePairs).toBe(1);
    expect(stats.orphanedPairs).toBe(1);
  });

  it("should return zeros for no tools", () => {
    const messages: AgentMessage[] = [
      createTextMessage("user", "hello"),
      createTextMessage("assistant", "hi")
    ];

    const stats = getToolPairStats(messages);

    expect(stats.totalPairs).toBe(0);
    expect(stats.completePairs).toBe(0);
    expect(stats.orphanedPairs).toBe(0);
  });
});
