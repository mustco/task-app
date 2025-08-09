// app/api/admin/update-user-status/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server"; // Untuk mendapatkan sesi user admin
import { supabaseAdmin } from "@/lib/supabase/admin"; // Untuk update user lain (bypass RLS)
import { z } from "zod"; // Untuk validasi input

// Skema validasi input untuk API ini
const UpdateUserStatusSchema = z.object({
  userId: z.string().uuid("Invalid user ID format. Must be a UUID."),
  status: z.enum(["active", "suspended"], {
    errorMap: () => ({
      message: "Invalid status. Must be 'active' or 'suspended'.",
    }),
  }),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Validasi Input Payload
    const body = await request.json();
    const validationResult = UpdateUserStatusSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { userId, status } = validationResult.data;

    // 2. Autentikasi dan Otorisasi (Verifikasi bahwa yang melakukan request adalah ADMIN)
    const supabase = await createClient(); // Server-side client untuk autentikasi
    const {
      data: { user: adminUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !adminUser) {
      console.error("Authentication error for admin operation:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Periksa role user yang sedang login dari profil di database (disarankan)
    // Walaupun user.role ada di JWT, mengambil dari DB adalah konfirmasi yang lebih kuat.
    const { data: adminProfile, error: adminProfileError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", adminUser.id)
      .single();

    if (adminProfileError || adminProfile?.role !== "admin") {
      console.warn(
        `User ${adminUser.id} (${adminUser.email}) attempted admin operation without admin role.`
      );
      return NextResponse.json(
        { error: "Forbidden: Not an administrator." },
        { status: 403 }
      );
    }

    // 3. Ambil informasi user yang akan diubah statusnya
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from("users")
      .select("id, email, role, status")
      .eq("id", userId)
      .single();

    if (targetUserError || !targetUser) {
      console.error("Target user not found:", targetUserError);
      return NextResponse.json(
        { error: "Target user not found." },
        { status: 404 }
      );
    }

    // 4. Implementasi Aturan Bisnis Admin (Pencegahan Self-Modification / Modifikasi Admin Lain)
    // Admin tidak boleh mengubah status akunnya sendiri
    if (targetUser.id === adminUser.id) {
      return NextResponse.json(
        { error: "Forbidden: You cannot change your own status." },
        { status: 403 }
      );
    }

    // Admin tidak boleh mengubah status admin lain (opsional, tergantung kebijakan aplikasi Anda)
    // Jika Anda punya hirarki admin (Super Admin vs. Regular Admin) bisa lebih kompleks
    if (targetUser.role === "admin") {
      return NextResponse.json(
        {
          error:
            "Forbidden: Cannot change the status of another administrator.",
        },
        { status: 403 }
      );
    }

    // 5. Lakukan Update Status Menggunakan supabaseAdmin (dengan hak istimewa)
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ status })
      .eq("id", userId);

    if (updateError) {
      console.error(`Error updating status for user ${userId}:`, updateError);
      throw new Error("Failed to update user status in database.");
    }

    return NextResponse.json({
      success: true,
      message: `User ${targetUser.email} status updated to ${status}.`,
      userId: userId,
      newStatus: status,
    });
  } catch (error: any) {
    console.error("Error in admin update user status API:", error);
    return NextResponse.json(
      { error: "Failed to process user status update", details: error.message },
      { status: 500 }
    );
  }
}
