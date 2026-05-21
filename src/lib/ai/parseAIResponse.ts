export type ParsedAIResponse = {
  action: "BUY" | "SELL" | "HOLD" | "CLOSE";
  symbol: string;
  optionType: "CE" | "PE" | null;
  strike: number | null;
  expiry: string | null;
  quantity: number;
  confidence: number;
  reasoning: string;
  strategyStatement: string;
};

export function parseAIResponse(
  response: string
): ParsedAIResponse {
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

    /*
      Support both "action" (new) and "decision" (legacy)
    */

    const rawAction = (
      parsed.action ||
      parsed.decision ||
      "HOLD"
    )
      .toString()
      .toUpperCase();

    const action: ParsedAIResponse["action"] =
      ["BUY", "SELL", "HOLD", "CLOSE"].includes(
        rawAction
      )
        ? (rawAction as ParsedAIResponse["action"])
        : "HOLD";

    const rawOptionType =
      parsed.optionType?.toString().toUpperCase();

    const optionType: "CE" | "PE" | null =
      rawOptionType === "CE" || rawOptionType === "PE"
        ? rawOptionType
        : null;

    return {
      action,

      symbol:
        parsed.symbol || "NIFTY",

      optionType,

      strike:
        parsed.strike != null
          ? Number(parsed.strike)
          : null,

      expiry:
        parsed.expiry || null,

      quantity:
        Math.max(
          1,
          Number(parsed.quantity) || 1
        ),

      confidence:
        Math.min(
          100,
          Math.max(
            0,
            Number(parsed.confidence) || 50
          )
        ),

      reasoning:
        parsed.reasoning ||
        parsed.reason ||
        "No reasoning provided",

      strategyStatement:
        parsed.strategyStatement ||
        "No strategy statement",
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
      action: "HOLD",

      symbol: "NIFTY",

      optionType: null,

      strike: null,

      expiry: null,

      quantity: 1,

      confidence: 50,

      reasoning: "Fallback parser triggered",

      strategyStatement:
        "Parse error — holding cash",
    };
  }
}
