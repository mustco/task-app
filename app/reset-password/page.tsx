import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";

export default function ResetPasswordPage() {
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
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-10">
        <Card className="w-full overflow-hidden shadow-xl rounded-2xl border bg-white/60 p-4 backdrop-blur sm:p-6 md:max-w-md md:mx-auto">
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

            <ResetPasswordForm />
          </div>
        </Card>
      </div>
    </div>
  );
}