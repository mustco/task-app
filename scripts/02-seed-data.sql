-- Insert sample admin user (you'll need to register this user first through the app)
-- Then update their role to admin
-- UPDATE public.users SET role = 'admin' WHERE email = 'admin@example.com';

-- Insert sample tasks for testing
-- This will only work after you have registered users
INSERT INTO public.tasks (user_id, title, description, deadline, status, remind_method, target_contact, remind_days_before) VALUES
-- Replace 'user-uuid-here' with actual user IDs from your users table
-- ('user-uuid-here', 'Complete project proposal', 'Write and submit the Q4 project proposal', '2024-02-15 17:00:00+00', 'pending', 'email', 'user@example.com', 2),
-- ('user-uuid-here', 'Team meeting preparation', 'Prepare slides for weekly team meeting', '2024-02-10 09:00:00+00', 'in_progress', 'whatsapp', '+1234567890', 1),
-- ('user-uuid-here', 'Code review', 'Review pull requests from team members', '2024-02-12 15:00:00+00', 'pending', 'both', 'user@example.com', 1);

-- Note: To add sample data, first register users through the application,
-- then get their UUIDs from the users table and replace the placeholders above
