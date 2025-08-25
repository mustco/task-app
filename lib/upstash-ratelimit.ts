// lib/upstash-ratelimit.ts

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Inisialisasi klien Redis Upstash
// Pastikan UPSTASH_REDIS_REST_URL dan UPSTASH_REDIS_REST_TOKEN ada di .env.local
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Rate limiter yang lebih ketat untuk mencegah spam
// 3 pesan per menit per user untuk menghemat Gemini API calls
export const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(3, "1 m"), // 3 requests per 1 minute
  analytics: true,
  ephemeralCache: new Map(),
});

// Rate limiter khusus untuk debouncing - sangat ketat untuk pesan beruntun
export const debounceRatelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(1, "5 s"), // 1 request per 5 seconds
  analytics: true,
  ephemeralCache: new Map(),
});

// Message deduplication dan debouncing utilities
export class MessageDebouncer {
  private static instance: MessageDebouncer;
  private redis: Redis;
  private pendingMessages = new Map<string, NodeJS.Timeout>();

  private constructor() {
    this.redis = redis;
  }

  static getInstance(): MessageDebouncer {
    if (!MessageDebouncer.instance) {
      MessageDebouncer.instance = new MessageDebouncer();
    }
    return MessageDebouncer.instance;
  }

  // Debounce messages - hanya proses message terakhir dalam time window
  async debounceMessage(
    userId: string, 
    messageId: string, 
    messageText: string,
    delay: number = 3000 // 3 detik delay
  ): Promise<boolean> {
    const key = `debounce:${userId}`;
    
    // Clear existing timeout untuk user ini
    const existingTimeout = this.pendingMessages.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Simpan message terbaru di Redis dengan expiry
    await this.redis.setex(
      `latest_msg:${userId}`, 
      10, // expire dalam 10 detik
      JSON.stringify({
        messageId,
        messageText,
        timestamp: Date.now()
      })
    );

    // Set timeout untuk proses message ini
    return new Promise((resolve) => {
      const timeout = setTimeout(async () => {
        // Cek apakah ini masih message terakhir
        const latestMsg = await this.redis.get(`latest_msg:${userId}`);
        if (latestMsg) {
          const parsed = JSON.parse(latestMsg as string);
          // Hanya proses jika ini adalah message terakhir
          if (parsed.messageId === messageId) {
            resolve(true);
          } else {
            resolve(false); // Message sudah digantikan yang baru
          }
        } else {
          resolve(false);
        }
        
        this.pendingMessages.delete(key);
      }, delay);
      
      this.pendingMessages.set(key, timeout);
    });
  }

  // Cek apakah message serupa baru saja diproses (untuk mencegah duplikasi)
  async isDuplicateMessage(
    userId: string, 
    messageText: string, 
    timeWindowMs: number = 10000
  ): Promise<boolean> {
    const key = `recent_msg:${userId}`;
    const recentMsg = await this.redis.get(key);
    
    if (recentMsg) {
      const parsed = JSON.parse(recentMsg as string);
      const timeDiff = Date.now() - parsed.timestamp;
      
      // Jika message sama dalam time window, anggap duplikat
      if (timeDiff < timeWindowMs && parsed.text === messageText.trim()) {
        return true;
      }
    }

    // Simpan message ini sebagai recent message
    await this.redis.setex(
      key,
      Math.ceil(timeWindowMs / 1000),
      JSON.stringify({
        text: messageText.trim(),
        timestamp: Date.now()
      })
    );

    return false;
  }

  // Clear all pending messages untuk user tertentu
  clearPendingMessages(userId: string): void {
    const key = `debounce:${userId}`;
    const timeout = this.pendingMessages.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingMessages.delete(key);
    }
  }
}
