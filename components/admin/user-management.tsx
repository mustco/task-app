// components/admin/user-management.tsx (SECURE & OPTIMIZED VERSION)
"use client";

import { useState, useEffect, useMemo, useCallback } from "react"; // Tambahkan useCallback, useMemo, useEffect
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react"; // Import Loader2
import { redirect } from "next/navigation"; // Untuk redirect di client-side jika bukan admin
import { useRouter } from "next/navigation"; // Untuk refresh

// Pastikan interface User Anda mencerminkan skema database users Anda
// user.role dan user.status harus ada di sini.
interface User {
  id: string;
  email: string;
  name: string | null; // Bisa null
  role: "user" | "admin"; // Tentukan enum roles
  status: "active" | "suspended"; // Tentukan enum status
  created_at: string;
  // Tambahkan properti lain yang mungkin ada di tabel users Supabase Anda
  // Misalnya: subscription_plan?: string;
}

interface UserManagementProps {
  users: User[]; // Initial users passed from Server Component
  currentUserRole: User['role']; // Role dari user yang sedang login (penting untuk otorisasi)
  currentUserId: string; // ID dari user yang sedang login (penting untuk otorisasi)
}

export function UserManagement({ users: initialUsers, currentUserRole, currentUserId }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null); // State lebih spesifik
  const { toast } = useToast();
  const supabase = createClient(); // Client-side Supabase client
  const router = useRouter();

  // KEAMANAN KRITIS: Client-side Role Check
  // Meskipun page.tsx sudah memastikan ini, ini adalah lapisan jaga-jaga di client.
  useEffect(() => {
    if (currentUserRole !== 'admin') {
      console.warn("Non-admin user attempted to access UserManagement component. Redirecting.");
      toast({
        title: "Access Denied",
        description: "You do not have administrative privileges to access this page.",
        variant: "destructive",
      });
      router.push("/dashboard"); // Redirect ke dashboard atau halaman lain yang sesuai
      router.refresh();
    }
  }, [currentUserRole, router, toast]);


  // Menggunakan useCallback untuk memoize fungsi agar tidak dibuat ulang di setiap render
  const updateUserStatus = useCallback(async (
    userId: string,
    status: "active" | "suspended"
  ) => {
    // KEAMANAN KRITIS: Mencegah admin mengubah dirinya sendiri atau admin lain (opsional tapi disarankan)
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
        toast({ title: "Error", description: "User not found in list.", variant: "destructive" });
        return;
    }
    
    // Admin tidak boleh mengubah dirinya sendiri
    if (userId === currentUserId) {
        toast({ title: "Action Forbidden", description: "You cannot change your own status.", variant: "destructive" });
        return;
    }

    // Admin tidak boleh mengubah status admin lain (jika hanya ada 1 super admin atau ingin mencegah konflik)
    if (targetUser.role === 'admin' && currentUserRole === 'admin') {
        toast({ title: "Action Forbidden", description: "You cannot change the status of another admin.", variant: "destructive" });
        return;
    }

    setLoadingUserId(userId);
    try {
      // PENTING: Panggil API route di sisi server untuk operasi ini
      // JANGAN LANGSUNG supabase.from('users').update() dari client.
      // Ini adalah operasi admin yang membutuhkan hak istimewa khusus.
      const response = await fetch('/api/admin/update-user-status', {
        method: 'POST', // Atau PATCH
        headers: {
          'Content-Type': 'application/json',
          // Next.js secara otomatis akan mengirim cookies autentikasi
          // yang akan digunakan oleh `createClient()` di API route server.
        },
        body: JSON.stringify({ userId, status }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to update user status: ${response.statusText}`);
      }

      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, status } : user))
      );

      toast({
        title: "Success",
        description: `User ${status === "suspended" ? "suspended" : "activated"} successfully.`,
      });
    } catch (error: any) {
      console.error("Error updating user status:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update user status.",
        variant: "destructive",
      });
    } finally {
      setLoadingUserId(null);
    }
  }, [users, currentUserId, currentUserRole, toast]); // Dependensi untuk useCallback

  // Memoize badge functions
  const getStatusBadge = useCallback((status: string) => {
    return status === "active" ? (
      <Badge className="bg-green-100 text-green-800 whitespace-nowrap">Active</Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800 whitespace-nowrap">Suspended</Badge>
    );
  }, []);

  const getRoleBadge = useCallback((role: string) => {
    return role === "admin" ? (
      <Badge className="bg-purple-100 text-purple-800 whitespace-nowrap">Admin</Badge>
    ) : (
      <Badge className="bg-blue-100 text-blue-800 whitespace-nowrap">User</Badge>
    );
  }, []);

  // Memoize formatted date to prevent re-computation
  const formatCreatedAt = useCallback((dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", { // Pastikan locale konsisten
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
    } catch (e) {
      console.error("Invalid date string for created_at:", dateString, e);
      return "Invalid Date";
    }
  }, []);


  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">User Management</h2>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="whitespace-nowrap">Created At</TableHead> {/* Perbaiki label */}
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        No users found.
                    </TableCell>
                </TableRow>
            ) : (
                users.map((user) => (
                    <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{user.name || "-"}</TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell>{formatCreatedAt(user.created_at)}</TableCell> {/* Gunakan fungsi memoized */}
                        <TableCell>
                            {/* KEAMANAN: Admin tidak boleh mengubah dirinya sendiri atau admin lain (di UI) */}
                            {user.id !== currentUserId && user.role !== "admin" && (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant={user.status === "active" ? "destructive" : "default"}
                                            size="sm"
                                            disabled={loadingUserId === user.id}
                                        >
                                            {loadingUserId === user.id ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                user.status === "active" ? "Suspend" : "Activate"
                                            )}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                {user.status === "active" ? "Suspend User" : "Activate User"}
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Are you sure you want to{" "}
                                                <span className="font-semibold">
                                                    {user.status === "active" ? "suspend" : "activate"}
                                                </span>{" "}
                                                user <span className="font-semibold">{user.email}</span>?
                                                {user.status === "active" &&
                                                    " This will prevent them from accessing the application."}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() =>
                                                    updateUserStatus(
                                                        user.id,
                                                        user.status === "active" ? "suspended" : "active"
                                                    )
                                                }
                                                disabled={loadingUserId === user.id} 
                                            >
                                                {loadingUserId === user.id ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    user.status === "active" ? "Confirm Suspend" : "Confirm Activate"
                                                )}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                            {/* Tampilkan pesan atau tombol disable jika user adalah admin atau diri sendiri */}
                            {(user.id === currentUserId || user.role === "admin") && user.id !== currentUserId && (
                                <Button variant="outline" size="sm" disabled>
                                    Cannot Modify
                                </Button>
                            )}
                            {user.id === currentUserId && (
                                <Button variant="outline" size="sm" disabled>
                                    Your Account
                                </Button>
                            )}
                        </TableCell>
                    </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}