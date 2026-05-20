import { NextResponse } from "next/server";

import { fetchIndianMarketData } from "@/lib/upstox/fetchMarketData";

export async function GET() {
  try {
    const data =
      await fetchIndianMarketData();

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