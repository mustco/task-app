export interface User {
  id: string;
  email: string;
  name?: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  subscription_plan: "free" | "premium";
  subscription_status: "active" | "cancelled" | "expired";
  subscription_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  deadline?: string;
  status: "pending" | "in_progress" | "completed";
  remind_method?: "whatsapp" | "email" | "both";
  target_contact?: string;
  remind_days_before: number;
  created_at: string;
  updated_at: string;
}

export interface ErrorLog {
  id: string;
  user_id: string;
  task_id: string;
  method: string;
  error_message: string;
  timestamp: string;
}
