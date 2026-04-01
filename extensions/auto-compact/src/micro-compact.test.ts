/**
 * Micro-Compaction Tests
 *
 * Tests for tool output clearing algorithm
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { clearToolOutputs, shouldMicroCompact } from "./micro-compact.js";

describe("clearToolOutputs", () => {
  it("clears compactable tool outputs", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Read the file" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: { path: "test.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content:
              "This is a very long file content that should be cleared to save tokens. ".repeat(
                100,
              ),
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Here's what I found" }],
      },
    ];

    const result = clearToolOutputs(messages, { preserveRecentResults: 0 });

    expect(result.clearedCount).toBe(1);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.clearedTools).toContain("Read");
    expect(result.modified).toBe(true);

    // Check content was actually cleared
    const toolResult = messages[2].content[0];
    expect(toolResult.content).toBe("[Tool output cleared to save tokens]");
  });

  it("preserves recent tool results", () => {
    const messages: AgentMessage[] = [];

    // Create 10 tool call pairs
    for (let i = 0; i < 10; i++) {
      messages.push(
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `tool_${i}`,
              name: "Read",
              input: { path: `file${i}.txt` },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: `tool_${i}`,
              content: `Content ${i}`.repeat(50),
            },
          ],
        },
      );
    }

    const result = clearToolOutputs(messages, { preserveRecentResults: 5 });

    // Should clear first 5, preserve last 5
    expect(result.clearedCount).toBe(5);

    // Check that last 5 are NOT cleared
    for (let i = 5; i < 10; i++) {
      const toolResult = messages[i * 2 + 1].content[0];
      expect(toolResult.content).not.toBe("[Tool output cleared to save tokens]");
    }

    // Check that first 5 ARE cleared
    for (let i = 0; i < 5; i++) {
      const toolResult = messages[i * 2 + 1].content[0];
      expect(toolResult.content).toBe("[Tool output cleared to save tokens]");
    }
  });

  it("skips non-compactable tools", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "custom_tool",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "Some output",
          },
        ],
      },
    ];

    const result = clearToolOutputs(messages);

    expect(result.clearedCount).toBe(0);
    expect(result.modified).toBe(false);

    // Content should be unchanged
    const toolResult = messages[1].content[0];
    expect(toolResult.content).toBe("Some output");
  });

  it("skips already cleared results", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: { path: "test.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "[Tool output cleared to save tokens]",
          },
        ],
      },
    ];

    const result = clearToolOutputs(messages);

    expect(result.clearedCount).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("handles messages with no tool results", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ];

    const result = clearToolOutputs(messages);

    expect(result.clearedCount).toBe(0);
    expect(result.tokensSaved).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("handles empty message array", () => {
    const messages: AgentMessage[] = [];

    const result = clearToolOutputs(messages);

    expect(result.clearedCount).toBe(0);
    expect(result.tokensSaved).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("clears multiple tool types", () => {
    const messages: AgentMessage[] = [
      // Read tool
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "File content",
          },
        ],
      },
      // exec tool
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_2",
            name: "exec",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_2",
            content: "Command output",
          },
        ],
      },
    ];

    const result = clearToolOutputs(messages, { preserveRecentResults: 0 });

    expect(result.clearedCount).toBe(2);
    expect(result.clearedTools).toContain("Read");
    expect(result.clearedTools).toContain("exec");
  });

  it("uses custom cleared marker", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: "Some content",
          },
        ],
      },
    ];

    const result = clearToolOutputs(messages, {
      clearedMarker: "[CUSTOM MARKER]",
      preserveRecentResults: 0,
    });

    expect(result.clearedCount).toBe(1);

    const toolResult = messages[1].content[0];
    expect(toolResult.content).toBe("[CUSTOM MARKER]");
  });

  it("tracks tokens saved accurately", () => {
    const longContent = "x".repeat(1000); // ~250 tokens

    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "Read",
            input: {},
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_1",
            content: longContent,
          },
        ],
      },
    ];

    const result = clearToolOutputs(messages, { preserveRecentResults: 0 });

    expect(result.tokensSaved).toBeGreaterThan(200); // Should save ~250 tokens
    expect(result.tokensSaved).toBeLessThan(300);
  });
});

describe("shouldMicroCompact", () => {
  it("triggers at 90% by default", () => {
    const messages: AgentMessage[] = [];
    const currentTokens = 180000;
    const tokenLimit = 200000;

    const should = shouldMicroCompact(messages, currentTokens, tokenLimit);

    expect(should).toBe(true);
  });

  it("does not trigger below threshold", () => {
    const messages: AgentMessage[] = [];
    const currentTokens = 170000;
    const tokenLimit = 200000;

    const should = shouldMicroCompact(messages, currentTokens, tokenLimit);

    expect(should).toBe(false);
  });

  it("respects custom trigger percentage", () => {
    const messages: AgentMessage[] = [];
    const currentTokens = 160000;
    const tokenLimit = 200000;

    const should = shouldMicroCompact(messages, currentTokens, tokenLimit, 80);

    expect(should).toBe(true);
  });
});
