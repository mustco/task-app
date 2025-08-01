// lib/upstash-ratelimit.ts

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Inisialisasi klien Redis Upstash
// Pastikan UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN ada di .env.local
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Buat instance ratelimit
// Contoh: 5 permintaan per 10 detik per ID unik
export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(15, "1 m"), // 15 requests per 1 minutes
  analytics: true, // Opsional: kirim metrik ke Upstash Console
  /**
   * Optional: A value in milliseconds that is added to the token lifetime
   * of theлек token and used to avoid race conditions.
   * Default: 5000 (5 seconds)
   */
  ephemeralCache: new Map(),
  // durabilities: ["10s", "1m"], // Opsional: untuk melihat data di Upstash Console
});

// Anda bisa membuat ratelimit terpisah untuk skenario berbeda jika perlu:
// export const strictRatelimit = new Ratelimit({
//   redis: redis,
//   limiter: Ratelimit.fixedWindow(2, "1 m"), // 2 requests per 1 minute
//   ephemeralCache: new Map(),
// });
