//app/page.tsx
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import Image from "next/image"
import { getHomePageStatistics } from "@/lib/actions/statistics"

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  }

  // Get real statistics from database
  const stats = await getHomePageStatistics()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-72 h-72 bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
          <div className="absolute top-0 right-1/4 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-0 left-1/3 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="pt-20 pb-16 text-center lg:pt-32">
            {/* Logo */}
            <div className="mx-auto mb-8">
              <Image
                src="/listkuu.png"
                alt="ListKu Logo"
                width={120}
                height={120}
                className="mx-auto mb-8 drop-shadow-lg"
                priority
              />
            </div>

            {/* Main heading */}
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
              <span className="block">Kelola Tugas</span>
              <span className="block text-blue-600">Lebih Efisien</span>
            </h1>

            {/* Subtitle */}
            <p className="mt-6 max-w-lg mx-auto text-lg text-gray-600 sm:max-w-3xl sm:text-xl">
              Platform manajemen tugas modern dengan pengingat otomatis melalui WhatsApp dan Email. 
              Tingkatkan produktivitas dan jangan pernah melewatkan deadline lagi!
            </p>

            {/* CTA Buttons */}
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="text-lg px-8 py-3 h-auto">
                <Link href="/login">Masuk ke Akun</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="text-lg px-8 py-3 h-auto border-2">
                <Link href="/register">Mulai Gratis</Link>
              </Button>
            </div>

            {/* Trust indicators with real data */}
            <div className="mt-12">
              <p className="text-sm text-gray-500 mb-4">Dipercaya oleh pengguna setia kami</p>
              <div className="flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-8 opacity-60">
                <div className="flex items-center space-x-1">
                  <span className="text-yellow-400">⭐⭐⭐⭐⭐</span>
                  <span className="text-sm text-gray-600">{stats.rating}/5</span>
                </div>
                <div className="text-sm text-gray-600">
                  {stats.totalUsers > 0 ? (
                    stats.totalUsers === 1 ? "1 pengguna" :
                    stats.totalUsers < 10 ? `${stats.totalUsers} pengguna aktif` :
                    stats.totalUsers < 100 ? `${stats.totalUsers}+ pengguna aktif` :
                    `${Math.floor(stats.totalUsers / 100) * 100}+ pengguna aktif`
                  ) : "Bergabunglah sebagai pengguna pertama!"}
                </div>
                <div className="text-sm text-gray-600">{stats.uptime}% uptime</div>
              </div>
              {stats.totalUsers <= 10 && (
                <p className="text-xs text-gray-500 mt-2">
                  🚀 Platform baru yang terus berkembang
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              Fitur Unggulan
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Semua yang Anda butuhkan untuk mengelola tugas dengan efektif
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="relative group">
              <div className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-blue-200">
                <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center mb-6 group-hover:bg-blue-200 transition-colors">
                  <span className="text-3xl">📋</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Manajemen Tugas Intuitif
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Buat, edit, dan atur tugas dengan antarmuka yang mudah digunakan. 
                </p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="relative group">
              <div className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-purple-200">
                <div className="w-16 h-16 bg-purple-100 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-200 transition-colors">
                  <span className="text-3xl">⏰</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Pengingat Multi-Channel
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Dapatkan notifikasi melalui WhatsApp dan Email sebelum deadline. 
                  Atur pengingat sesuai preferensi Anda.
                </p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="relative group">
              <div className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-green-200">
                <div className="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center mb-6 group-hover:bg-green-200 transition-colors">
                  <span className="text-3xl">📊</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Analytics & Insights
                </h3>
                <p className="text-gray-600 leading-relaxed">
                  Pantau produktivitas dan analisis pola kerja Anda. 
                  Tingkatkan efisiensi dengan data yang actionable.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom CTA Section */}
      <div className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8">
          <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Siap meningkatkan produktivitas?
            </h3>
            <p className="mt-4 text-lg text-gray-600">
              Bergabunglah dengan ribuan pengguna yang sudah merasakan manfaatnya
            </p>
            <div className="mt-8">
              <Button asChild size="lg" className="text-lg px-8 py-3 h-auto">
                <Link href="/register">Mulai Sekarang - Gratis</Link>
              </Button>
              {stats.totalUsers > 0 && (
                <p className="text-sm text-gray-600 mt-4">
                  Bergabunglah dengan {stats.totalUsers} pengguna lainnya
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
