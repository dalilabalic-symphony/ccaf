// Example 2: the agent loop, written out by hand.
//
// This is the core teaching example. An "agent loop" is nothing magical —
// it's just this cycle, repeated until the model stops asking for tools:
//
//   1. Send the conversation so far (+ the tools Claude is allowed to use).
//   2. Claude replies. `stop_reason` tells you why it stopped:
//        - "tool_use"  -> Claude wants to call one or more tools
//        - "end_turn"  -> Claude is done; this is the final answer
//   3. If it's a tool call: run the tool yourself, feed the result back in
//      a new message, and go to step 1 again.
//
// The SDK's Tool Runner (see 3-tool-runner.ts) automates exactly this loop.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { weatherToolDefinition, getWeather } from "./shared/weatherTool.js";

const MODEL = "claude-haiku-4-5";
const MAX_ITERATIONS = 5; // safety net against a runaway loop

async function main() {
  const client = new Anthropic();

  // The API is stateless — we resend the full conversation on every turn,
  // appending to it as the loop progresses.
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "What's the weather in Paris? Give me the answer in both Fahrenheit and Celsius.",
    },
  ];

  for (let turn = 1; turn <= MAX_ITERATIONS; turn++) {
    console.log(`\n=== Turn ${turn}: calling the API ===`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [weatherToolDefinition],
      messages,
    });

    console.log(`stop_reason: ${response.stop_reason}`);

    // Log what Claude actually said/did this turn, before deciding what to
    // do next — this is the part a black-box helper would hide from you.
    for (const block of response.content) {
      if (block.type === "text") {
        console.log(`  [text] ${block.text}`);
      } else if (block.type === "tool_use") {
        console.log(
          `  [tool_use] ${block.name}(${JSON.stringify(block.input)})`,
        );
      }
    }

    // The assistant's turn (including any tool_use blocks) must be appended
    // to history before we can reply to it with tool results.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      console.log("\n=== Done ===");
      return;
    }

    if (response.stop_reason === "tool_use") {
      // Claude can request multiple tool calls in one turn — execute every
      // one and send all results back together, in a single user message.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "get_weather") {
          const { location } = block.input as { location: string };
          const result = getWeather(location);
          console.log(`  [running tool] get_weather("${location}") -> "${result}"`);

          toolResults.push({
            type: "tool_result",
            // tool_use_id must match the id Claude sent, so it knows which
            // call this result answers.
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
      continue; // loop again with the tool result now in history
    }

    // Any other stop_reason (max_tokens, refusal, ...) — bail out rather
    // than looping forever.
    console.log(`\nStopped early: ${response.stop_reason}`);
    return;
  }

  console.log(`\nHit MAX_ITERATIONS (${MAX_ITERATIONS}) without finishing.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
