create or replace function reset_test_signup(p_reg_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from public.users where reg_number = p_reg_number;

  if v_email is not null then
    delete from auth.users where email = v_email;
  end if;

  delete from public.users where reg_number = p_reg_number;
  update allowed_students set used = false where reg_number = p_reg_number;
  delete from signup_log where reg_number = p_reg_number;
end;
$$;

-- Deliberately NOT granted to anon/authenticated - this is a destructive
-- dev-only tool. It should only ever be called by you directly in the
-- SQL Editor (which runs with full privileges), never from the app itself.