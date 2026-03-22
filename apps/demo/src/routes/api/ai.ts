import { streamText, convertToModelMessages, tool, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { createFileRoute } from "@tanstack/react-router";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ParagraphContext } from "@inscribe/plugins";

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { messages, context, paragraphContexts } = (await request.json()) as {
          messages: UIMessage[];
          context?: string;
          paragraphContexts?: ParagraphContext[];
        };

        // Build structured document context for the system prompt
        const docContextLines: string[] = [];
        if (paragraphContexts && paragraphContexts.length > 0) {
          docContextLines.push("## Document content (paragraph by paragraph)");
          docContextLines.push("");
          docContextLines.push(
            "Each paragraph has a nodeId you MUST use when calling `edit_paragraph`.",
            "The `decoratedText` shows pending tracked changes: <ins author=\"...\"> and <del author=\"...\"> tags.",
            "The `acceptedText` is the clean view — propose your replacement against this string.",
            "",
          );
          for (const p of paragraphContexts) {
            docContextLines.push(`nodeId: ${p.nodeId}`);
            if (p.decoratedText !== p.acceptedText) {
              docContextLines.push(`current (with changes): ${p.decoratedText}`);
            }
            docContextLines.push(`accepted text: ${p.acceptedText}`);
            docContextLines.push("");
          }
        } else if (context) {
          docContextLines.push("## Current document context", "", context);
        }

        const systemPrompt = [
          "You are a writing assistant embedded in a document editor.",
          "",
          "## Tool usage rules (follow strictly)",
          "- To edit or rewrite a specific paragraph → call `edit_paragraph` with the nodeId and your proposed replacement for the entire paragraph's accepted text.",
          "- To insert entirely new text at the cursor → call `insert_text` with that content.",
          "- To replace the currently selected text → call `replace_selection`.",
          "- You MAY include a short text message (1-2 sentences) explaining what you are doing.",
          "- NEVER write the suggested content only in a text reply — always put it in a tool call.",
          "- If the user is asking a general question (not requesting new content), reply with text only.",
          ...(docContextLines.length > 0 ? ["", ...docContextLines] : []),
        ].join("\n");

        const result = streamText({
          model: anthropic("claude-sonnet-4-6"),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(5),
          tools: {
            edit_paragraph: tool({
              description:
                "Rewrite or edit a specific paragraph in the document. Use the nodeId from the document context. Provide the full replacement for the paragraph's accepted text — do not include tracked-change markup in your proposedText.",
              inputSchema: z.object({
                nodeId: z.string().describe("The nodeId of the paragraph to edit"),
                proposedText: z
                  .string()
                  .describe(
                    "The full replacement text for the paragraph (plain text, no markup). This replaces the acceptedText shown in the document context.",
                  ),
              }),
              execute: async ({ nodeId, proposedText }) => ({ nodeId, proposedText }),
            }),
            insert_text: tool({
              description:
                "Insert new text into the document at the current cursor position. Use this to add new content or continue a passage.",
              inputSchema: z.object({
                text: z.string().describe("The text to insert into the document"),
              }),
              execute: async ({ text }) => ({ text }),
            }),
            replace_selection: tool({
              description:
                "Replace the currently selected text with new text. Use this when the user asks to rewrite, rephrase, or fix selected content.",
              inputSchema: z.object({
                text: z.string().describe("The replacement text"),
              }),
              execute: async ({ text }) => ({ text }),
            }),
          },
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
