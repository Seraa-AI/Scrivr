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
import { SemanticEditSchema } from "@scrivr/ai";
import type { SemanticImage } from "@scrivr/core";

// ── Typed data parts emitted per tool result ────────────────────────────────
// The client's onData callback receives these during streaming.
export type ToolOutputData = {
  toolCallId: string;
  toolType: string;
  output: Record<string, unknown>;
};

/** A unit of `getRichBlocks()`, trimmed to what the agent needs to address it. */
export type DocUnit = {
  id: string;
  type: string;
  text: string;
  headingLevel?: number;
  parts?: Array<{ nodeId: string; text: string }>;
  image?: SemanticImage;
};

const RequestBodySchema = z.object({
  messages: z.array(z.custom<UIMessage>((message) => typeof message === "object" && message !== null)),
  context: z.string().optional(),
  units: z.array(z.custom<DocUnit>((unit) => typeof unit === "object" && unit !== null && "id" in unit)).optional(),
});

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = RequestBodySchema.safeParse(await request.json());
        if (!body.success) return new Response(body.error.message, { status: 400 });
        const { messages, context, units } = body.data;

        const docContextLines: string[] = [];
        if (units && units.length > 0) {
          docContextLines.push(
            "## Document content",
            "",
            "Blocks are listed in document order, first to last. Each has a stable nodeId; a list or table",
            "also lists the nodeIds of its items or cells. Address blocks by these ids in every tool. Text",
            "reads as if every pending change were accepted; a block or image proposed for deletion is absent.",
            "To put something at the end of the document, place it after the block marked `last block`.",
            "",
          );
          for (const [index, u] of units.entries()) {
            const kind = u.headingLevel ? `heading ${u.headingLevel}` : u.type;
            const last = index === units.length - 1 ? ", last block" : "";
            docContextLines.push(`nodeId: ${u.id} (${kind}${last})`);
            if (u.image) {
              const { src, alt, width, height, wrap, align } = u.image;
              docContextLines.push(`image: ${src} "${alt}" ${width}×${height}, wrap ${wrap}, align ${align}`);
            } else if (u.parts?.length) {
              for (const part of u.parts) docContextLines.push(`  - nodeId: ${part.nodeId} — ${part.text}`);
            } else {
              docContextLines.push(`text: ${u.text}`);
            }
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
          "- To change the document's structure — move, add or delete blocks, list items or table rows — or to",
          "  rewrite blocks keeping their formatting → `edit_document(edits)`, one batch applied as tracked changes.",
          "  `moveBlock` takes a top-level block's nodeId; `moveListItem` takes an item's (or its paragraph's) nodeId and",
          "  stays within its own list. A batch touches a block once: don't move or delete what an earlier edit in",
          "  the same batch moved.",
          "- Images: an `image` unit is a paragraph holding one image, named by its nodeId. Add one with `insertBlock`",
          "  and `block: { type: \"image\", src, alt, width, height, wrap, align }`; change how it sits with `richText`",
          "  and `attrs: { wrap, align, width, height, alt }` (wrap: inline|square|top-bottom|behind|front, align:",
          "  left|center|right); remove it with `deleteBlock`. `src` must be an https image URL.",
          "- Headings: change a block's level with `richText` and `attrs: { level }` — 1-6 sets the heading level",
          "  (a paragraph becomes a heading), 0 makes a heading a paragraph.",
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

                edit_document: tool({
                  description:
                    "Apply semantic edits to the document as one batch of tracked suggestions: move, insert or delete blocks, list items and table rows, or rewrite a block's rich text. Each edit names blocks by nodeId.",
                  inputSchema: z.object({
                    edits: z.array(SemanticEditSchema).describe("The edits, applied in order as one batch"),
                  }),
                  execute: async ({ edits }, { toolCallId }) => {
                    writer.write({
                      type: "data-tool_result",
                      data: { toolCallId, toolType: "edit_document", output: { edits } } satisfies ToolOutputData,
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
