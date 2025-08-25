// app/suspended/page.tsx
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"

export default async function SuspendedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const handleSignOut = async () => {
    "use server"
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/login")
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6 text-center">
        <div className="text-6xl mb-4">🚫</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Akun Dibekukan</h1>
        <p className="text-gray-600 mb-6">
          Akun Anda telah dibekukan. Silakan hubungi administrator untuk informasi lebih lanjut.
        </p>
        <form action={handleSignOut}>
          <Button type="submit" className="w-full">
            Keluar
          </Button>
        </form>
      </div>
    </div>
  )
}
