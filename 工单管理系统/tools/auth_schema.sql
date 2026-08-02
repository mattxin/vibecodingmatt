-- ============================================================
-- 工单管理系统 - 真实安全鉴权 数据库脚本
-- 在 Supabase Dashboard > SQL Editor 中整段执行
-- 作用：建 profiles 表(角色) + 触发器 + tickets 行级安全(RLS)
-- 幂等：可重复执行
-- ============================================================

-- ---------- 1. profiles 表：存角色与显示名 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'assignee',   -- assignee | admin
  name text not null default '',            -- 中文姓名，与 tickets.assignee 对齐
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 用户只能读自己的 profile（角色由系统写入，用户不可改）
drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles
  for select using (auth.uid() = id);

-- 公开读：归属处理人下拉框需要列出所有已注册用户。
-- 表里只有 id/email/role/name/created_at；id 与 email 在 auth.users 也能拿到，
-- 这一策略仅放开 select，不暴露写权限。
drop policy if exists "profiles public read" on public.profiles;
create policy "profiles public read" on public.profiles
  for select using (true);

-- ---------- 2. 触发器：新用户注册自动建 profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, name)
  values (
    new.id,
    new.email,
    'assignee',
    coalesce(new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 3. tickets 表行级安全(RLS) ----------
alter table public.tickets enable row level security;

-- 3.1 匿名只读（移动 H5 开放匿名查询）
drop policy if exists "tickets anon read" on public.tickets;
create policy "tickets anon read" on public.tickets
  for select to anon using (true);

-- 3.2 处理员：仅本人名下工单可增删改查
drop policy if exists "tickets owner select" on public.tickets;
create policy "tickets owner select" on public.tickets
  for select to authenticated
  using (assignee = (select name from public.profiles where id = auth.uid()));

drop policy if exists "tickets owner insert" on public.tickets;
create policy "tickets owner insert" on public.tickets
  for insert to authenticated
  with check (assignee = (select name from public.profiles where id = auth.uid()));

drop policy if exists "tickets owner update" on public.tickets;
create policy "tickets owner update" on public.tickets
  for update to authenticated
  using (assignee = (select name from public.profiles where id = auth.uid()))
  with check (assignee = (select name from public.profiles where id = auth.uid()));

drop policy if exists "tickets owner delete" on public.tickets;
create policy "tickets owner delete" on public.tickets
  for delete to authenticated
  using (assignee = (select name from public.profiles where id = auth.uid()));

-- 3.3 管理员：全部工单可增删改查
drop policy if exists "tickets admin all" on public.tickets;
create policy "tickets admin all" on public.tickets
  for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- 执行完后告知我，我会创建 6 个账号(admin + 5 处理员)。
-- admin 账号创建后，再执行下面这条提权 SQL（届时我会给具体 email）：
--   update public.profiles set role='admin' where email='admin@woms.cn';
-- ============================================================