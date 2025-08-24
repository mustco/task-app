//app/page.tsx
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import Image from "next/image"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen  flex items-center justify-center p-4">
      
      <div className="max-w-4xl mx-auto text-center flex flex-col items-center justify-center">
        <Image
          src="/listkuu.png"
          alt="ListKu Logo"
          width={150} // Coba nilai yang lebih besar, misal 100
          height={150} // Sesuaikan agar menjaga rasio aspek
          // Hapus className="h-8 w-auto" dari sini
          className="pointer-events-none text-5xl font-bold text-gray-900 mb-6"
        />
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Manage your tasks efficiently with automated reminders via WhatsApp
          and Email. Never miss a deadline again!
        </p>
        <div className="flex gap-4 justify-center">
          <Button asChild size="lg">
            <Link href="/login">Sign In</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/register">Get Started</Link>
          </Button>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-4">📋</div>
            <h3 className="text-lg font-semibold mb-2">Task Management</h3>
            <p className="text-gray-600">
              Create, edit, and organize your tasks with an intuitive interface
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-4">⏰</div>
            <h3 className="text-lg font-semibold mb-2">Smart Reminders</h3>
            <p className="text-gray-600">
              Get notified via WhatsApp and Email before deadlines
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="text-3xl mb-4">📊</div>
            <h3 className="text-lg font-semibold mb-2">Progress Tracking</h3>
            <p className="text-gray-600">
              Monitor your productivity and task completion rates
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
