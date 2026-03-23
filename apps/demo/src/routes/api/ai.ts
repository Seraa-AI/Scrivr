import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import type { UIMessage, UIMessageStreamWriter } from "ai";
import { createFileRoute } from "@tanstack/react-router";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

// ── Typed data parts emitted per tool result ────────────────────────────────
// The client's onData callback receives these during streaming.
export type ToolOutputData = {
  toolCallId: string;
  toolType: string;
  output: Record<string, unknown>;
};

type DocBlock = { nodeId: string; text: string };

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { messages, context, blocks } = (await request.json()) as {
          messages: UIMessage[];
          context?: string;
          blocks?: DocBlock[];
        };

        // Build structured document context for the system prompt.
        // blocks come from AiToolkitAPI.getBlocks() — accepted text only, no markup.
        const docContextLines: string[] = [];
        if (blocks && blocks.length > 0) {
          docContextLines.push(
            "## Document content",
            "",
            "Each block has a stable nodeId. Use it when calling `edit_paragraph` or `edit_section`.",
            "The text shown is the clean accepted view (pending tracked changes already resolved).",
            "Your proposedText replaces the entire block — plain text, no markup.",
            "",
          );
          for (const b of blocks) {
            docContextLines.push(`nodeId: ${b.nodeId}`);
            docContextLines.push(`text: ${b.text}`);
            docContextLines.push("");
          }
        } else if (context) {
          docContextLines.push("## Current document context", "", context);
        }

        const systemPrompt = [
          "You are a writing assistant embedded in a document editor.",
          "",
          "## Tool usage rules (follow strictly)",
          "- To edit one paragraph → `edit_paragraph(nodeId, proposedText)`.",
          "- To rewrite multiple paragraphs at once → `edit_section(edits)` — one atomic change.",
          "- To insert entirely new text at the cursor → `insert_text(text)`.",
          "- To replace the currently selected text → `replace_selection(text)`.",
          "- You MAY include a short text message (1-2 sentences) explaining what you are doing.",
          "- NEVER write suggested content only in a text reply — always put it in a tool call.",
          "- If the user is asking a general question (not requesting new content), reply with text only.",
          ...(docContextLines.length > 0 ? ["", ...docContextLines] : []),
        ].join("\n");

        // Anthropic requires every tool_use block's `input` to be a plain
        // JSON object. `convertToModelMessages` can emit null or a non-object
        // when the UIMessage snapshot doesn't carry the original tool inputs,
        // which causes a 400 "Input should be a valid dictionary" error on
        // subsequent turns. This sanitizer fixes those blocks in-place.
        type ModelMessages = Awaited<ReturnType<typeof convertToModelMessages>>;
        function sanitizeModelMessages(msgs: ModelMessages): ModelMessages {
          return msgs.map((msg) => {
            if (msg.role !== "assistant" || !Array.isArray(msg.content)) return msg;
            const fixed = msg.content.map((block) => {
              const b = block as Record<string, unknown>;
              if (
                b["type"] === "tool_use" &&
                (b["input"] === null ||
                  b["input"] === undefined ||
                  typeof b["input"] !== "object" ||
                  Array.isArray(b["input"]))
              ) {
                return { ...b, input: {} } as typeof block;
              }
              return block;
            });
            return { ...msg, content: fixed } as typeof msg;
          });
        }

        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            const result = streamText({
              model: anthropic("claude-sonnet-4-6"),
              system: systemPrompt,
              messages: sanitizeModelMessages(await convertToModelMessages(messages)),
              stopWhen: stepCountIs(5),
              tools: {
                edit_paragraph: tool({
                  description:
                    "Rewrite or edit a single paragraph. Use the nodeId from the document context. Provide the full replacement for the paragraph's accepted text — plain text, no markup.",
                  inputSchema: z.object({
                    nodeId: z.string().describe("The nodeId of the paragraph to edit"),
                    proposedText: z
                      .string()
                      .describe("The full replacement text (plain text, no markup)"),
                  }),
                  execute: async ({ nodeId, proposedText }, { toolCallId }) => {
                    writer.write({
                      type: "data-tool_result",
                      data: { toolCallId, toolType: "edit_paragraph", output: { nodeId, proposedText } } satisfies ToolOutputData,
                    });
                    return { nodeId, proposedText };
                  },
                }),

                edit_section: tool({
                  description:
                    "Rewrite multiple paragraphs at once as a single atomic suggestion. Use this when the user asks to rewrite a section, passage, or multiple paragraphs together. All edits land in one undo step.",
                  inputSchema: z.object({
                    edits: z
                      .array(
                        z.object({
                          nodeId: z.string().describe("The nodeId of the paragraph to edit"),
                          proposedText: z
                            .string()
                            .describe("The full replacement text for this paragraph"),
                        }),
                      )
                      .describe("All paragraph edits to apply together"),
                  }),
                  execute: async ({ edits }, { toolCallId }) => {
                    writer.write({
                      type: "data-tool_result",
                      data: { toolCallId, toolType: "edit_section", output: { edits } } satisfies ToolOutputData,
                    });
                    return { edits };
                  },
                }),

                insert_text: tool({
                  description:
                    "Insert new text into the document at the current cursor position. Use this to add new content or continue a passage.",
                  inputSchema: z.object({
                    text: z.string().describe("The text to insert into the document"),
                  }),
                  execute: async ({ text }, { toolCallId }) => {
                    (writer as UIMessageStreamWriter<any>).write({
                      type: "data-tool_result",
                      data: { toolCallId, toolType: "insert_text", output: { text } } satisfies ToolOutputData,
                    });
                    return { text };
                  },
                }),

                replace_selection: tool({
                  description:
                    "Replace the currently selected text with new text. Use this when the user asks to rewrite, rephrase, or fix selected content.",
                  inputSchema: z.object({
                    text: z.string().describe("The replacement text"),
                  }),
                  execute: async ({ text }, { toolCallId }) => {
                    (writer as UIMessageStreamWriter<any>).write({
                      type: "data-tool_result",
                      data: { toolCallId, toolType: "replace_selection", output: { text } } satisfies ToolOutputData,
                    });
                    return { text };
                  },
                }),
              },
            });

            writer.merge(result.toUIMessageStream());
          },
        });

        return createUIMessageStreamResponse({ stream });
      },
    },
  },
});
