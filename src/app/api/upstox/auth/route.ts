import { NextResponse } from "next/server";

export async function GET() {
  const apiKey =
    process.env.UPSTOX_API_KEY;

  const redirectUri =
    "http://localhost:3000";

  const authUrl =
    `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${redirectUri}`;

  return NextResponse.redirect(
    authUrl
  );
}