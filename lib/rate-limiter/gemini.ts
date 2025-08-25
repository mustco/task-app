// lib/rate-limiter/gemini.ts - Smart Rate Limiter for Gemini API
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// SMART RATE LIMITING: Different limits per operation type
export const geminiRateLimit = {
  // Critical path - parsing user messages (most expensive)
  parsing: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(150, "1 h"), // 150 parse calls per hour per user
    analytics: true,
    prefix: "gemini:parse",
  }),

  // Reply generation (cheaper, can afford more)
  reply: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(300, "1 h"), // 300 reply calls per hour per user
    analytics: true,
    prefix: "gemini:reply",
  }),

  // Global API protection across all users
  global: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5000, "1 h"), // 5000 total calls per hour
    analytics: true,
    prefix: "gemini:global",
  }),
};

// USER TIER SYSTEM: Different limits based on usage patterns
export enum UserTier {
  FREE = "free",
  PREMIUM = "premium",
  ENTERPRISE = "enterprise",
}

const TIER_LIMITS = {
  [UserTier.FREE]: {
    parsing: 50, // 50 parse calls per hour
    reply: 100, // 100 reply calls per hour
  },
  [UserTier.PREMIUM]: {
    parsing: 200, // 200 parse calls per hour
    reply: 500, // 500 reply calls per hour
  },
  [UserTier.ENTERPRISE]: {
    parsing: 1000, // 1000 parse calls per hour
    reply: 2000, // 2000 reply calls per hour
  },
};

// ADAPTIVE RATE LIMITING: Adjust based on system load
class AdaptiveRateLimit {
  private redis: Redis;
  private systemLoadKey = "system:load";
  private highLoadThreshold = 0.8;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getSystemLoad(): Promise<number> {
    try {
      const load = await this.redis.get(this.systemLoadKey);
      return load ? Number(load) : 0;
    } catch {
      return 0;
    }
  }

  async updateSystemLoad(load: number): Promise<void> {
    try {
      await this.redis.setex(this.systemLoadKey, 300, load); // 5 min expiry
    } catch (e) {
      console.error("Failed to update system load:", e);
    }
  }

  async getAdjustedLimit(baseLimit: number, userId: string): Promise<number> {
    const systemLoad = await this.getSystemLoad();

    if (systemLoad > this.highLoadThreshold) {
      // Reduce limits by 50% during high load
      const adjustedLimit = Math.floor(baseLimit * 0.5);
      console.log(
        `🚨 High system load (${systemLoad}). Reducing limit from ${baseLimit} to ${adjustedLimit} for user ${userId}`
      );
      return adjustedLimit;
    }

    return baseLimit;
  }
}

const adaptiveLimit = new AdaptiveRateLimit(redis);

// SMART TOKEN CONSERVATION: Priority-based limiting
export async function checkGeminiRateLimit(
  userId: string,
  operation: "parsing" | "reply",
  userTier: UserTier = UserTier.FREE,
  priority: "low" | "normal" | "high" = "normal"
): Promise<{
  success: boolean;
  remaining: number;
  resetTime: number;
  message?: string;
}> {
  try {
    // Check global rate limit first
    const globalCheck = await geminiRateLimit.global.limit("global");
    if (!globalCheck.success) {
      console.log("🚨 Global Gemini rate limit exceeded");
      return {
        success: false,
        remaining: 0,
        resetTime: globalCheck.reset,
        message: "System temporarily busy. Please try again in a few minutes.",
      };
    }

    // Get tier-specific limits
    const tierLimit = TIER_LIMITS[userTier][operation];
    const adjustedLimit = await adaptiveLimit.getAdjustedLimit(
      tierLimit,
      userId
    );

    // Apply priority-based adjustments
    let finalLimit = adjustedLimit;
    if (priority === "high") {
      finalLimit = Math.floor(adjustedLimit * 1.2); // +20% for high priority
    } else if (priority === "low") {
      finalLimit = Math.floor(adjustedLimit * 0.8); // -20% for low priority
    }

    // Create dynamic rate limiter for this user/operation
    const userRateLimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(finalLimit, "1 h"),
      analytics: true,
      prefix: `gemini:${operation}:${userTier}`,
    });

    const result = await userRateLimit.limit(userId);

    if (!result.success) {
      console.log(
        `🚨 User ${userId} hit ${operation} rate limit (tier: ${userTier}, limit: ${finalLimit})`
      );

      // Suggest alternatives based on operation
      let message = "You've hit your rate limit. ";
      if (operation === "parsing") {
        message +=
          "Try using simple commands like 'lihat tugas' or upgrade your plan.";
      } else {
        message += "Please wait a moment before sending another message.";
      }

      return {
        success: false,
        remaining: result.remaining,
        resetTime: result.reset,
        message,
      };
    }

    return {
      success: true,
      remaining: result.remaining,
      resetTime: result.reset,
    };
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // Fail open - allow the request but log the error
    return {
      success: true,
      remaining: 999,
      resetTime: Date.now() + 3600000, // 1 hour from now
      message: "Rate limit check failed, allowing request",
    };
  }
}

// USAGE ANALYTICS: Track API usage patterns
export async function trackGeminiUsage(
  userId: string,
  operation: "parsing" | "reply",
  tokensUsed: number,
  success: boolean,
  userTier: UserTier = UserTier.FREE
): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const usageKey = `usage:${userId}:${today}`;

    const usageData = {
      [operation]: {
        count: 1,
        tokens: tokensUsed,
        success: success ? 1 : 0,
      },
    };

    // Increment usage counters
    await redis.hincrby(usageKey, `${operation}:count`, 1);
    await redis.hincrby(usageKey, `${operation}:tokens`, tokensUsed);
    if (success) {
      await redis.hincrby(usageKey, `${operation}:success`, 1);
    }

    // Set expiry for cleanup
    await redis.expire(usageKey, 7 * 24 * 60 * 60); // Keep for 7 days

    // Track system-wide usage
    const systemKey = `system:usage:${today}`;
    await redis.hincrby(systemKey, `total:${operation}:tokens`, tokensUsed);
    await redis.expire(systemKey, 30 * 24 * 60 * 60); // Keep for 30 days

    // Update system load based on usage
    const totalTokens =
      (await redis.hget(systemKey, `total:parsing:tokens`)) || 0;
    const load = Math.min(Number(totalTokens) / 1000000, 1); // Normalize to 0-1
    await adaptiveLimit.updateSystemLoad(load);
  } catch (error) {
    console.error("Failed to track Gemini usage:", error);
  }
}

// COST OPTIMIZATION: Estimate and warn about high usage
export async function getUserUsageSummary(userId: string): Promise<{
  today: { parsing: number; reply: number; tokens: number };
  tier: UserTier;
  percentUsed: { parsing: number; reply: number };
  recommendation?: string;
}> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const usageKey = `usage:${userId}:${today}`;

    const [parsingCount, replyCount, parsingTokens, replyTokens] =
      await Promise.all([
        redis.hget(usageKey, "parsing:count").then((v) => Number(v) || 0),
        redis.hget(usageKey, "reply:count").then((v) => Number(v) || 0),
        redis.hget(usageKey, "parsing:tokens").then((v) => Number(v) || 0),
        redis.hget(usageKey, "reply:tokens").then((v) => Number(v) || 0),
      ]);

    // Determine user tier (simplified - you'd get this from your user DB)
    const userTier = UserTier.FREE; // Default to free
    const limits = TIER_LIMITS[userTier];

    const parsingPercent = Math.round((parsingCount / limits.parsing) * 100);
    const replyPercent = Math.round((replyCount / limits.reply) * 100);

    let recommendation: string | undefined;

    if (parsingPercent > 80) {
      recommendation =
        "You're using a lot of AI parsing today. Consider using simple commands like 'lihat tugas' to save quota.";
    } else if (parsingPercent > 50 && userTier === UserTier.FREE) {
      recommendation = "Consider upgrading to Premium for higher API limits.";
    }

    return {
      today: {
        parsing: parsingCount,
        reply: replyCount,
        tokens: parsingTokens + replyTokens,
      },
      tier: userTier,
      percentUsed: {
        parsing: parsingPercent,
        reply: replyPercent,
      },
      recommendation,
    };
  } catch (error) {
    console.error("Failed to get usage summary:", error);
    return {
      today: { parsing: 0, reply: 0, tokens: 0 },
      tier: UserTier.FREE,
      percentUsed: { parsing: 0, reply: 0 },
    };
  }
}
