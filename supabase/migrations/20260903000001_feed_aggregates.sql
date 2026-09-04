-- One round trip for a feed page's interaction counts.
--
-- lib/feed/queries.ts used to build these in JavaScript, and the shape was the
-- problem rather than the number of queries:
--
--   getReactionCounts  selected every reaction row on the page and tallied them
--   getCommentCounts   selected every comment row to produce an integer
--   getTopComments     selected EVERY comment on EVERY item in the page, ordered
--                      the lot, and took the first per item
--   getMyReactions     one more trip for the viewer's own emoji
--
-- So a page containing one post with 400 comments shipped 400 rows over the wire
-- to render the number "400", twice. This is O(page) instead, and folds four
-- round trips into one.
--
-- Authorization: none here, deliberately. The only caller is
-- lib/feed/queries.ts, which runs as the service role and has already
-- constrained the page to rows the viewer can see via feed_item_targets. Passing
-- ids that the viewer shouldn't see would leak counts, so this stays
-- service-role-only — same posture as get_live_rounds_feed_data.
--
-- Comment counts and the top comment both filter visibility = 'visible', which
-- the JS versions never did. No row is non-visible today; it matters from the
-- moment moderation can hide one.

create or replace function public.get_feed_aggregates(
  _feed_item_ids uuid[],
  _viewer_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(s.fid::text, s.agg), '{}'::jsonb)
  from (
    select
      i.id as fid,
      jsonb_build_object(
        'reaction_counts', coalesce(
          (
            select jsonb_object_agg(e.emoji, e.n)
            from (
              select r.emoji, count(*) as n
              from public.feed_reactions r
              where r.feed_item_id = i.id
              group by r.emoji
            ) e
          ),
          '{}'::jsonb
        ),
        'comment_count', (
          select count(*)
          from public.feed_comments c
          where c.feed_item_id = i.id
            and c.visibility = 'visible'
        ),
        'my_reaction', (
          select r.emoji
          from public.feed_reactions r
          where r.feed_item_id = i.id
            and r.profile_id = _viewer_profile_id
          limit 1
        ),
        -- Highest voted, most recent breaks the tie. Served by
        -- idx_feed_comments_top (feed_item_id, vote_count desc, created_at desc).
        -- `like_count` duplicates `vote_count` because FeedCard reads that name.
        'top_comment', (
          select jsonb_build_object(
            'id', c.id,
            'body', c.body,
            'created_at', c.created_at,
            'vote_count', c.vote_count,
            'like_count', c.vote_count,
            'author', jsonb_build_object(
              'id', p.id,
              'name', coalesce(p.name, 'Player'),
              'avatar_url', p.avatar_url
            )
          )
          from public.feed_comments c
          join public.profiles p on p.id = c.profile_id
          where c.feed_item_id = i.id
            and c.visibility = 'visible'
            and coalesce(c.body, '') <> ''
          order by c.vote_count desc, c.created_at desc
          limit 1
        )
      ) as agg
    from unnest(_feed_item_ids) as i(id)
  ) s;
$$;

comment on function public.get_feed_aggregates(uuid[], uuid) is
  'Reaction counts, comment count, the viewer''s own reaction and the top comment for a page of feed items, keyed by feed item id. Caller (lib/feed/queries.ts, service role) must already have filtered the ids to what the viewer may see.';

revoke all on function public.get_feed_aggregates(uuid[], uuid) from public, anon, authenticated;
