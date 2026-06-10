import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const revalidate = 0;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("config")
    .select("value")
    .eq("key", "BTC_PRICE_USD")
    .single();

  if (error || !data?.value) {
    return NextResponse.json({ price: 0 });
  }

  return NextResponse.json({ price: parseFloat(data.value) });
}
