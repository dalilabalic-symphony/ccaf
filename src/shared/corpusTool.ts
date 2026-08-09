// Wraps the mock corpus as an in-process MCP server, the same way example 4
// wrapped `get_weather`.
//
// Note what the tool returns: a JSON array of records with `id`/`title`/`url`
// alongside `text`. Keeping attribution as *fields* rather than folding it
// into prose is what lets a citation survive being copied from a research
// subagent's output, into a coordinator's delegation prompt, into a synthesis
// subagent — three context boundaries, no lossy re-summarisation.

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchCorpus, type SourceType } from "./corpus.js";

export const CORPUS_TOOL_NAME = "mcp__corpus__search_corpus";

const searchTool = tool(
  "search_corpus",
  "Search the research corpus on residential heat pump adoption. Returns structured records with source metadata. Optionally filter to one source type so parallel researchers don't retrieve the same documents.",
  {
    query: z.string().describe("Keywords, e.g. 'payback subsidy cost'"),
    sourceType: z
      .enum(["news", "academic", "industry"])
      .optional()
      .describe("Restrict results to one source type"),
  },
  async ({ query, sourceType }) => {
    const results = searchCorpus(query, sourceType as SourceType | undefined);
    console.log(
      `        [corpus] search(${JSON.stringify(query)}${sourceType ? `, ${sourceType}` : ""}) -> ${results.length} hits: ${results.map((r) => r.id).join(", ") || "none"}`,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);

export const corpusServer = createSdkMcpServer({
  name: "corpus",
  version: "1.0.0",
  tools: [searchTool],
});
