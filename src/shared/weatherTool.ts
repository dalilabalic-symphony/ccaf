// A single mock tool, shared by the manual-loop and Tool Runner examples,
// so both scripts are running the exact same "tool" and only the loop
// mechanics around it differ.

// Raw JSON-schema tool definition, in the shape the Messages API expects
// directly (used by the manual loop in 2-manual-loop.ts).
export const weatherToolDefinition = {
  name: "get_weather",
  description:
    "Get the current weather for a city. Returns temperature and conditions.",
  input_schema: {
    type: "object" as const,
    properties: {
      location: {
        type: "string",
        description: "City name, e.g. 'Paris' or 'Tokyo'",
      },
    },
    required: ["location"],
  },
};

// The actual "implementation" — hardcoded so the examples need no extra
// API keys or network access beyond the Claude API call itself.
export function getWeather(location: string): string {
  return `72°F (22°C) and sunny in ${location}`;
}
