// Example 4: the same task as 2-manual-loop.ts and 3-tool-runner.ts, but
// using the Claude Agent SDK — the higher-level SDK that Claude Code itself
// is built on (`@anthropic-ai/claude-agent-sdk`), not the Messages API SDK
// (`@anthropic-ai/sdk`) used in examples 1-3.
//
// Key difference from the Tool Runner: the Tool Runner still runs *your*
// process making direct Messages API calls in a loop. The Agent SDK's
// `query()` spawns a whole Claude Code agent session (its own subprocess)
// with its own agent loop, permission system, and built-in tools (Bash,
// Read, Write, ...). We turn all of that off and give it exactly one
// custom tool, so the shape of the example stays comparable.

import "dotenv/config";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getWeather } from "./shared/weatherTool.js";

const MODEL = "claude-haiku-4-5";

// Custom tools are defined with `tool()` (name, description, Zod input
// shape, async handler) and grouped into an in-process MCP server via
// `createSdkMcpServer()` — the Agent SDK talks to your own tools over the
// same MCP protocol it uses for external tool servers.
const weatherTool = tool(
  "get_weather",
  "Get the current weather for a city. Returns temperature and conditions.",
  { location: z.string().describe("City name, e.g. 'Paris' or 'Tokyo'") },
  async ({ location }) => {
    const result = getWeather(location);
    console.log(`  [running tool] get_weather("${location}") -> "${result}"`);
    return { content: [{ type: "text", text: result }] };
  },
);

const weatherServer = createSdkMcpServer({
  name: "weather",
  version: "1.0.0",
  tools: [weatherTool],
});

async function main() {
  const result = query({
    prompt:
      "What's the weather in Paris? Give me the answer in both Fahrenheit and Celsius.",
    options: {
      model: MODEL,
      mcpServers: { weather: weatherServer },
      // `tools: []` strips every built-in tool (Bash, Read, Write, ...) out
      // of the session — otherwise Claude could try to answer this by
      // shelling out to `curl` instead of calling our mock tool.
      tools: [],
      // Custom MCP tools are namespaced as `mcp__<server>__<tool>`.
      // Listing it here auto-approves it, skipping the permission prompt
      // Claude Code would normally show a human.
      allowedTools: ["mcp__weather__get_weather"],
      // This is a non-interactive script with no one to answer a
      // permission prompt — `dontAsk` denies anything not already
      // auto-approved above instead of hanging forever waiting for input.
      permissionMode: "dontAsk",
    },
  });

  // `query()` returns an async generator of SDKMessage — a level above the
  // raw Messages API `response` objects in examples 2 and 3. Each
  // "assistant" message here corresponds to one turn's `response.content`
  // in the manual loop; the final "result" message is emitted once the
  // whole session (the entire loop, run inside the SDK) has finished.
  for await (const message of result) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(`  [text] ${block.text}`);
        } else if (block.type === "tool_use") {
          console.log(`  [tool_use] ${block.name}(${JSON.stringify(block.input)})`);
        }
      }
    } else if (message.type === "result") {
      console.log(`\n=== Done (stop_reason=${message.stop_reason}) ===`);
      if (message.subtype === "success") {
        console.log(message.result);
      } else {
        console.log(`Ended without success: ${message.subtype}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
