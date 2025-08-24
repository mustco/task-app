"use client";

import type React from "react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        // NOTE: Supabase email+password tidak memakai 'phone' sebagai field auth.
        options: {
          data: { name, phone_number: phone || null },
        },
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description:
            "Account created! Check your email to verify your account.",
        });
        router.push("/login");
      }
    } catch {
      toast({
        title: "Error",
        description: "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* name & email side-by-side on md+ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            placeholder="Your Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
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
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone Number (Optional)</Label>
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-muted-foreground select-none">
            +62
          </span>
          <Input
            id="contactNumber"
            name="contactNumber"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="813xxxxxxx"
            // 8–13 digit, tanpa 0/62 di depan
            pattern="^[1-9][0-9]{7,12}$"
            title="Masukkan 8–13 digit tanpa awalan 0 atau 62 (contoh: 813xxxxxxx)"
            maxLength={13}
            required
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
        <p className="text-xs text-muted-foreground">
          Tersimpan sebagai: {phone || "—"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </div>

      <Button
        type="submit"
        className="h-11 w-full text-base"
        disabled={loading}
      >
        {loading ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
