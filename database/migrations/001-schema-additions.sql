-- ============================================
-- 1. Whitelist of valid students (populate this yourself once you have
--    the official list from your class - reg number + full name)
-- ============================================
create table allowed_students (
  id uuid primary key default gen_random_uuid(),
  reg_number text unique not null,
  full_name text not null,
  used boolean default false,   -- flips to true once that reg number signs up
  created_at timestamp with time zone default now()
);

alter table allowed_students enable row level security;
-- Deliberately NO public select policy - nobody can read this table directly
-- from the frontend. It's only accessed through the two functions below,
-- which check specific values without exposing the full list.


-- ============================================
-- 2. Function: check if a reg number is on the allowed list and not yet used
--    (used during signup, before creating the account)
-- ============================================
create or replace function check_student_eligibility(
  p_reg_number text
) returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from allowed_students
    where reg_number = p_reg_number
    and used = false
  );
$$;

grant execute on function check_student_eligibility(text) to anon;


-- ============================================
-- 3. Function: look up an account's email by reg number
--    (used during login, since login only asks for reg number + password)
-- ============================================
create or replace function get_email_by_reg_number(
  p_reg_number text
) returns text
language sql
security definer
set search_path = public
as $$
  select email from users where reg_number = p_reg_number limit 1;
$$;

grant execute on function get_email_by_reg_number(text) to anon;


-- ============================================
-- 4. Trigger: automatically create the public.users row once someone
--    confirms their email, using the full_name/reg_number they submitted
--    at signup (stored temporarily in Supabase Auth's own metadata).
--    Also marks their reg number as "used" in allowed_students.
-- ============================================
create or replace function handle_new_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then

    -- Full name comes from the whitelist (matched by reg_number), never
    -- typed by the user - avoids typo mismatches and duplicate entry.
    select full_name into v_full_name
    from allowed_students
    where reg_number = new.raw_user_meta_data->>'reg_number';

    insert into public.users (id, full_name, username, reg_number, email, email_verified, level)
    values (
      new.id,
      v_full_name,
      new.raw_user_meta_data->>'username',
      new.raw_user_meta_data->>'reg_number',
      new.email,
      true,
      new.raw_user_meta_data->>'level'
    );

    update allowed_students
    set used = true
    where reg_number = new.raw_user_meta_data->>'reg_number';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  execute function handle_new_confirmed_user();


-- ============================================
-- 5. Add optional, non-unique username column to users
--    (reg_number remains the actual unique identifier - username is purely
--    a display/personalization field, can be blank, can be changed later,
--    two students can share the same one)
-- ============================================
alter table users add column if not exists username text;
