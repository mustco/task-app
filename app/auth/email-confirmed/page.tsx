import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

export default function EmailConfirmedPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-background" />
      <div className="pointer-events-none absolute -inset-20 -z-10 blobs">
        <div className="absolute left-[10%] top-[15%] h-64 w-64 rounded-full bg-fuchsia-500/25 animate-blob" />
        <div className="absolute right-[15%] top-[10%] h-72 w-72 rounded-full bg-sky-400/25 animate-blob [animation-delay:4s]" />
        <div className="absolute left-[20%] bottom-[10%] h-80 w-80 rounded-full bg-emerald-400/20 animate-blob [animation-delay:8s]" />
      </div>

      {/* Container */}
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-10">
        <Card className="w-full overflow-hidden shadow-xl rounded-2xl border bg-white/70 p-4 backdrop-blur sm:p-6 md:max-w-md md:mx-auto">
          {/* Header */}
          <div className="p-6 sm:p-8">
            <div className="mb-8 flex items-center justify-center">
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src="/listkuu.png"
                  alt="ListKu Logo"
                  width={44}
                  height={44}
                  className="h-10 w-auto rounded-md object-contain"
                  priority
                />
              </Link>
            </div>

            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Email Berhasil Dikonfirmasi!</h2>
                <p className="text-sm text-muted-foreground">
                  Selamat! Akun Anda telah berhasil dibuat dan email telah dikonfirmasi.
                </p>
                <p className="text-xs text-muted-foreground">
                  Anda sekarang dapat masuk ke akun Anda dan mulai menggunakan ListKu untuk mengelola tugas-tugas Anda.
                </p>
              </div>

              <div className="space-y-3 mt-6">
                <Button asChild className="w-full">
                  <Link href="/login">
                    Masuk ke Akun Anda
                  </Link>
                </Button>
                
                <Button asChild variant="outline" className="w-full">
                  <Link href="/">
                    Kembali ke Beranda
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}