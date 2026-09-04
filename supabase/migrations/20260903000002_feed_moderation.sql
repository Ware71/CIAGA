-- Moderation: give reports a lifecycle, and record what was done about them.
--
-- feed_reports has existed since the first schema dump and works — but it is
-- write-only. There is no status, so a report can't be triaged; no resolution,
-- so nothing records the outcome; and no uniqueness, so one person can file the
-- same report a hundred times. Meanwhile feed_items.visibility and
-- feed_comments.visibility are read on every feed query and written by nothing,
-- so the take-down mechanism has been plumbed and unused this whole time.
--
-- This closes both halves. docs/legal-compliance.md lists Online Safety Act
-- moderation as live against the policy pages; the product surface starts here.

alter table public.feed_reports
  add column if not exists reason_code     text,
  add column if not exists status          text not null default 'open',
  add column if not exists resolved_by     uuid references public.profiles(id) on delete set null,
  add column if not exists resolved_at     timestamptz,
  add column if not exists resolution_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feed_reports_status_chk'
  ) then
    alter table public.feed_reports
      add constraint feed_reports_status_chk
      check (status in ('open', 'reviewing', 'actioned', 'dismissed'));
  end if;
end $$;

-- One report per person per thing. Re-reporting the same post adds nothing to
-- the queue but noise, and it lets a single reporter inflate the "N people
-- reported this" signal admins sort by.
create unique index if not exists feed_reports_one_per_reporter
  on public.feed_reports (reporter_profile_id, target_type, target_id);

create index if not exists feed_reports_status_idx
  on public.feed_reports (status, created_at desc);

-- What a moderator actually did, kept separately from the reports that
-- prompted it: an action can be taken without a report, a report can be
-- dismissed without an action, and the audit trail should outlive both. Under
-- the OSA and the ICO's accountability principle we need to be able to show
-- this record, so it is retained (with the reporter's identity nulled) even
-- when the reporting account is deleted.
create table if not exists public.feed_moderation_actions (
  id               uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles(id) on delete set null,
  target_type      text not null check (target_type in ('feed_item', 'comment')),
  target_id        uuid not null,
  action           text not null check (action in ('hide', 'remove', 'restore')),
  reason           text,
  report_id        uuid references public.feed_reports(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists feed_moderation_actions_target_idx
  on public.feed_moderation_actions (target_type, target_id, created_at desc);

alter table public.feed_moderation_actions enable row level security;

-- No policies, deliberately. Every write and read goes through the admin API
-- routes as the service role, which check profiles.is_admin — the same posture
-- as the rest of the admin surface.
revoke all on public.feed_moderation_actions from public, anon, authenticated;
grant all on public.feed_moderation_actions to service_role;

comment on table public.feed_moderation_actions is
  'Audit trail of hide/remove/restore decisions on feed items and comments. Service-role only; written by app/api/admin/moderation.';
