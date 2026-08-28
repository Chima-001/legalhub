-- Material metadata used to place uploads in the correct level and semester.
alter table users add column if not exists current_level text;

-- The profile and library use the manually corrected level when present,
-- otherwise they fall back to the level captured during signup.
create or replace function get_effective_level(p_uid uuid)
returns text
language sql
security definer
set search_path = public
as $$
	select coalesce(current_level, level)
	from users
	where id = p_uid;
$$;

grant execute on function get_effective_level(uuid) to authenticated;

alter table materials add column if not exists material_name text;
alter table materials add column if not exists level text;
alter table materials add column if not exists semester text;

-- Preserve existing uploads while the new metadata form is introduced.
update materials
set material_name = coalesce(material_name, nullif(regexp_replace(file_name, '\.[^.]+$', ''), ''))
where material_name is null;

-- Keep the existing course column for compatibility with older rows and code.
-- New uploads use material_name, level, semester, and course together.
