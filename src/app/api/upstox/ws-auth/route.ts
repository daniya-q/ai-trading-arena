import { NextResponse } from "next/server";

export async function GET() {
  const accessToken =
    process.env.UPSTOX_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          "UPSTOX_ACCESS_TOKEN not set",
      },
      { status: 500 }
    );
  }

  const res = await fetch(
    "https://api.upstox.com/v3/feed/market-data-feed/authorize",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();

    return NextResponse.json(
      {
        error: `Upstox authorize failed: ${res.status}`,
        detail: text,
      },
      { status: res.status }
    );
  }

  const json = await res.json();

  const authorizedRedirectUri =
    json?.data?.authorizedRedirectUri;

  if (!authorizedRedirectUri) {
    return NextResponse.json(
      {
        error:
          "No authorizedRedirectUri in response",
        raw: json,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    authorized_redirect_uri:
      authorizedRedirectUri,
  });
}
