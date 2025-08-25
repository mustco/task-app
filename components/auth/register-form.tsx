"use client";

import type React from "react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, ArrowLeft } from "lucide-react";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const supabase = createClient();

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://listku.my.id");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Kata sandi tidak cocok",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // Basic password strength validation
    if (password.length < 6) {
      toast({
        title: "Error",
        description: "Kata sandi harus minimal 6 karakter",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?type=signup`,
          data: { name, phone_number: phone || null },
        },
      });

      if (error) {
        // Handle specific error cases
        if (error.message.includes('already registered')) {
          toast({
            title: "Email Sudah Terdaftar",
            description: "Email ini sudah terdaftar. Silakan gunakan email lain atau masuk ke akun Anda.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        }
      } else {
        setIsEmailSent(true);
        toast({
          title: "Berhasil!",
          description: "Akun berhasil dibuat! Periksa email Anda untuk mengonfirmasi akun.",
          duration: 6000,
        });
      }
    } catch {
      toast({
        title: "Error",
        description: "Terjadi kesalahan yang tidak terduga. Silakan coba lagi.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // If email verification has been sent, show confirmation message
  if (isEmailSent) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <Mail className="h-8 w-8 text-green-600" />
        </div>
        
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Periksa Email Anda</h3>
          <p className="text-sm text-muted-foreground">
            Kami telah mengirim tautan konfirmasi ke <strong>{email}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Klik tautan di email untuk mengaktifkan akun Anda. Jika tidak ada di kotak masuk, 
            periksa folder spam.
          </p>
        </div>
        
        <div className="space-y-3">
          <Button 
            onClick={() => {
              setIsEmailSent(false);
              setEmail("");
              setPassword("");
              setConfirmPassword("");
              setName("");
              setPhone("");
            }}
            variant="outline" 
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Coba Email Lain
          </Button>
          
          <p className="text-xs text-muted-foreground">
            Sudah mengonfirmasi email?{" "}
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="font-medium text-primary hover:underline"
            >
              Masuk sekarang
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* name & email side-by-side on md+ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Nama Lengkap</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            placeholder="Nama Anda"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Alamat email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="nama@contoh.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      {/* <div className="space-y-2">
        <Label htmlFor="phone">Phone Number (Optional)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g., 081234567890"
        />
      </div> */}

      <div className="space-y-2">
        <Label htmlFor="phone">Nomor Telepon (Opsional)</Label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground select-none">
            +62
          </span>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="813xxxxxxx"
            // 8–13 digit, tanpa 0/62 di depan
            pattern="^[1-9][0-9]{7,12}$"
            title="Masukkan 8–13 digit tanpa awalan 0 atau 62 (contoh: 813xxxxxxx)"
            maxLength={13}
            className="pl-12" // penting: kasih ruang untuk prefix
            value={
              // tampilkan hanya digit lokal setelah +62 (opsional, jika kamu simpan full di state `phone`)
              phone.replace(/^(\+?62|0)/, "")
            }
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              // Simpan ke state global sebagai E.164: +62 + digits
              // (kalau kamu mau tetap pakai state `phone`)
              // contoh: 813xxxxxxx -> +62813xxxxxxx
              const full = digits ? `+62${digits}` : "";
              setPhone(full);
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">Kata Sandi</Label>
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Konfirmasi Kata Sandi</Label>
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
        </div>
      </div>

      <Button
        type="submit"
        className="h-11 w-full text-base"
        disabled={loading}
      >
        {loading ? "Membuat akun..." : "Buat akun"}
      </Button>
    </form>
  );
}
