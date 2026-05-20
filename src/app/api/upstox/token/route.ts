import { NextResponse } from "next/server";

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const response =
      await fetch(
        "https://api.upstox.com/v2/login/authorization/token",
        {
          method: "POST",

          headers: {
            accept:
              "application/json",

            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body:
            new URLSearchParams({
              code: body.code,

              client_id:
                process.env
                  .UPSTOX_API_KEY || "",

              client_secret:
                process.env
                  .UPSTOX_API_SECRET || "",

              redirect_uri:
                "http://localhost:3000",

              grant_type:
                "authorization_code",
            }),
        }
      );

    const data =
      await response.json();

    return NextResponse.json(
      data
    );
  } catch (error) {
    console.error(error);

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