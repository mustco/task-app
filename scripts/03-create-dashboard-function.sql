-- scripts/03-create-dashboard-function.sql

-- Fungsi ini akan mengambil semua data yang diperlukan untuk dasbor dalam satu panggilan.
create or replace function get_dashboard_data()
returns json as $$
declare
  current_user_id uuid := auth.uid();
  user_profile json;
  tasks_list json;
  total_tasks_count int;
  pending_tasks_count int;
  in_progress_tasks_count int;
  completed_tasks_count int;
begin
  -- 1. Ambil profil pengguna
  select to_json(u.*) into user_profile
  from public.users u
  where u.id = current_user_id;

  -- 2. Ambil daftar tugas (20 terbaru)
  select json_agg(t.*) into tasks_list
  from (
    select id, user_id, title, description, deadline, status, remind_method, target_email, target_phone, reminder_days
    from public.tasks
    where user_id = current_user_id
    order by created_at desc
    limit 20
  ) t;

  -- 3. Hitung semua status tugas dalam satu query
  select
    count(*) as total,
    count(*) filter (where status = 'pending') as pending,
    count(*) filter (where status = 'in_progress') as in_progress,
    count(*) filter (where status = 'completed') as completed
  into
    total_tasks_count,
    pending_tasks_count,
    in_progress_tasks_count,
    completed_tasks_count
  from public.tasks
  where user_id = current_user_id;

  -- 4. Kembalikan semua data sebagai satu objek JSON
  return json_build_object(
    'userProfile', user_profile,
    'tasks', tasks_list,
    'totalTasks', total_tasks_count,
    'pendingTasks', pending_tasks_count,
    'inProgressTasks', in_progress_tasks_count,
    'completedTasks', completed_tasks_count
  );
end;
$$ language plpgsql security definer;