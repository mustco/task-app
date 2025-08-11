// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ------- Edge rate limit (luar pagar) -------
const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// pisahin limiter biar bisa beda kuota per path
// webhook Fonnte: agak ketat
const fonnteEdgeLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      analytics: false,
    })
  : null;

// NLU (internal call): lebih longgar biar gak ganggu burst normal
const nluEdgeLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: false,
    })
  : null;

function getIP(req: NextRequest) {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1) Edge RL untuk webhook Fonnte
  if (path.startsWith("/api/webhooks/fonnte")) {
    if (fonnteEdgeLimiter) {
      const ip = getIP(req);
      const { success, reset } = await fonnteEdgeLimiter.limit(
        `edge:fonnte:${ip}`
      );
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return new NextResponse(
          JSON.stringify({ error: "Too Many Requests (edge)" }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(retryAfter),
            },
          }
        );
      }
    }
    // webhook gak perlu updateSession
    return NextResponse.next();
  }

  // 2) Edge RL untuk API NLU (internal)
  if (path.startsWith("/api/nlu")) {
    if (nluEdgeLimiter) {
      const ip = getIP(req);
      const { success, reset } = await nluEdgeLimiter.limit(`edge:nlu:${ip}`);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return new NextResponse(
          JSON.stringify({ error: "Too Many Requests (edge)" }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(retryAfter),
            },
          }
        );
      }
    }
    // /api/nlu juga gak butuh updateSession
    return NextResponse.next();
  }

  // 3) Rute lain tetap updateSession
  return await updateSession(req as any);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
