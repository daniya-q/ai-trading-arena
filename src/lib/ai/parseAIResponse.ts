export function parseAIResponse(
  response: string
) {
  try {
    /*
      Remove markdown wrappers
    */

    const cleaned =
      response
        .replace(
          /```json/g,
          ""
        )
        .replace(
          /```/g,
          ""
        )
        .trim();

    const parsed =
      JSON.parse(cleaned);

    return {
      symbol:
        parsed.symbol ||
        "NIFTY",

      decision:
        parsed.decision ||
        "HOLD",

      confidence:
        Number(
          parsed.confidence
        ) || 50,

      reason:
        parsed.reason ||
        "No reasoning provided",
    };
  } catch (error) {
    console.error(
      "AI Parse Error:",
      error
    );

    /*
      Safe fallback
    */

    return {
      symbol: "NIFTY",

      decision: "HOLD",

      confidence: 50,

      reason:
        "Fallback parser triggered",
    };
  }
}