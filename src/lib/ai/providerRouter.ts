export async function runAIProvider(
  provider: string,

  prompt: string
) {
  /*
    GPT / OpenAI
  */

  if (
    provider === "openai"
  ) {
    const response =
      await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },

          body: JSON.stringify({
            model:
              "gpt-4o-mini",

            messages: [
              {
                role: "user",

                content:
                  prompt,
              },
            ],

            temperature: 0.7,
          }),
        }
      );

    const data =
      await response.json();

    return (
      data?.choices?.[0]
        ?.message?.content ||
      "No response"
    );
  }

  /*
    Claude
  */

  if (
    provider ===
    "claude"
  ) {
    const response =
      await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-api-key":
              process.env.ANTHROPIC_API_KEY || "",

            "anthropic-version":
              "2023-06-01",
          },

          body: JSON.stringify({
            model:
              "claude-haiku-4-5-20251001",

            max_tokens: 500,

            messages: [
              {
                role: "user",

                content:
                  prompt,
              },
            ],
          }),
        }
      );

    const data =
      await response.json();

    return (
      data?.content?.[0]
        ?.text ||
      "No response"
    );
  }

  /*
    Gemini
  */

  if (
    provider ===
    "gemini"
  ) {
    const response =
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt,
                  },
                ],
              },
            ],
          }),
        }
      );

    const data =
      await response.json();

    return (
      data?.candidates?.[0]
        ?.content?.parts?.[0]
        ?.text ||
      "No response"
    );
  }

  /*
    Groq
  */

  if (
    provider === "groq"
  ) {
    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },

          body: JSON.stringify({
            model:
              "llama3-70b-8192",

            messages: [
              {
                role: "user",

                content:
                  prompt,
              },
            ],

            temperature: 0.7,
          }),
        }
      );

    const data =
      await response.json();

    return (
      data?.choices?.[0]
        ?.message?.content ||
      "No response"
    );
  }

  return "Unknown provider";
}