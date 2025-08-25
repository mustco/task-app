import { LoginForm } from "@/components/auth/login-form";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-background" />
      <div className="pointer-events-none absolute -inset-20 -z-10 blobs">
        <div className="absolute left-[10%] top-[15%] h-64 w-64 rounded-full bg-fuchsia-500/25 animate-blob" />
        <div className="absolute left-[50%] top-[55%] h-64 w-64 rounded-full bg-fuchsia-500/25 animate-blob" />
        <div className="absolute right-[15%] top-[10%] h-72 w-72 rounded-full bg-sky-400/25 animate-blob [animation-delay:4s]" />
        <div className="absolute left-[20%] bottom-[10%] h-80 w-80 rounded-full bg-emerald-400/20 animate-blob [animation-delay:8s]" />
      </div>

      {/* Container */}
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-10">
        <Card className="w-full overflow-hidden shadow-xl md:grid md:grid-cols-2 md:rounded-2xl rounded-2xl border bg-white/70 p-4  backdrop-blur sm:p-6">
          {/* Left pane */}
          <div className="relative hidden items-center justify-center p-10 md:flex">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,hsl(var(--primary)/0.15),transparent)]" />
            <div className="relative z-10 space-y-6">
              <div className="flex items-center gap-3">
                <Image
                  src="/listkuu.png"
                  alt="ListKu Logo"
                  width={44}
                  height={44}
                  className="h-10 w-auto rounded-md object-contain"
                  priority
                />
             
              </div>
              <h2 className="text-3xl font-bold leading-tight">
                Selamat datang kembali 👋
              </h2>
              <p className="text-sm text-muted-foreground">
                Masuk untuk melihat tugas, pengingat, dan progres harian Anda.
              </p>
              <div className="text-sm text-muted-foreground/80">
                Baru di ListKu?{" "}
                <Link
                  href="/register"
                  className="font-medium text-primary hover:underline"
                >
                  Buat akun baru
                </Link>
              </div>
            </div>
          </div>

          {/* Right pane / form */}
          <div className="p-6 sm:p-8 md:p-10">
            <div className="mb-8 flex items-center justify-center md:hidden">
              <Image
                src="/listkuu.png"
                alt="ListKu Logo"
                width={150}
                height={150}
                priority
                className="h-10 w-auto object-contain"
              />
            </div>

            <div className="mb-6 text-center md:text-left">
              <h1 className="text-2xl font-bold tracking-tight">
                Masuk ke akun Anda
              </h1>
              <p className="mt-2 text-sm text-muted-foreground md:hidden">
                Atau{" "}
                <Link
                  href="/register"
                  className="font-medium text-primary/80 transition-colors hover:text-primary"
                >
                  buat akun baru
                </Link>
              </p>
            </div>

            <LoginForm />
          </div>
        </Card>
      </div>
    </div>
  );
}
