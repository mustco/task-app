// app/components/dashboard/dashboard-layout.tsx (UI-polish only)

"use client";

import type React from "react";
import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import Image from "next/image";
import type { User } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut, UserIcon, Shield, Loader2, BarChart3 } from "lucide-react";

interface DashboardLayoutProps {
  children: React.ReactNode;
  user: User | null;
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error)
        throw new Error(error.message || "Failed to sign out from Supabase.");

      startTransition(() => {
        router.push("/login");
        router.refresh();
      });

      toast({
        title: "Berhasil",
        description: "Anda telah berhasil keluar.",
      });
    } catch (error: any) {
      toast({
        title: "Gagal Keluar",
        description:
          error.message || "Terjadi kesalahan yang tidak terduga saat keluar.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Guard jika user null (tidak mengubah logic, hanya tetap ada)
  if (!user) {
    useEffect(() => {
      router.push("/login");
      router.refresh();
    }, [router]);
    return null;
  }

  return (
    <div className="relative min-h-screen">
      {/* Background grid + glow */}
      {/* <div className="pointer-events-none absolute inset-0 -z-10 bg-background">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f20_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f20_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_95%_70%_at_50%_-10%,#000_60%,transparent_100%)]" />
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(70%_50%_at_50%_-10%,hsl(var(--glow-start)/0.10),transparent_60%)]" />
      </div> */}

      {/* Sticky Nav */}
      <nav className="sticky top-0 z-40 w-full border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Left: logo + nav links */}
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center">
              <Image
                src="/listkuu.png"
                alt="ListKu Logo"
                width={100}
                height={100}
                priority
                className="h-8 w-auto object-contain"
              />
            </Link>

            <div className="hidden md:flex md:items-center md:gap-1">
              {user.role === "admin" && (
                <>
                  <Link
                    href="/admin"
                    className="rounded-md px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Shield className="h-4 w-4" /> Admin
                    </span>
                  </Link>
                  <Link
                    href="/admin/statistics"
                    className="rounded-md px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 hover:text-gray-800"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <BarChart3 className="h-4 w-4" /> Statistics
                    </span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Right: user menu */}
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 rounded-full p-0"
                  disabled={loading || isPending}
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-sm">
                      {(
                        user.name?.charAt(0) ||
                        user.email?.charAt(0) ||
                        "U"
                      ).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                className="w-60"
                align="end"
                sideOffset={8}
                forceMount
              >
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <p className="font-medium leading-tight">
                      {user.name || "User"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
                    {user.role && (
                      <p className="text-xs text-muted-foreground capitalize">
                        {user.role}
                        {user.subscription_plan
                          ? ` • ${user.subscription_plan}`
                          : ""}
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4" />
                    Profil
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  disabled={loading || isPending}
                >
                  {loading || isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  {loading || isPending ? "Sedang keluar..." : "Keluar"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* <div className="rounded-2xl border bg-white/70 p-4 shadow-sm backdrop-blur sm:p-6"> */}
          {children}
      </main>
    </div>
  );
}
