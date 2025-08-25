import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  // IMPORTANT: Avoid writing any logic between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Get user profile to check role
  let userProfile = null
  if (user) {
    const { data } = await supabase.from("users").select("role, status").eq("id", user.id).single()
    userProfile = data
  }

  // Protected routes
  const protectedRoutes = ["/dashboard", "/profile"]
  const adminRoutes = ["/admin"]
  const authRoutes = ["/login", "/register"]
  const passwordResetRoutes = ["/forgot-password", "/reset-password"]

  const isProtectedRoute = protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  const isAdminRoute = adminRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  const isAuthRoute = authRoutes.some((route) => request.nextUrl.pathname.startsWith(route))
  const isPasswordResetRoute = passwordResetRoutes.some((route) => request.nextUrl.pathname.startsWith(route))

  // Redirect logic
  if (isAuthRoute && user && !isPasswordResetRoute) {
    // If user is logged in and trying to access auth pages (but not password reset), redirect to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  if (isProtectedRoute && !user) {
    // If user is not logged in and trying to access protected pages, redirect to login
    return NextResponse.redirect(new URL("/login", request.url))
  }

  if (isAdminRoute && (!user || userProfile?.role !== "admin")) {
    // If user is not admin and trying to access admin pages, redirect to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  if (user && userProfile?.status === "suspended") {
    // If user is suspended, redirect to suspended page
    return NextResponse.redirect(new URL("/suspended", request.url))
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
  // creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
