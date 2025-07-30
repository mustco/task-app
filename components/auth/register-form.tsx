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
        phone: phone || undefined,
        options: {
          data: {
            name: name,
            phone_number: phone || null,
          },
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
            "Account created successfully! Please check your email to verify your account.",
        });
        router.push("/login");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 !border !border-gray-300 !bg-white !text-black 
              focus:!border-gray-500 focus:!ring-0 
              !ring-0 !ring-offset-0 !shadow-none 
              !outline-none !rounded-md 
              placeholder:text-gray-400"
          />
        </div>
        <div>
          <Label htmlFor="name">Full Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 !border !border-gray-300 !bg-white !text-black 
              focus:!border-gray-500 focus:!ring-0 
              !ring-0 !ring-offset-0 !shadow-none 
              !outline-none !rounded-md 
              placeholder:text-gray-400 "
          />
        </div>
        <div>
          <Label htmlFor="phone">Phone Number (Optional)</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 !border !border-gray-300 !bg-white !text-black 
              focus:!border-gray-500 focus:!ring-0 
              !ring-0 !ring-offset-0 !shadow-none 
              !outline-none !rounded-md 
              placeholder:text-gray-400 "
            placeholder="e.g., 081234567890"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 !border !border-gray-300 !bg-white !text-black 
              focus:!border-gray-500 focus:!ring-0 
              !ring-0 !ring-offset-0 !shadow-none 
              !outline-none !rounded-md 
              placeholder:text-gray-400 "
          />
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 !border !border-gray-300 !bg-white !text-black 
              focus:!border-gray-500 focus:!ring-0 
              !ring-0 !ring-offset-0 !shadow-none 
              !outline-none !rounded-md 
              placeholder:text-gray-400 "
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
