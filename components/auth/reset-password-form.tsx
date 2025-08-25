"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Eye, EyeOff, AlertCircle } from "lucide-react";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Check if user has a valid session from the reset link
    const checkSession = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) {
          setIsValidSession(false);
          // Redirect to forgot password page if no valid session
          router.push("/forgot-password");
        } else {
          setIsValidSession(true);
        }
      } catch {
        setIsValidSession(false);
        router.push("/forgot-password");
      }
    };

    checkSession();
  }, [router, supabase.auth]);

  // Show loading state while checking session
  if (isValidSession === null) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center animate-pulse">
          <AlertCircle className="h-6 w-6 text-gray-400" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Memverifikasi tautan reset...</h3>
          <p className="text-sm text-muted-foreground">
            Harap tunggu saat kami memverifikasi tautan reset kata sandi Anda.
          </p>
        </div>
      </div>
    );
  }

  // Don't render the form if session is invalid
  if (isValidSession === false) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Kata sandi tidak cocok",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "Kata sandi harus minimal 6 karakter",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setResetSuccess(true);
        toast({
          title: "Berhasil",
          description: "Kata sandi Anda telah berhasil diperbarui!",
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Terjadi kesalahan yang tidak terduga",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (resetSuccess) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Kata sandi diperbarui!</h3>
          <p className="text-sm text-muted-foreground">
            Kata sandi Anda telah berhasil diperbarui. Anda sekarang dapat masuk dengan kata sandi baru.
          </p>
        </div>
        <Button 
          onClick={() => router.push("/login")} 
          className="w-full"
        >
          Lanjutkan ke login
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold">Reset kata sandi Anda</h2>
        <p className="text-sm text-muted-foreground">
          Masukkan kata sandi baru Anda di bawah ini untuk menyelesaikan proses reset.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Kata Sandi Baru</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="pr-10"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center pr-3"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
          {password && password.length < 6 && (
            <p className="text-xs text-red-500">
              Kata sandi harus minimal 6 karakter
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Konfirmasi Kata Sandi Baru</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              className="pr-10"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center pr-3"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              {showConfirmPassword ? (
                <EyeOff className="h-4 w-4 text-gray-400" />
              ) : (
                <Eye className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
          {confirmPassword && password !== confirmPassword && (
            <p className="text-xs text-red-500">
              Kata sandi tidak cocok
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={
            loading || 
            !password.trim() || 
            !confirmPassword.trim() || 
            password !== confirmPassword ||
            password.length < 6
          }
        >
          {loading ? "Memperbarui kata sandi..." : "Perbarui kata sandi"}
        </Button>
      </form>

      <div className="text-center">
        <Link 
          href="/login" 
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Kembali ke login
        </Link>
      </div>
    </div>
  );
}