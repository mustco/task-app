-- scripts/04-add-indexes.sql

-- Menambahkan indeks pada kolom user_id di tabel tasks
-- Ini akan secara drastis mempercepat query yang memfilter tugas berdasarkan pengguna
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);

-- Menambahkan indeks pada status untuk mempercepat filter (opsional tapi bagus)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
