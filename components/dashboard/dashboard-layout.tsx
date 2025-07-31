// app/components/dashboard/dashboard-layout.tsx (SECURE & OPTIMIZED VERSION)

"use client";

import type React from "react";
import { useState,useEffect, useTransition } from "react"; // Import useTransition
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import Image from "next/image";
import type { User } from "@/lib/types"; // Pastikan User type Anda mencakup semua properti yang digunakan
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel, // Tambahkan ini untuk label di dropdown
  DropdownMenuSeparator, // Tambahkan ini untuk separator
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, UserIcon, Shield, Loader2 } from "lucide-react"; // Tambahkan Loader2

interface DashboardLayoutProps {
  children: React.ReactNode;
  user: User | null; // user prop sudah diberikan dari Server Component yang sudah diautentikasi
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  // `loading` state untuk handle loading UI for sign out button
  const [loading, setLoading] = useState(false);
  // `isPending` dari useTransition untuk non-blocking navigasi
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient(); // Client-side Supabase client

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Supabase sign out error:", error); // Log error dari Supabase
        throw new Error(error.message || "Failed to sign out from Supabase.");
      }

      // Menggunakan startTransition untuk navigasi yang non-blocking
      // Ini akan mencegah UI membeku saat navigasi dan refresh
      startTransition(() => {
        router.push("/login");
        router.refresh();
      });

      toast({
        title: "Success",
        description: "You have been signed out successfully.",
      });
    } catch (error: any) {
      console.error("Error during sign out:", error); // Log error detail untuk debugging
      toast({
        title: "Sign Out Failed", // Judul yang lebih spesifik
        description:
          error.message || "An unexpected error occurred during sign out.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Keamanan: Validasi `user` prop secara dasar
  // Meskipun `page.tsx` sudah melakukan redirect, ini lapisan jaga-jaga
  if (!user) {
    // Pada client-side, jika user prop tiba-tiba null,
    // mungkin ada ketidaksesuaian atau sesi sudah berakhir.
    // Redirect ke login untuk re-autentikasi.
    // Hindari render konten dashboard yang kosong/rusak.
    // Ini juga bisa terjadi jika initial hydration gagal.
    console.warn("DashboardLayout received null user. Redirecting to login.");
    // Menggunakan effect untuk redirect agar tidak mengganggu rendering awal
    useEffect(() => {
      router.push("/login");
      router.refresh();
    }, [router]);
    return null; // Tidak render apapun sampai redirect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link
                href="/dashboard"
                className="flex items-center" // Tambahkan flex items-center untuk centering logo
              >
                <Image
                  src="/listkuu.png"
                  alt="ListKu Logo"
                  width={100}
                  height={100}
                  priority // Optimasi: preload gambar ini
                  className="h-8 w-auto object-contain" // Tambahkan object-contain untuk rasio aspek
                />
              </Link>
              <div className="ml-10 flex space-x-8">
                {/* Keamanan: Pastikan role admin diperiksa dari user prop yang sudah dari server */}
                {user.role === "admin" && (
                  <Link
                    href="/admin"
                    className="text-gray-900 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1"
                  >
                    <Shield className="w-4 h-4" />
                    Admin
                  </Link>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-8 w-8 rounded-full"
                    disabled={loading || isPending} // Disable trigger while loading/pending
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>
                        {/* Optimasi: String operation lebih aman dari null */}
                        {user.name
                          ? user.name.charAt(0).toUpperCase()
                          : user.email?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="font-medium">{user.name || "User"}</p>{" "}
                      {/* Default 'User' jika nama kosong */}
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                      {/* Pastikan properti user ada sebelum diakses */}
                      {user.role && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {user.role}{" "}
                          {user.subscription_plan
                            ? `• ${user.subscription_plan}`
                            : ""}
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator /> {/* Separator untuk pemisah */}
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center gap-2">
                      <UserIcon className="w-4 h-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    disabled={loading || isPending}
                  >
                    {loading || isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="w-4 h-4 mr-2" />
                    )}
                    {loading || isPending ? "Signing out..." : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">{children}</div>
      </main>
    </div>
  );
}
