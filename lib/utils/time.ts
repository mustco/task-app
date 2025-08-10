// lib/utils/time.ts - FIXED VERSION V2
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const TZ = "Asia/Jakarta";

/** ISO dengan offset +07:00; kalau tanpa jam set defaultHour (09:00) */
export function ensureISOWIB(input?: string | Date | null, defaultHour = 9) {
  console.log("=== ensureISOWIB DEBUG V2 ===");
  console.log("Input:", input, "defaultHour:", defaultHour);

  if (!input) {
    const result = dayjs.tz(dayjs(), TZ).format("YYYY-MM-DD[T]HH:mm:ssZ");
    console.log("No input, using current time:", result);
    return result;
  }

  let base: dayjs.Dayjs;
    
  if (typeof input === "string") {
    // PERBAIKAN: Cek apakah input sudah punya timezone
    const hasTimezone = /[+-]\d{2}:\d{2}$|Z$/.test(input);

    console.log("Input has timezone:", hasTimezone);

    if (hasTimezone) {
      // Jika sudah ada timezone, parse langsung tanpa tambahan TZ
      base = dayjs(input);
      console.log(
        "Parsed with timezone aware dayjs():",
        base.format(),
        "isValid:",
        base.isValid()
      );

      // Convert ke WIB timezone tapi preserve waktu asli
      base = base.tz(TZ);
      console.log("Converted to WIB:", base.format());
    } else {
      // Jika belum ada timezone, anggap input sudah dalam WIB
      base = dayjs.tz(input, TZ);
      console.log(
        "Parsed as WIB timezone:",
        base.format(),
        "isValid:",
        base.isValid()
      );

      if (!base.isValid()) {
        base = dayjs.tz(new Date(input), TZ);
        console.log(
          "Parsed with new Date:",
          base.format(),
          "isValid:",
          base.isValid()
        );
      }
    }
  } else {
    base = dayjs.tz(input, TZ);
    console.log(
      "Direct Date object:",
      base.format(),
      "isValid:",
      base.isValid()
    );
  }

  if (!base.isValid()) {
    console.log("Invalid date, using current time");
    const result = dayjs.tz(dayjs(), TZ).format("YYYY-MM-DD[T]HH:mm:ssZ");
    return result;
  }

  // Log current values
  console.log("Final hour:", base.hour());
  console.log("Final minute:", base.minute());
  console.log("Final second:", base.second());

  // Check if needs default time (only if midnight and no specific time mentioned)
  const needsDefaultTime =
    base.hour() === 0 && base.minute() === 0 && base.second() === 0;
  console.log("needsDefaultTime:", needsDefaultTime);

  const withTime = needsDefaultTime
    ? base.hour(defaultHour).minute(0).second(0).millisecond(0)
    : base;

  const result = withTime.format("YYYY-MM-DD[T]HH:mm:ssZ");
  console.log("Final result:", result);
  console.log("=== END DEBUG V2 ===");

  return result;
}

/** Sekarang (WIB) dalam ISO offset */
export function nowISO() {
  return dayjs.tz(dayjs(), TZ).format("YYYY-MM-DD[T]HH:mm:ssZ");
}

/** now >= (deadline - reminderDays) dalam WIB */
export function isReminderDue(deadlineISO: string, reminderDays: number) {
  const deadline = dayjs.tz(deadlineISO, TZ);
  const due = deadline.subtract(reminderDays, "day");
  const now = dayjs.tz(dayjs(), TZ);
  return now.isAfter(due) || now.isSame(due);
}
