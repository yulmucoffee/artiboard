-- A project's own board page, when an admin has customised it. The server serves it in place of the
-- bundled page; deleting the row goes back to the bundled one. Only the server reads or writes it.

create table public.ab_pages (
  project    text primary key references public.ab_projects (id) on delete cascade,
  html       text not null check (length(html) <= 1048576),
  version    bigint not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.ab_pages enable row level security;
revoke all on public.ab_pages from anon, authenticated;

-- p_if_version is the version the caller read (0 when the project had no page of its own)
create function public.ab_set_page(p_actor uuid, p_project text, p_html text, p_if_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare cur bigint; v bigint;
begin
  if p_actor is not null and public.ab_role(p_actor) is distinct from 'admin' then
    raise exception 'ab:permission_denied:0:only admins change a board page';
  end if;
  perform public.ab_check_project(p_project);
  select version into cur from public.ab_pages where project = p_project for update;
  if p_if_version is not null and coalesce(cur, 0) <> p_if_version then
    raise exception 'ab:version_conflict:0:the page is at version %, not %', coalesce(cur, 0), p_if_version;
  end if;
  v := coalesce(cur, 0) + 1;
  insert into public.ab_pages (project, html, version, updated_by) values (p_project, p_html, v, p_actor)
  on conflict (project) do update set html = excluded.html, version = excluded.version, updated_at = now(), updated_by = excluded.updated_by;
  return v;
end $$;

revoke all on function public.ab_set_page(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.ab_set_page(uuid, text, text, bigint) to service_role;
