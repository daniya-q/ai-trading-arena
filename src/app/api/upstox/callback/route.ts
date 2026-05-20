import { NextRequest } from "next/server";

import axios from "axios";

export async function GET(
  request: NextRequest
) {

  try {

    const code =
      request.nextUrl.searchParams.get(
        "code"
      );

    if (!code) {

      return new Response(
        "Authorization code missing",
        {
          status: 400,
        }
      );
    }

    const apiKey =
      process.env
        .UPSTOX_API_KEY;

    const apiSecret =
      process.env
        .UPSTOX_API_SECRET;

    const redirectUri =
      process.env
        .NEXT_PUBLIC_UPSTOX_REDIRECT_URI;

    /*
      Exchange code for token
    */

    const response =
      await axios.post(
        "https://api.upstox.com/v2/login/authorization/token",

        new URLSearchParams({
          code,

          client_id:
            apiKey || "",

          client_secret:
            apiSecret || "",

          redirect_uri:
            redirectUri || "",

          grant_type:
            "authorization_code",
        }),

        {
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
        }
      );

    const accessToken =
      response.data
        ?.access_token;

    console.log(
      "UPSTOX ACCESS TOKEN:"
    );

    console.log(
      accessToken
    );

    /*
      IMPORTANT:
      Later we'll store this securely
      in database/session
    */

    return new Response(
      `
      <html>
        <body style="background:black;color:white;font-family:sans-serif;padding:40px;">
          <h1>Upstox Connected Successfully</h1>

          <p>Access token generated.</p>

          <p>Check terminal logs.</p>
        </body>
      </html>
      `,
      {
        headers: {
          "Content-Type":
            "text/html",
        },
      }
    );

  } catch (error: any) {

    console.error(
      "OAuth Error:",
      error?.response?.data ||
        error
    );

    return new Response(
      "OAuth Failed",
      {
        status: 500,
      }
    );
  }
}