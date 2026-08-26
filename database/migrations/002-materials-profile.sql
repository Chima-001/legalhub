-- ============================================
-- 1. Admin flag on users (you'll manually set this true for yourself)
-- ============================================
alter table users add column if not exists is_admin boolean default false;

-- Run this once, replacing with your own reg number, to make yourself admin:
-- update users set is_admin = true where reg_number = 'YOUR_REG_NUMBER';


-- ============================================
-- 2. Helper function - checks admin status WITHOUT being blocked by RLS
--    (needed because policies below need to check `users`, which itself
--    has RLS - a plain subquery would get silently blocked otherwise)
-- ============================================
create or replace function is_admin(check_uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from users where id = check_uid), false);
$$;


-- ============================================
-- 3. Give users access to their OWN row (needed for profile page - this
--    was missing before, users table had zero select/update policies)
-- ============================================
create policy "Users can read own row"
  on users for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update own row"
  on users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level lock: even though the row-level policy above allows
-- updates to their own row, this restricts WHICH columns they can
-- actually change via direct table update - username only. reg_number,
-- full_name, is_admin etc. stay untouchable this way even if someone
-- tries to update() them directly from the browser console.
revoke update on users from authenticated;
grant update (username) on users to authenticated;


-- ============================================
-- 4. Materials table (course PDFs, admin-approved before going public)
-- ============================================
create table materials (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  course text,
  status text default 'pending', -- 'pending' | 'approved' | 'rejected'
  storage_path text,             -- path inside the 'materials' Supabase Storage bucket
  uploaded_by uuid references users(id),
  uploaded_at timestamp with time zone default now()
);

alter table materials enable row level security;

create policy "Public can read approved materials"
  on materials for select
  using (status = 'approved');

create policy "Admins can read all materials"
  on materials for select
  using (is_admin(auth.uid()));

create policy "Authenticated users can upload (as pending)"
  on materials for insert
  to authenticated
  with check (auth.uid() = uploaded_by and status = 'pending');

create policy "Admins can update materials"
  on materials for update
  using (is_admin(auth.uid()));

create policy "Admins can delete materials"
  on materials for delete
  using (is_admin(auth.uid()));


-- ============================================
-- 5. Storage bucket + policies for the actual PDF files
--    (create the bucket itself in the Supabase dashboard first:
--     Storage > New bucket > name it exactly "materials", keep it PRIVATE)
-- ============================================
create or replace function is_material_approved(object_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from materials
    where storage_path = object_name and status = 'approved'
  );
$$;

create policy "Authenticated users can upload material files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'materials');

create policy "Anyone can view approved material files"
  on storage.objects for select
  using (bucket_id = 'materials' and is_material_approved(name));

create policy "Admins can view all material files"
  on storage.objects for select
  using (bucket_id = 'materials' and is_admin(auth.uid()));


-- ============================================
-- 6. Keep users.email in sync when someone changes their email via
--    Supabase Auth (mirrors the same pattern as the signup confirmation
--    trigger - fires when auth.users.email actually changes and is
--    reconfirmed)
-- ============================================
create or replace function handle_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email <> old.email and new.email_confirmed_at is not null then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update on auth.users
  for each row
  execute function handle_email_change();
