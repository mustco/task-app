// app/api/nlu/route.ts
import { NextResponse } from "next/server";
import { parseTextWithGemini } from "@/lib/gemini/client";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { ratelimit } from "@/lib/upstash-ratelimit"; // <- punyamu

const INTERNAL_NLU_SECRET = process.env.INTERNAL_NLU_SECRET || "";

// constant-time compare
function safeEq(a: string, b: string) {
  const A = Buffer.from(a || "");
  const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  try {
    return timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

// ambil ip dari header umum (Netlify/CF/Vercel)
function getClientIP(req: Request) {
  const h = req.headers;
  return (
    h.get("x-nf-client-connection-ip") ||
    h.get("cf-connecting-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
    h.get("x-real-ip") ||
    ""
  );
}

export async function POST(req: Request) {
  try {
    // 0) Secret via header (bukan query)
    const provided = req.headers.get("x-internal-secret") || "";
    if (!INTERNAL_NLU_SECRET || !safeEq(provided, INTERNAL_NLU_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1) Basic content-type guard
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        { error: "Unsupported Media Type" },
        { status: 415 }
      );
    }

    // 2) Payload size guard (dari Content-Length, lalu verifikasi actual)
    const cl = Number(req.headers.get("content-length") || "0");
    const MAX_BYTES = 4096; // ~4KB request body
    if (cl > MAX_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }

    // baca body aman, lalu validasi lagi panjang aktual
    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
    }

    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // 3) Rate limit (internal; supaya kalau ada salah konfigurasi, tetap aman)
    const ip = getClientIP(req) || "internal";
    const { success, reset } = await ratelimit.limit(`nlu:${ip}`);
    if (!success) {
      // optional: Retry-After (detik)
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return new NextResponse(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      });
    }

    // 4) Zod guard untuk message
    const Schema = z.object({
      message: z
        .string()
        .min(1, "Message is required")
        .max(500, "Message too long"), // <= limit panjang message
    });

    const parsedBody = Schema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Bad Request",
          details: parsedBody.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { message } = parsedBody.data;

    // 5) Jalankan NLU
    const parsed = await parseTextWithGemini(message);

    if (!parsed) {
      // fallback non-destructive (biar webhook dapat action:none)
      return NextResponse.json({
        action: "none",
        title: "",
        description: null,
        deadline: null,
        reminder_days: 0,
        remind_method: "whatsapp",
        target_contact: null,
      });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("NLU error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// (Opsional) kalau mau tegas: tolak method lain
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
