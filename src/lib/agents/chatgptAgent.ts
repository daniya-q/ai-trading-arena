import { buildTradingPrompt } from "@/lib/aiPromptBuilder";

type AgentInput = {
  symbol: string;

  currentPrice: number;

  signal: string;

  confidence: number;

  trend: string;

  volatility: string;

  multiTimeframe: {
    finalSignal: string;

    overallTrend: string;

    alignment: number;
  };
};

export async function runChatGPTAgent(
  input: AgentInput
) {
  try {
    const prompt =
      buildTradingPrompt(
        input
      );

    const response =
      await fetch(
        "/api/ai/chat",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(
            {
              prompt,
            }
          ),
        }
      );

    const data =
      await response.json();

    if (
      !data.success
    ) {
      return null;
    }

    const content =
      data.content;

    if (!content) {
      return null;
    }

    /*
      Try extracting JSON safely
    */

    const jsonMatch =
      content.match(
        /\{[\s\S]*\}/
      );

    if (!jsonMatch) {
      console.log(
        "No valid JSON found"
      );

      return null;
    }

    const parsed =
      JSON.parse(
        jsonMatch[0]
      );

    return parsed;
  } catch (error) {
    console.error(
      "ChatGPT Agent Error:",
      error
    );

    return null;
  }
}