// Example 3: the same task as 2-manual-loop.ts, but using the SDK's
// (beta) Tool Runner instead of hand-writing the loop.
//
// Compare this file to 2-manual-loop.ts: same tool, same question, same
// final result — but the request/response/tool-execution cycle is now
// entirely owned by the SDK. You define the tool as a typed function and
// hand the whole thing to `toolRunner`, which loops until Claude is done.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getWeather } from "../shared/weatherTool.js";

const MODEL = "claude-haiku-4-5";

async function main() {
  const client = new Anthropic();

  // Same tool as the manual example, but defined once as a typed function —
  // the SDK derives the JSON schema from the Zod shape automatically.
  const weatherTool = betaZodTool({
    name: "get_weather",
    description:
      "Get the current weather for a city. Returns temperature and conditions.",
    inputSchema: z.object({
      location: z.string().describe("City name, e.g. 'Paris' or 'Tokyo'"),
    }),
    run: async ({ location }) => {
      const result = getWeather(location);
      console.log(`  [running tool] get_weather("${location}") -> "${result}"`);
      return result;
    },
  });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 1024,
    tools: [weatherTool],
    messages: [
      {
        role: "user",
        content:
          "What's the weather in Paris? Give me the answer in both Fahrenheit and Celsius.",
      },
    ],
  });

  // Each iteration is one full turn of the loop the manual example wrote
  // out by hand — the runner stops automatically once Claude has no more
  // tool calls to make.
  let turn = 0;
  for await (const message of runner) {
    turn++;
    console.log(`\n=== Turn ${turn}: stop_reason=${message.stop_reason} ===`);
    for (const block of message.content) {
      if (block.type === "text") {
        console.log(`  [text] ${block.text}`);
      } else if (block.type === "tool_use") {
        console.log(`  [tool_use] ${block.name}(${JSON.stringify(block.input)})`);
      }
    }
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
