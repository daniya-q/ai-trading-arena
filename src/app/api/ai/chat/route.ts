import { NextResponse } from "next/server";

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,

            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            model:
              "llama3-70b-8192",

            messages: [
              {
                role: "system",

                content:
                  "You are an elite AI hedge fund manager.",
              },

              {
                role: "user",

                content:
                  body.prompt,
              },
            ],

            temperature: 0.7,
          }),
        }
      );

    const data =
      await response.json();

    return NextResponse.json({
      success: true,

      content:
        data.choices?.[0]
          ?.message
          ?.content,
    });
  } catch (error) {
    console.error(
      "Groq API Error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
      },

      {
        status: 500,
      }
    );
  }
}