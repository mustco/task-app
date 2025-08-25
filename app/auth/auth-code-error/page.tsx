import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function AuthCodeErrorPage() {
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
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Kesalahan Autentikasi</h2>
                <p className="text-sm text-muted-foreground">
                  Terjadi masalah dengan tautan autentikasi Anda. Hal ini bisa terjadi jika:
                </p>
                <ul className="text-xs text-muted-foreground text-left space-y-1 mt-4">
                  <li>• Tautan telah kedaluwarsa</li>
                  <li>• Tautan sudah pernah digunakan</li>
                  <li>• Tautan tidak valid atau rusak</li>
                </ul>
              </div>

              <div className="space-y-3 mt-6">
                <Button asChild className="w-full">
                  <Link href="/forgot-password">
                    Minta tautan reset baru
                  </Link>
                </Button>
                
                <Button asChild variant="outline" className="w-full">
                  <Link href="/login">
                    Kembali ke login
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