# Rate Limiting & Anti-Spam System

## Overview

Sistem rate limiting dan anti-spam telah diimplementasikan untuk mencegah pemborosan Gemini API calls dan melindungi sistem dari penyalahgunaan. Sistem ini menggunakan multiple layers untuk memastikan bot hanya merespon message yang valid dan tidak berlebihan.

## Features

### 1. **Enhanced Rate Limiting**
- **Regular Rate Limit**: 3 pesan per menit per user (turun dari 10 sebelumnya)
- **Debounce Rate Limit**: 1 pesan per 5 detik untuk rapid-fire messages
- **Chat & Sender Limits**: Berdasarkan chat ID dan nomor pengirim

### 2. **Message Debouncing**
- Jika user mengirim pesan berturut-turut dalam 5 detik, hanya pesan terakhir yang akan diproses
- Delay 4 detik untuk memastikan tidak ada pesan baru yang masuk
- Automatic cancellation jika ada pesan baru yang menggantikan

### 3. **Duplicate Message Detection**
- Mencegah processing pesan yang identik dalam window 10 detik
- Menggunakan Redis untuk tracking pesan terbaru
- Menghindari response duplikat untuk spam yang sama

## How It Works

### Message Flow
```
Pesan Masuk → Security Check → User Validation → Duplicate Check → Rate Limiting → Debouncing → Processing
```

### Rate Limiting Layers
1. **Chat Level**: Limit berdasarkan WhatsApp chat ID
2. **Sender Level**: Limit berdasarkan nomor pengirim
3. **User Level**: Limit berdasarkan registered user ID
4. **Debounce Level**: Extra ketat untuk rapid messages

### Debouncing Process
```
User kirim 5 pesan cepat (1-2 detik) →
Pesan 1-4: Ditunda dan dibatalkan →
Pesan 5: Diproses setelah delay 4 detik →
Result: Hanya 1 response, menghemat 4 Gemini API calls
```

## Configuration

### Rate Limits (dalam `lib/upstash-ratelimit.ts`)
```typescript
// Main rate limiter - 3 pesan per menit
export const ratelimit = new Ratelimit({
  limiter: Ratelimit.slidingWindow(3, "1 m")
});

// Debounce limiter - 1 pesan per 5 detik  
export const debounceRatelimit = new Ratelimit({
  limiter: Ratelimit.slidingWindow(1, "5 s")
});
```

### Debouncing Settings
- **Delay**: 4 detik (dapat disesuaikan)
- **Duplicate Window**: 10 detik
- **Message Expiry**: 10 detik di Redis

## Benefits

### 1. **Cost Savings**
- Mencegah multiple Gemini API calls untuk spam messages
- Menghemat hingga 80-90% API calls untuk user yang spam

### 2. **Performance**
- Mengurangi load pada server
- Mencegah rate limiting dari Gemini API
- Improved response time untuk user legitimate

### 3. **User Experience**
- Response yang lebih konsisten
- Tidak ada confusion dari multiple responses
- Protection dari bad actors

## Monitoring

### Logs yang Tersedia
```
✅ Normal processing
🚫 Duplicate message ignored for user {userId}
⏱️ Debouncing message for user {userId} 
🔄 Processing debounced message for user {userId}
❌ Message debounced/replaced for user {userId}
```

### Status Responses
- `"ignored"` - Pesan diabaikan (duplicate/unregistered)
- `"debounced"` - Pesan ditunda karena rapid-fire
- `"rate limited"` - Hit rate limit dengan retry-after header

## Testing

### Scenario 1: Normal Usage ✅
```
User: "besok meeting jam 2"
→ Processed normally
→ Response: Task created successfully
```

### Scenario 2: Rapid Messages 🛡️
```
User: (kirim cepat 5x dalam 2 detik)
"besok"
"besok meeting"  
"besok meeting jam"
"besok meeting jam 2"
"besok meeting jam 2 sore"

→ Hanya pesan terakhir yang diproses
→ 1 response: Task created untuk "besok meeting jam 2 sore"
→ Saved: 4 Gemini API calls
```

### Scenario 3: Duplicate Spam 🛡️
```
User: (kirim 3x pesan sama)
"tutorial"
"tutorial" 
"tutorial"

→ Hanya pesan pertama yang diproses
→ 1 response: Tutorial text
→ 2 pesan berikutnya ignored
```

## Troubleshooting

### Issue: Legitimate user terkena rate limit
**Solution**: Rate limit akan reset otomatis setelah time window. User bisa retry.

### Issue: Debouncing terlalu agresif  
**Solution**: Sesuaikan delay di `debounceMessage()` dari 4000ms ke nilai yang lebih kecil.

### Issue: Redis connection error
**Solution**: Rate limiting akan tetap berjalan dengan fallback, tapi tanpa persistence.

## Environment Variables Required

```env
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

## Code Changes Summary

1. **Updated `lib/upstash-ratelimit.ts`**:
   - Reduced main rate limit to 3/minute
   - Added debounce rate limiter
   - Implemented MessageDebouncer class

2. **Updated `app/api/webhooks/baileys/route.ts`**:
   - Added duplicate message detection
   - Implemented debouncing logic
   - Enhanced rate limiting with multiple layers

This system provides robust protection against message spam while maintaining good UX for legitimate users.