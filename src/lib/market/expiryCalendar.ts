import { supabase } from "@/lib/supabase/client";

export type Instrument =
  | "NIFTY"
  | "BANKNIFTY"
  | "SENSEX"
  | string;

// ── Helpers ───────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

/** Last occurrence of `weekday` (0=Sun…6=Sat) in a given month. */
function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number
): Date {
  // Start at the last day of the month
  const date = new Date(year, month + 1, 0);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

/**
 * Next `count` occurrences of `weekday` starting from today.
 * Today is included when it falls on the target weekday.
 */
function nextNWeekdays(weekday: number, count: number): Date[] {
  const results: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const date = new Date(today);
  const daysUntil = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntil); // 0 = today is the weekday

  while (results.length < count) {
    results.push(new Date(date));
    date.setDate(date.getDate() + 7);
  }

  return results;
}

/**
 * Next `count` last-weekday-of-month expiries starting from today's month.
 * Includes the current month's expiry if it has not yet passed.
 */
function nextNMonthlyExpiries(weekday: number, count: number): Date[] {
  const results: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let year = today.getFullYear();
  let month = today.getMonth();

  while (results.length < count) {
    const expiry = lastWeekdayOfMonth(year, month, weekday);
    if (expiry >= today) {
      results.push(expiry);
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return results;
}

// ── Supabase holiday fetch ────────────────────────────────────

/** Fetch NSE holidays for the next 180 days as YYYY-MM-DD strings. */
async function fetchHolidayStrings(): Promise<string[]> {
  const from = formatDate(new Date());
  const toDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const to = formatDate(toDate);

  const { data, error } = await supabase
    .from("nse_holidays")
    .select("date")
    .gte("date", from)
    .lte("date", to);

  if (error) {
    console.error("[ExpiryCalendar] Holiday fetch failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => row.date as string);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Check whether a single date is an NSE holiday.
 * Makes one Supabase query per call — use `getActualExpiry` for batch work.
 */
export async function isNSEHoliday(date: Date): Promise<boolean> {
  const dateStr = formatDate(date);
  const { data } = await supabase
    .from("nse_holidays")
    .select("date")
    .eq("date", dateStr)
    .maybeSingle();
  return data !== null;
}

/**
 * Shift a scheduled expiry date backwards until a non-holiday weekday is found.
 * `holidays` is a string[] of YYYY-MM-DD dates (pre-fetched from Supabase).
 */
export function getActualExpiry(
  scheduledDate: Date,
  holidays: string[]
): Date {
  const holidaySet = new Set(holidays);
  const date = new Date(scheduledDate);
  date.setHours(0, 0, 0, 0);

  while (true) {
    const day = date.getDay(); // 0=Sun, 6=Sat
    const dateStr = formatDate(date);

    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      return date;
    }

    date.setDate(date.getDate() - 1);
  }
}

/**
 * Returns the next 3 expiry dates for the given instrument,
 * adjusted for NSE holidays (shifts to previous trading day).
 *
 * - NIFTY   : every Tuesday (weekly)
 * - SENSEX  : every Thursday (weekly)
 * - BANKNIFTY / STOCKS : last Tuesday of each month (monthly only)
 */
export async function getUpcomingExpiries(
  instrument: Instrument
): Promise<Date[]> {
  const TUESDAY = 2;
  const THURSDAY = 4;

  let raw: Date[];

  switch (instrument) {
    case "NIFTY":
      raw = nextNWeekdays(TUESDAY, 3);
      break;
    case "SENSEX":
      raw = nextNWeekdays(THURSDAY, 3);
      break;
    case "BANKNIFTY":
    default:
      raw = nextNMonthlyExpiries(TUESDAY, 3);
      break;
  }

  const holidays = await fetchHolidayStrings();
  return raw.map((date) => getActualExpiry(date, holidays));
}

/**
 * Calendar days remaining until expiry (0 on expiry day, never negative).
 */
export function getDTE(expiryDate: Date | string): number {
  const expiry =
    typeof expiryDate === "string"
      ? new Date(expiryDate)
      : new Date(expiryDate);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);

  return Math.max(
    0,
    Math.round(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )
  );
}
