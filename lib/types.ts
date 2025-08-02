// lib/types.ts

// Existing User Interface
export interface User {
  id: string;
  email: string;
  phone_number?: string | null; // Mark as nullable because it might be null in DB
  name?: string | null; // Mark as nullable because it might be null in DB
  role: "user" | "admin";
  status: "active" | "suspended";
  // Add other user properties from your DB here, marked as optional/nullable as needed
  // subscription_plan?: "free" | "premium" | null;
  // subscription_status?: "active" | "cancelled" | "expired" | null;
  // subscription_expires_at?: string | null;
  // created_at?: string; // Add if you select it
  // updated_at?: string; // Add if you select it
}

// New Interface for User Profile when JOINED with Tasks
// This reflects the shape of the 'users' object when selected via a join (e.g., tasks().select('users(id, name, email, ...)'))
export interface JoinedUserProfile {
  id: string; // If you select 'id' in the join
  name: string | null;
  email: string;
  phone_number?: string | null;
  // Include other user properties that you SELECT in your join here
  // For example, if you select 'users(name, email, phone_number)', then these fields are available.
}

// Existing Task Interface
export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  deadline: string | null;
  status: "pending" | "in_progress" | "completed" | "overdue";
  remind_method: "whatsapp" | "email" | "both" | null;
  // target_contact: string | null;
  target_email: string | null; // <<< GANTI DENGAN INI
  target_phone: string | null; // <<< DAN TAMBAHKAN INI
  reminder_days: number | null;
  // Add other task properties from your DB here
  // created_at?: string; // Add if you select it
  // updated_at?: string; // Add if you select it
  trigger_handle_id?: string | null; // Add this if it's part of your Task interface in DB
}

// Interface for Task when JOINED with User details
// This is used for API routes that fetch task with joined user info.
export interface TaskWithUser extends Task {
  // 'users' will be an array because that's how Supabase client returns joined data,
  // even if it's a one-to-one relationship.
  users: JoinedUserProfile[] | null; // <<< Use the new JoinedUserProfile[]
}

// Existing ErrorLog Interface
export interface ErrorLog {
  id: string;
  user_id: string;
  task_id: string;
  method: string;
  error_message: string;
  timestamp: string;
}
