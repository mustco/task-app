"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
} from "@/components/ui/alert-dialog"

interface UserManagementProps {
  users: User[]
}

export function UserManagement({ users: initialUsers }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [loading, setLoading] = useState<string | null>(null)
  const { toast } = useToast()
  const supabase = createClient()

  const updateUserStatus = async (userId: string, status: "active" | "suspended") => {
    setLoading(userId)
    try {
      const { error } = await supabase.from("users").update({ status }).eq("id", userId)

      if (error) throw error

      setUsers((prev) => prev.map((user) => (user.id === userId ? { ...user, status } : user)))

      toast({
        title: "Success",
        description: `User ${status === "suspended" ? "suspended" : "activated"} successfully`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update user status",
        variant: "destructive",
      })
    } finally {
      setLoading(null)
    }
  }

  const getStatusBadge = (status: string) => {
    return status === "active" ? (
      <Badge className="bg-green-100 text-green-800">Active</Badge>
    ) : (
      <Badge className="bg-red-100 text-red-800">Suspended</Badge>
    )
  }

  const getRoleBadge = (role: string) => {
    return role === "admin" ? (
      <Badge className="bg-purple-100 text-purple-800">Admin</Badge>
    ) : (
      <Badge className="bg-blue-100 text-blue-800">User</Badge>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">User Management</h2>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{getRoleBadge(user.role)}</TableCell>
                <TableCell>{getStatusBadge(user.status)}</TableCell>
                <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {user.role !== "admin" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant={user.status === "active" ? "destructive" : "default"}
                          size="sm"
                          disabled={loading === user.id}
                        >
                          {loading === user.id ? "Processing..." : user.status === "active" ? "Suspend" : "Activate"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {user.status === "active" ? "Suspend User" : "Activate User"}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to {user.status === "active" ? "suspend" : "activate"} {user.email}?
                            {user.status === "active" && " This will prevent them from accessing the application."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => updateUserStatus(user.id, user.status === "active" ? "suspended" : "active")}
                          >
                            {user.status === "active" ? "Suspend" : "Activate"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
