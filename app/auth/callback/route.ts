import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const type = searchParams.get("type");

  // Determine the correct base URL for redirects
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://listku.my.id";
  const isProduction = process.env.NODE_ENV === "production";
  
  // Use production URL if available, otherwise use origin from request
  const redirectBase = isProduction ? baseUrl : origin;

  if (code) {
    const supabase = await createClient();
    
    try {
      const { error, data } = await supabase.auth.exchangeCodeForSession(code);
      
      if (!error && data.session) {
        // Check if this is a password reset flow
        if (type === "recovery" || next.includes("reset-password")) {
          return NextResponse.redirect(`${redirectBase}/reset-password`);
        }
        
        // Check if this is an email verification (signup confirmation)
        if (type === "signup" || !data.session.user.email_confirmed_at) {
          // For email verification, redirect to confirmation page
          return NextResponse.redirect(`${redirectBase}/auth/email-confirmed`);
        }
        
        // Get user metadata to check if this is a first-time login
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('created_at')
          .eq('id', data.session.user.id)
          .single();
        
        // If user was just created (within last 5 minutes), show confirmation
        if (!userError && userData) {
          const createdAt = new Date(userData.created_at);
          const now = new Date();
          const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
          
          if (diffMinutes < 5) {
            return NextResponse.redirect(`${redirectBase}/auth/email-confirmed`);
          }
        }
        
        // For existing users or other auth flows, redirect to the intended destination
        if (isProduction) {
          return NextResponse.redirect(`${redirectBase}${next}`);
        } else {
          return NextResponse.redirect(`${origin}${next}`);
        }
      }
    } catch (error) {
      console.error("Auth callback error:", error);
    }
  }

  // Return the user to an error page with instructions if authentication failed
  return NextResponse.redirect(`${redirectBase}/auth/auth-code-error`);
}