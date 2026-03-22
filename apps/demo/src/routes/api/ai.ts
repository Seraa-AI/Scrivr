import { streamText, convertToModelMessages, tool, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { createFileRoute } from "@tanstack/react-router";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { messages, context } = (await request.json()) as {
          messages: UIMessage[];
          context?: string;
        };

        const result = streamText({
          model: anthropic("claude-sonnet-4-6"),
          system: context
            ? `You are a writing assistant embedded in a document editor.\n\nCurrent document context:\n\n${context}\n\nHelp the user write, edit, and improve their document. When you want to add or modify content, use the insert_text or replace_selection tools.`
            : "You are a writing assistant embedded in a document editor. Help the user write, edit, and improve their document. When you want to add or modify content, use the insert_text or replace_selection tools.",
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(5),
          tools: {
            insert_text: tool({
              description:
                "Insert text into the document at the current cursor position. Use this to add new content, continue a passage, or write something for the user.",
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
