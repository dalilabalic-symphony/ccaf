// Example 1: the simplest possible call to the Messages API.
//
// No loop, no tools — just a single request/response, so you can see the
// baseline shape everything else in this repo builds on.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";

async function main() {
  // With no arguments, the client reads credentials from ANTHROPIC_API_KEY
  // (or an `ant auth login` profile) — never hardcode a key here.
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      { role: "user", content: "In one sentence, what is an LLM agent loop?" },
    ],
  });

  // response.content is an array of content blocks (text, tool_use, ...).
  // For a plain text reply, there's exactly one "text" block.
  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    }
  }

  console.log("\n--- raw usage ---");
  console.log(response.usage);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
