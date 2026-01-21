drop extension if exists "pg_net";

create type "public"."hole_state" as enum ('completed', 'picked_up', 'not_started');

create type "public"."round_role" as enum ('owner', 'scorer', 'player');

create type "public"."round_status" as enum ('draft', 'live', 'finished', 'starting');

create type "public"."round_visibility" as enum ('private', 'link', 'public');


  create table "public"."ciaga_dump_columns" (
    "table_schema" text not null,
    "table_name" text not null,
    "ordinal_position" integer not null,
    "column_name" text not null,
    "data_type" text not null,
    "udt_name" text not null,
    "is_nullable" text not null,
    "column_default" text
      );



  create table "public"."ciaga_dump_foreign_keys" (
    "table_schema" text not null,
    "table_name" text not null,
    "constraint_name" text not null,
    "column_name" text not null,
    "foreign_table_schema" text not null,
    "foreign_table_name" text not null,
    "foreign_column_name" text not null
      );



  create table "public"."ciaga_dump_objects" (
    "table_schema" text not null,
    "table_name" text not null,
    "table_type" text not null
      );



  create table "public"."ciaga_dump_samples" (
    "table_schema" text not null,
    "table_name" text not null,
    "sample_limit" integer not null,
    "sample_rows" jsonb not null
      );



  create table "public"."ciaga_dump_views" (
    "table_schema" text not null,
    "view_name" text not null,
    "definition" text not null
      );



  create table "public"."ciaga_system_settings" (
    "key" text not null,
    "value" text not null,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."ciaga_system_settings" enable row level security;


  create table "public"."competition_entries" (
    "id" uuid not null default gen_random_uuid(),
    "competition_id" uuid not null,
    "profile_id" uuid not null,
    "assigned_handicap_index" numeric not null,
    "true_handicap_index_at_lock" numeric,
    "source" text not null default 'manual'::text,
    "locked" boolean not null default false,
    "assigned_course_handicap" integer,
    "assigned_playing_handicap" integer
      );


alter table "public"."competition_entries" enable row level security;


  create table "public"."competitions" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "description" text,
    "round_id" uuid,
    "status" text not null default 'draft'::text,
    "locked_at" timestamp with time zone,
    "calc_version" text not null default 'ciaga_v1'::text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."competitions" enable row level security;


  create table "public"."course_tee_boxes" (
    "id" uuid not null default gen_random_uuid(),
    "course_id" uuid not null,
    "name" text not null,
    "gender" text,
    "yards" integer,
    "par" integer,
    "rating" numeric,
    "slope" integer,
    "sort_order" integer default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "total_meters" integer,
    "holes_count" integer,
    "bogey_rating" numeric,
    "front_course_rating" numeric,
    "front_slope_rating" integer,
    "front_bogey_rating" numeric,
    "back_course_rating" numeric,
    "back_slope_rating" integer,
    "back_bogey_rating" numeric
      );


alter table "public"."course_tee_boxes" enable row level security;


  create table "public"."course_tee_holes" (
    "id" uuid not null default gen_random_uuid(),
    "tee_box_id" uuid not null,
    "hole_number" integer not null,
    "par" integer,
    "yardage" integer,
    "handicap" integer,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."course_tee_holes" enable row level security;


  create table "public"."courses" (
    "id" uuid not null default gen_random_uuid(),
    "osm_id" text not null,
    "name" text not null,
    "name_original" text,
    "lat" double precision,
    "lng" double precision,
    "address" text,
    "city" text,
    "country" text,
    "source" text not null default 'osm'::text,
    "golfcourseapi_id" text,
    "golfcourseapi_raw" jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."courses" enable row level security;


  create table "public"."feed_comments" (
    "id" uuid not null default gen_random_uuid(),
    "feed_item_id" uuid not null,
    "profile_id" uuid not null,
    "parent_comment_id" uuid,
    "body" text not null,
    "created_at" timestamp with time zone not null default now(),
    "edited_at" timestamp with time zone,
    "visibility" text not null default 'visible'::text
      );


alter table "public"."feed_comments" enable row level security;


  create table "public"."feed_item_targets" (
    "id" uuid not null default gen_random_uuid(),
    "feed_item_id" uuid not null,
    "viewer_profile_id" uuid not null,
    "reason" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."feed_item_targets" enable row level security;


  create table "public"."feed_items" (
    "id" uuid not null default gen_random_uuid(),
    "type" text not null,
    "actor_profile_id" uuid,
    "audience" text not null default 'followers'::text,
    "occurred_at" timestamp with time zone not null,
    "created_at" timestamp with time zone not null default now(),
    "payload" jsonb not null default '{}'::jsonb,
    "group_key" text,
    "visibility" text not null default 'visible'::text
      );


alter table "public"."feed_items" enable row level security;


  create table "public"."feed_reactions" (
    "id" uuid not null default gen_random_uuid(),
    "feed_item_id" uuid not null,
    "profile_id" uuid not null,
    "emoji" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."feed_reactions" enable row level security;


  create table "public"."feed_reports" (
    "id" uuid not null default gen_random_uuid(),
    "reporter_profile_id" uuid not null,
    "target_type" text not null,
    "target_id" uuid not null,
    "reason" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."feed_reports" enable row level security;


  create table "public"."follows" (
    "id" uuid not null default gen_random_uuid(),
    "follower_id" uuid not null,
    "following_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."follows" enable row level security;


  create table "public"."handicap_index_history" (
    "id" uuid not null default gen_random_uuid(),
    "profile_id" uuid not null,
    "as_of_date" date not null,
    "handicap_index" numeric,
    "low_handicap_index" numeric,
    "soft_cap_delta" numeric not null default 0,
    "hard_cap_delta" numeric not null default 0,
    "esr_applied" numeric not null default 0,
    "calc_version" text not null default 'ciaga_v1'::text,
    "calculated_at" timestamp with time zone not null default now()
      );


alter table "public"."handicap_index_history" enable row level security;


  create table "public"."handicap_round_results" (
    "id" uuid not null default gen_random_uuid(),
    "round_id" uuid not null,
    "participant_id" uuid not null,
    "profile_id" uuid,
    "played_at" date not null,
    "holes_started" integer not null,
    "holes_completed" integer not null,
    "is_9_hole" boolean not null default false,
    "accepted" boolean not null,
    "rejected_reason" text,
    "handicap_index_used" numeric,
    "course_handicap_used" integer not null,
    "tee_snapshot_id" uuid,
    "adjusted_gross_score" integer,
    "score_differential" numeric,
    "derived_from_9" boolean not null default false,
    "combined_from_9" boolean not null default false,
    "pending_9" boolean not null default false,
    "calc_version" text not null default 'ciaga_v1'::text,
    "calculated_at" timestamp with time zone not null default now()
      );


alter table "public"."handicap_round_results" enable row level security;


  create table "public"."invites" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "profile_id" uuid not null,
    "created_by" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "accepted_at" timestamp with time zone,
    "accepted_by" uuid,
    "revoked_at" timestamp with time zone
      );


alter table "public"."invites" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "name" text not null,
    "email" text,
    "avatar_url" text,
    "created_at" timestamp with time zone,
    "is_admin" boolean not null default false,
    "owner_user_id" uuid
      );


alter table "public"."profiles" enable row level security;


  create table "public"."round_course_snapshots" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "round_id" uuid not null,
    "source_course_id" uuid,
    "course_name" text,
    "city" text,
    "country" text,
    "lat" double precision,
    "lng" double precision
      );


alter table "public"."round_course_snapshots" enable row level security;


  create table "public"."round_hole_snapshots" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "round_tee_snapshot_id" uuid not null,
    "hole_number" integer not null,
    "par" integer,
    "yardage" integer,
    "stroke_index" integer
      );


alter table "public"."round_hole_snapshots" enable row level security;


  create table "public"."round_hole_states" (
    "round_id" uuid not null,
    "participant_id" uuid not null,
    "hole_number" integer not null,
    "status" public.hole_state not null default 'not_started'::public.hole_state,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."round_hole_states" enable row level security;


  create table "public"."round_participants" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "round_id" uuid not null,
    "profile_id" uuid,
    "is_guest" boolean not null default false,
    "display_name" text,
    "role" public.round_role not null default 'player'::public.round_role,
    "handicap_index" numeric,
    "tee_snapshot_id" uuid
      );


alter table "public"."round_participants" enable row level security;


  create table "public"."round_score_events" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "round_id" uuid not null,
    "participant_id" uuid not null,
    "hole_number" integer not null,
    "strokes" integer,
    "entered_by" uuid not null
      );


alter table "public"."round_score_events" enable row level security;


  create table "public"."round_tee_snapshots" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "round_course_snapshot_id" uuid not null,
    "source_tee_box_id" uuid,
    "name" text not null,
    "gender" text,
    "holes_count" integer not null,
    "yards_total" integer,
    "par_total" integer,
    "rating" numeric,
    "slope" integer
      );


alter table "public"."round_tee_snapshots" enable row level security;


  create table "public"."rounds" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid not null,
    "status" public.round_status not null default 'draft'::public.round_status,
    "visibility" public.round_visibility not null default 'private'::public.round_visibility,
    "course_id" uuid,
    "name" text,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "pending_tee_box_id" uuid
      );


alter table "public"."rounds" enable row level security;

CREATE UNIQUE INDEX ciaga_system_settings_pkey ON public.ciaga_system_settings USING btree (key);

CREATE UNIQUE INDEX competition_entries_competition_id_profile_id_key ON public.competition_entries USING btree (competition_id, profile_id);

CREATE UNIQUE INDEX competition_entries_pkey ON public.competition_entries USING btree (id);

CREATE UNIQUE INDEX competitions_pkey ON public.competitions USING btree (id);

CREATE UNIQUE INDEX course_tee_boxes_course_id_name_gender_key ON public.course_tee_boxes USING btree (course_id, name, gender);

CREATE INDEX course_tee_boxes_course_rating_idx ON public.course_tee_boxes USING btree (course_id, rating DESC NULLS LAST);

CREATE UNIQUE INDEX course_tee_boxes_pkey ON public.course_tee_boxes USING btree (id);

CREATE UNIQUE INDEX course_tee_boxes_unique ON public.course_tee_boxes USING btree (course_id, name, gender);

CREATE UNIQUE INDEX course_tee_holes_pkey ON public.course_tee_holes USING btree (id);

CREATE UNIQUE INDEX course_tee_holes_tee_box_id_hole_number_key ON public.course_tee_holes USING btree (tee_box_id, hole_number);

CREATE INDEX course_tee_holes_tee_idx ON public.course_tee_holes USING btree (tee_box_id, hole_number);

CREATE INDEX courses_osm_id_idx ON public.courses USING btree (osm_id);

CREATE UNIQUE INDEX courses_osm_id_key ON public.courses USING btree (osm_id);

CREATE UNIQUE INDEX courses_osm_id_uq ON public.courses USING btree (osm_id) WHERE (osm_id IS NOT NULL);

CREATE UNIQUE INDEX courses_pkey ON public.courses USING btree (id);

CREATE INDEX feed_comments_item_created_idx ON public.feed_comments USING btree (feed_item_id, created_at);

CREATE INDEX feed_comments_parent_created_idx ON public.feed_comments USING btree (parent_comment_id, created_at);

CREATE UNIQUE INDEX feed_comments_pkey ON public.feed_comments USING btree (id);

CREATE INDEX feed_item_targets_item_idx ON public.feed_item_targets USING btree (feed_item_id);

CREATE UNIQUE INDEX feed_item_targets_pkey ON public.feed_item_targets USING btree (id);

CREATE UNIQUE INDEX feed_item_targets_unique ON public.feed_item_targets USING btree (feed_item_id, viewer_profile_id);

CREATE INDEX feed_item_targets_viewer_idx ON public.feed_item_targets USING btree (viewer_profile_id, feed_item_id DESC);

CREATE INDEX feed_items_actor_idx ON public.feed_items USING btree (actor_profile_id, occurred_at DESC);

CREATE INDEX feed_items_group_key_idx ON public.feed_items USING btree (group_key, occurred_at DESC);

CREATE INDEX feed_items_occurred_idx ON public.feed_items USING btree (occurred_at DESC, id DESC);

CREATE UNIQUE INDEX feed_items_pkey ON public.feed_items USING btree (id);

CREATE INDEX feed_items_type_idx ON public.feed_items USING btree (type, occurred_at DESC);

CREATE INDEX feed_reactions_item_idx ON public.feed_reactions USING btree (feed_item_id);

CREATE UNIQUE INDEX feed_reactions_pkey ON public.feed_reactions USING btree (id);

CREATE INDEX feed_reactions_profile_idx ON public.feed_reactions USING btree (profile_id);

CREATE UNIQUE INDEX feed_reactions_unique ON public.feed_reactions USING btree (feed_item_id, profile_id);

CREATE UNIQUE INDEX feed_reports_pkey ON public.feed_reports USING btree (id);

CREATE INDEX feed_reports_reporter_idx ON public.feed_reports USING btree (reporter_profile_id, created_at DESC);

CREATE INDEX feed_reports_target_idx ON public.feed_reports USING btree (target_type, target_id, created_at DESC);

CREATE UNIQUE INDEX follows_pkey ON public.follows USING btree (id);

CREATE UNIQUE INDEX follows_unique ON public.follows USING btree (follower_id, following_id);

CREATE UNIQUE INDEX handicap_index_history_pkey ON public.handicap_index_history USING btree (id);

CREATE UNIQUE INDEX handicap_index_history_profile_id_as_of_date_key ON public.handicap_index_history USING btree (profile_id, as_of_date);

CREATE UNIQUE INDEX handicap_round_results_participant_id_round_id_key ON public.handicap_round_results USING btree (participant_id, round_id);

CREATE UNIQUE INDEX handicap_round_results_pkey ON public.handicap_round_results USING btree (id);

CREATE INDEX idx_comp_entries_comp ON public.competition_entries USING btree (competition_id);

CREATE INDEX idx_hih_profile_date ON public.handicap_index_history USING btree (profile_id, as_of_date);

CREATE INDEX idx_hrr_profile_date ON public.handicap_round_results USING btree (profile_id, played_at);

CREATE INDEX idx_hrr_round ON public.handicap_round_results USING btree (round_id);

CREATE INDEX idx_rhs_round ON public.round_hole_states USING btree (round_id);

CREATE INDEX idx_round_course_snapshots_round ON public.round_course_snapshots USING btree (round_id);

CREATE INDEX idx_round_hole_snapshots_tee ON public.round_hole_snapshots USING btree (round_tee_snapshot_id);

CREATE INDEX idx_round_participants_profile ON public.round_participants USING btree (profile_id);

CREATE INDEX idx_round_participants_round ON public.round_participants USING btree (round_id);

CREATE INDEX idx_round_score_events_participant_hole ON public.round_score_events USING btree (participant_id, hole_number, created_at DESC);

CREATE INDEX idx_round_score_events_round ON public.round_score_events USING btree (round_id, created_at DESC);

CREATE INDEX idx_round_tee_snapshots_course_snap ON public.round_tee_snapshots USING btree (round_course_snapshot_id);

CREATE INDEX idx_rounds_created_by ON public.rounds USING btree (created_by);

CREATE INDEX idx_rounds_pending_tee_box_id ON public.rounds USING btree (pending_tee_box_id);

CREATE INDEX idx_rounds_status ON public.rounds USING btree (status);

CREATE INDEX invites_email_idx ON public.invites USING btree (lower(email));

CREATE UNIQUE INDEX invites_pkey ON public.invites USING btree (id);

CREATE INDEX invites_profile_idx ON public.invites USING btree (profile_id);

CREATE UNIQUE INDEX profiles_owner_user_id_once ON public.profiles USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);

CREATE UNIQUE INDEX profiles_owner_user_id_unique ON public.profiles USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX round_course_snapshots_pkey ON public.round_course_snapshots USING btree (id);

CREATE UNIQUE INDEX round_course_snapshots_round_id_key ON public.round_course_snapshots USING btree (round_id);

CREATE UNIQUE INDEX round_hole_snapshots_pkey ON public.round_hole_snapshots USING btree (id);

CREATE UNIQUE INDEX round_hole_states_pkey ON public.round_hole_states USING btree (participant_id, hole_number);

CREATE UNIQUE INDEX round_participants_pkey ON public.round_participants USING btree (id);

CREATE UNIQUE INDEX round_score_events_pkey ON public.round_score_events USING btree (id);

CREATE UNIQUE INDEX round_tee_snapshots_pkey ON public.round_tee_snapshots USING btree (id);

CREATE UNIQUE INDEX rounds_pkey ON public.rounds USING btree (id);

CREATE INDEX tee_boxes_course_idx ON public.course_tee_boxes USING btree (course_id);

CREATE UNIQUE INDEX uq_round_hole_snapshots_tee_hole ON public.round_hole_snapshots USING btree (round_tee_snapshot_id, hole_number);

CREATE UNIQUE INDEX uq_round_participants_round_profile ON public.round_participants USING btree (round_id, profile_id) WHERE (profile_id IS NOT NULL);

alter table "public"."ciaga_system_settings" add constraint "ciaga_system_settings_pkey" PRIMARY KEY using index "ciaga_system_settings_pkey";

alter table "public"."competition_entries" add constraint "competition_entries_pkey" PRIMARY KEY using index "competition_entries_pkey";

alter table "public"."competitions" add constraint "competitions_pkey" PRIMARY KEY using index "competitions_pkey";

alter table "public"."course_tee_boxes" add constraint "course_tee_boxes_pkey" PRIMARY KEY using index "course_tee_boxes_pkey";

alter table "public"."course_tee_holes" add constraint "course_tee_holes_pkey" PRIMARY KEY using index "course_tee_holes_pkey";

alter table "public"."courses" add constraint "courses_pkey" PRIMARY KEY using index "courses_pkey";

alter table "public"."feed_comments" add constraint "feed_comments_pkey" PRIMARY KEY using index "feed_comments_pkey";

alter table "public"."feed_item_targets" add constraint "feed_item_targets_pkey" PRIMARY KEY using index "feed_item_targets_pkey";

alter table "public"."feed_items" add constraint "feed_items_pkey" PRIMARY KEY using index "feed_items_pkey";

alter table "public"."feed_reactions" add constraint "feed_reactions_pkey" PRIMARY KEY using index "feed_reactions_pkey";

alter table "public"."feed_reports" add constraint "feed_reports_pkey" PRIMARY KEY using index "feed_reports_pkey";

alter table "public"."follows" add constraint "follows_pkey" PRIMARY KEY using index "follows_pkey";

alter table "public"."handicap_index_history" add constraint "handicap_index_history_pkey" PRIMARY KEY using index "handicap_index_history_pkey";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_pkey" PRIMARY KEY using index "handicap_round_results_pkey";

alter table "public"."invites" add constraint "invites_pkey" PRIMARY KEY using index "invites_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."round_course_snapshots" add constraint "round_course_snapshots_pkey" PRIMARY KEY using index "round_course_snapshots_pkey";

alter table "public"."round_hole_snapshots" add constraint "round_hole_snapshots_pkey" PRIMARY KEY using index "round_hole_snapshots_pkey";

alter table "public"."round_hole_states" add constraint "round_hole_states_pkey" PRIMARY KEY using index "round_hole_states_pkey";

alter table "public"."round_participants" add constraint "round_participants_pkey" PRIMARY KEY using index "round_participants_pkey";

alter table "public"."round_score_events" add constraint "round_score_events_pkey" PRIMARY KEY using index "round_score_events_pkey";

alter table "public"."round_tee_snapshots" add constraint "round_tee_snapshots_pkey" PRIMARY KEY using index "round_tee_snapshots_pkey";

alter table "public"."rounds" add constraint "rounds_pkey" PRIMARY KEY using index "rounds_pkey";

alter table "public"."competition_entries" add constraint "competition_entries_competition_id_fkey" FOREIGN KEY (competition_id) REFERENCES public.competitions(id) ON DELETE CASCADE not valid;

alter table "public"."competition_entries" validate constraint "competition_entries_competition_id_fkey";

alter table "public"."competition_entries" add constraint "competition_entries_competition_id_profile_id_key" UNIQUE using index "competition_entries_competition_id_profile_id_key";

alter table "public"."competition_entries" add constraint "competition_entries_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."competition_entries" validate constraint "competition_entries_profile_id_fkey";

alter table "public"."competition_entries" add constraint "competition_entries_source_check" CHECK ((source = ANY (ARRAY['bid'::text, 'manual'::text, 'true_at_lock'::text, 'formula'::text]))) not valid;

alter table "public"."competition_entries" validate constraint "competition_entries_source_check";

alter table "public"."competitions" add constraint "competitions_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE SET NULL not valid;

alter table "public"."competitions" validate constraint "competitions_round_id_fkey";

alter table "public"."competitions" add constraint "competitions_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'locked'::text, 'finished'::text]))) not valid;

alter table "public"."competitions" validate constraint "competitions_status_check";

alter table "public"."course_tee_boxes" add constraint "course_tee_boxes_course_id_fkey" FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE not valid;

alter table "public"."course_tee_boxes" validate constraint "course_tee_boxes_course_id_fkey";

alter table "public"."course_tee_boxes" add constraint "course_tee_boxes_course_id_name_gender_key" UNIQUE using index "course_tee_boxes_course_id_name_gender_key";

alter table "public"."course_tee_boxes" add constraint "course_tee_boxes_unique" UNIQUE using index "course_tee_boxes_unique";

alter table "public"."course_tee_holes" add constraint "course_tee_holes_tee_box_id_fkey" FOREIGN KEY (tee_box_id) REFERENCES public.course_tee_boxes(id) ON DELETE CASCADE not valid;

alter table "public"."course_tee_holes" validate constraint "course_tee_holes_tee_box_id_fkey";

alter table "public"."course_tee_holes" add constraint "course_tee_holes_tee_box_id_hole_number_key" UNIQUE using index "course_tee_holes_tee_box_id_hole_number_key";

alter table "public"."courses" add constraint "courses_osm_id_key" UNIQUE using index "courses_osm_id_key";

alter table "public"."courses" add constraint "courses_osm_id_no_whitespace" CHECK (((osm_id IS NULL) OR (osm_id = btrim(osm_id)))) not valid;

alter table "public"."courses" validate constraint "courses_osm_id_no_whitespace";

alter table "public"."feed_comments" add constraint "feed_comments_feed_item_id_fkey" FOREIGN KEY (feed_item_id) REFERENCES public.feed_items(id) ON DELETE CASCADE not valid;

alter table "public"."feed_comments" validate constraint "feed_comments_feed_item_id_fkey";

alter table "public"."feed_comments" add constraint "feed_comments_parent_comment_id_fkey" FOREIGN KEY (parent_comment_id) REFERENCES public.feed_comments(id) ON DELETE CASCADE not valid;

alter table "public"."feed_comments" validate constraint "feed_comments_parent_comment_id_fkey";

alter table "public"."feed_comments" add constraint "feed_comments_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."feed_comments" validate constraint "feed_comments_profile_id_fkey";

alter table "public"."feed_item_targets" add constraint "feed_item_targets_feed_item_id_fkey" FOREIGN KEY (feed_item_id) REFERENCES public.feed_items(id) ON DELETE CASCADE not valid;

alter table "public"."feed_item_targets" validate constraint "feed_item_targets_feed_item_id_fkey";

alter table "public"."feed_item_targets" add constraint "feed_item_targets_unique" UNIQUE using index "feed_item_targets_unique";

alter table "public"."feed_item_targets" add constraint "feed_item_targets_viewer_profile_id_fkey" FOREIGN KEY (viewer_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."feed_item_targets" validate constraint "feed_item_targets_viewer_profile_id_fkey";

alter table "public"."feed_items" add constraint "feed_items_actor_profile_id_fkey" FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."feed_items" validate constraint "feed_items_actor_profile_id_fkey";

alter table "public"."feed_reactions" add constraint "feed_reactions_feed_item_id_fkey" FOREIGN KEY (feed_item_id) REFERENCES public.feed_items(id) ON DELETE CASCADE not valid;

alter table "public"."feed_reactions" validate constraint "feed_reactions_feed_item_id_fkey";

alter table "public"."feed_reactions" add constraint "feed_reactions_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."feed_reactions" validate constraint "feed_reactions_profile_id_fkey";

alter table "public"."feed_reactions" add constraint "feed_reactions_unique" UNIQUE using index "feed_reactions_unique";

alter table "public"."feed_reports" add constraint "feed_reports_reporter_profile_id_fkey" FOREIGN KEY (reporter_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."feed_reports" validate constraint "feed_reports_reporter_profile_id_fkey";

alter table "public"."follows" add constraint "follows_follower_id_fkey" FOREIGN KEY (follower_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."follows" validate constraint "follows_follower_id_fkey";

alter table "public"."follows" add constraint "follows_following_id_fkey" FOREIGN KEY (following_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."follows" validate constraint "follows_following_id_fkey";

alter table "public"."follows" add constraint "follows_no_self" CHECK ((follower_id <> following_id)) not valid;

alter table "public"."follows" validate constraint "follows_no_self";

alter table "public"."follows" add constraint "follows_unique" UNIQUE using index "follows_unique";

alter table "public"."handicap_index_history" add constraint "handicap_index_history_hi_max_check" CHECK (((handicap_index IS NULL) OR (handicap_index <= 54.0))) not valid;

alter table "public"."handicap_index_history" validate constraint "handicap_index_history_hi_max_check";

alter table "public"."handicap_index_history" add constraint "handicap_index_history_profile_id_as_of_date_key" UNIQUE using index "handicap_index_history_profile_id_as_of_date_key";

alter table "public"."handicap_index_history" add constraint "handicap_index_history_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."handicap_index_history" validate constraint "handicap_index_history_profile_id_fkey";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_participant_id_fkey" FOREIGN KEY (participant_id) REFERENCES public.round_participants(id) ON DELETE CASCADE not valid;

alter table "public"."handicap_round_results" validate constraint "handicap_round_results_participant_id_fkey";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_participant_id_round_id_key" UNIQUE using index "handicap_round_results_participant_id_round_id_key";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."handicap_round_results" validate constraint "handicap_round_results_profile_id_fkey";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE not valid;

alter table "public"."handicap_round_results" validate constraint "handicap_round_results_round_id_fkey";

alter table "public"."handicap_round_results" add constraint "handicap_round_results_tee_snapshot_id_fkey" FOREIGN KEY (tee_snapshot_id) REFERENCES public.round_tee_snapshots(id) ON DELETE SET NULL not valid;

alter table "public"."handicap_round_results" validate constraint "handicap_round_results_tee_snapshot_id_fkey";

alter table "public"."handicap_round_results" add constraint "hrr_is_9_hole_not_null" CHECK ((is_9_hole IS NOT NULL)) not valid;

alter table "public"."handicap_round_results" validate constraint "hrr_is_9_hole_not_null";

alter table "public"."invites" add constraint "invites_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."invites" validate constraint "invites_profile_id_fkey";

alter table "public"."profiles" add constraint "profiles_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) not valid;

alter table "public"."profiles" validate constraint "profiles_owner_user_id_fkey";

alter table "public"."round_course_snapshots" add constraint "round_course_snapshots_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE not valid;

alter table "public"."round_course_snapshots" validate constraint "round_course_snapshots_round_id_fkey";

alter table "public"."round_course_snapshots" add constraint "round_course_snapshots_round_id_key" UNIQUE using index "round_course_snapshots_round_id_key";

alter table "public"."round_course_snapshots" add constraint "round_course_snapshots_source_course_id_fkey" FOREIGN KEY (source_course_id) REFERENCES public.courses(id) ON DELETE SET NULL not valid;

alter table "public"."round_course_snapshots" validate constraint "round_course_snapshots_source_course_id_fkey";

alter table "public"."round_hole_snapshots" add constraint "round_hole_snapshots_hole_number_check" CHECK (((hole_number >= 1) AND (hole_number <= 18))) not valid;

alter table "public"."round_hole_snapshots" validate constraint "round_hole_snapshots_hole_number_check";

alter table "public"."round_hole_snapshots" add constraint "round_hole_snapshots_round_tee_snapshot_id_fkey" FOREIGN KEY (round_tee_snapshot_id) REFERENCES public.round_tee_snapshots(id) ON DELETE CASCADE not valid;

alter table "public"."round_hole_snapshots" validate constraint "round_hole_snapshots_round_tee_snapshot_id_fkey";

alter table "public"."round_hole_states" add constraint "round_hole_states_hole_number_check" CHECK (((hole_number >= 1) AND (hole_number <= 18))) not valid;

alter table "public"."round_hole_states" validate constraint "round_hole_states_hole_number_check";

alter table "public"."round_hole_states" add constraint "round_hole_states_participant_id_fkey" FOREIGN KEY (participant_id) REFERENCES public.round_participants(id) ON DELETE CASCADE not valid;

alter table "public"."round_hole_states" validate constraint "round_hole_states_participant_id_fkey";

alter table "public"."round_hole_states" add constraint "round_hole_states_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE not valid;

alter table "public"."round_hole_states" validate constraint "round_hole_states_round_id_fkey";

alter table "public"."round_participants" add constraint "fk_round_participants_tee_snapshot" FOREIGN KEY (tee_snapshot_id) REFERENCES public.round_tee_snapshots(id) ON DELETE SET NULL not valid;

alter table "public"."round_participants" validate constraint "fk_round_participants_tee_snapshot";

alter table "public"."round_participants" add constraint "round_participants_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."round_participants" validate constraint "round_participants_profile_id_fkey";

alter table "public"."round_participants" add constraint "round_participants_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE not valid;

alter table "public"."round_participants" validate constraint "round_participants_round_id_fkey";

alter table "public"."round_score_events" add constraint "round_score_events_entered_by_fkey" FOREIGN KEY (entered_by) REFERENCES public.profiles(id) ON DELETE RESTRICT not valid;

alter table "public"."round_score_events" validate constraint "round_score_events_entered_by_fkey";

alter table "public"."round_score_events" add constraint "round_score_events_hole_number_check" CHECK (((hole_number >= 1) AND (hole_number <= 18))) not valid;

alter table "public"."round_score_events" validate constraint "round_score_events_hole_number_check";

alter table "public"."round_score_events" add constraint "round_score_events_participant_id_fkey" FOREIGN KEY (participant_id) REFERENCES public.round_participants(id) ON DELETE CASCADE not valid;

alter table "public"."round_score_events" validate constraint "round_score_events_participant_id_fkey";

alter table "public"."round_score_events" add constraint "round_score_events_round_id_fkey" FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE not valid;

alter table "public"."round_score_events" validate constraint "round_score_events_round_id_fkey";

alter table "public"."round_score_events" add constraint "round_score_events_strokes_check" CHECK (((strokes IS NULL) OR ((strokes >= 0) AND (strokes <= 30)))) not valid;

alter table "public"."round_score_events" validate constraint "round_score_events_strokes_check";

alter table "public"."round_tee_snapshots" add constraint "round_tee_snapshots_holes_count_check" CHECK ((holes_count = ANY (ARRAY[9, 18]))) not valid;

alter table "public"."round_tee_snapshots" validate constraint "round_tee_snapshots_holes_count_check";

alter table "public"."round_tee_snapshots" add constraint "round_tee_snapshots_round_course_snapshot_id_fkey" FOREIGN KEY (round_course_snapshot_id) REFERENCES public.round_course_snapshots(id) ON DELETE CASCADE not valid;

alter table "public"."round_tee_snapshots" validate constraint "round_tee_snapshots_round_course_snapshot_id_fkey";

alter table "public"."round_tee_snapshots" add constraint "round_tee_snapshots_source_tee_box_id_fkey" FOREIGN KEY (source_tee_box_id) REFERENCES public.course_tee_boxes(id) ON DELETE SET NULL not valid;

alter table "public"."round_tee_snapshots" validate constraint "round_tee_snapshots_source_tee_box_id_fkey";

alter table "public"."rounds" add constraint "rounds_course_id_fkey" FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL not valid;

alter table "public"."rounds" validate constraint "rounds_course_id_fkey";

alter table "public"."rounds" add constraint "rounds_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT not valid;

alter table "public"."rounds" validate constraint "rounds_created_by_fkey";

alter table "public"."rounds" add constraint "rounds_pending_tee_box_id_fkey" FOREIGN KEY (pending_tee_box_id) REFERENCES public.course_tee_boxes(id) ON DELETE SET NULL not valid;

alter table "public"."rounds" validate constraint "rounds_pending_tee_box_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.ciaga_current_handicap_version()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select value
  from ciaga_system_settings
  where key = 'handicap_calc_version';
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_current_true_hi(p_profile_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
select handicap_index
from handicap_index_history
where profile_id = p_profile_id
  and handicap_index is not null
order by as_of_date desc
limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_hi_adjustment(n integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
select case
  when n = 3 then -2.0
  when n = 4 then -1.0
  when n = 6 then -1.0
  else 0.0
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_lock_competition(p_competition_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  -- snapshot true HI at lock time for every entry (even if assigned handicap is different)
  update competition_entries ce
     set true_handicap_index_at_lock = ciaga_current_true_hi(ce.profile_id),
         locked = true
   where ce.competition_id = p_competition_id;

  update competitions
     set status = 'locked',
         locked_at = now()
   where id = p_competition_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.ciaga_lowest_of_n_count(n integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
select case
  when n <= 0 then 0
  when n <= 5 then 1
  when n <= 8 then 2
  when n <= 11 then 3
  when n <= 14 then 4
  when n <= 16 then 5
  when n <= 18 then 6
  when n = 19 then 7
  else 8
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_played9_sd(p_participant_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
select round(
  (
    (
      (hrr.adjusted_gross_score::numeric - ts.rating::numeric) * 113.0
    ) / nullif(ts.slope::numeric, 0)
  ),
  1
)
from handicap_round_results hrr
join round_tee_snapshots ts on ts.id = hrr.tee_snapshot_id
where hrr.participant_id = p_participant_id
  and hrr.is_9_hole = true;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_refresh_handicaps_sequential()
 RETURNS void
 LANGUAGE plpgsql
AS $function$declare
  r record;
  p record;
  v_round_date date;
  v_hi numeric;
begin
  -- wipe derived outputs
  delete from handicap_round_results;
  delete from handicap_index_history;

  -- process finished rounds in order
  for r in
    select
      id,
      coalesce(started_at::date, created_at::date) as round_date
    from rounds
    where status = 'finished'
    order by coalesce(started_at, created_at), id
  loop
    v_round_date := r.round_date;

    -- 1) snapshot HI onto each participant (HI as-of day before round date)
    for p in
      select id, profile_id
      from round_participants
      where round_id = r.id
    loop
      if p.profile_id is not null then
        v_hi := ciaga_true_hi_as_of(p.profile_id, (v_round_date - 1));

        -- ✅ HARD CAP: Handicap Index cannot exceed 54.0
        if v_hi is not null then
          v_hi := least(54.0, v_hi);
        end if;

        update round_participants
        set handicap_index = v_hi
        where id = p.id;
      end if;
    end loop;

    -- 2) compute round results (AGS/SD) for each participant
    for p in
      select id
      from round_participants
      where round_id = r.id
    loop
      perform upsert_handicap_round_result(p.id);
    end loop;

    -- 3) update HI history for profiles in this round
    for p in
      select distinct profile_id
      from round_participants
      where round_id = r.id
        and profile_id is not null
    loop
      perform recalc_handicap_profile(p.profile_id);
    end loop;

  end loop;
end$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_refresh_schema_dump()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- wipe derived outputs
  truncate table ciaga_dump_columns;

  insert into ciaga_dump_columns (
    table_schema,
    table_name,
    ordinal_position,
    column_name,
    data_type,
    udt_name,
    is_nullable,
    column_default
  )
  select
    c.table_schema::text,
    c.table_name::text,
    c.ordinal_position::int,
    c.column_name::text,
    c.data_type::text,
    c.udt_name::text,
    c.is_nullable::text,
    c.column_default::text
  from information_schema.columns c
  where c.table_schema not in ('pg_catalog', 'information_schema');
end;
$function$
;

create or replace view "public"."ciaga_scoring_record_stream" as  WITH base AS (
         SELECT hrr.profile_id,
            hrr.participant_id,
            hrr.round_id,
            hrr.played_at,
            hrr.is_9_hole,
            hrr.accepted,
            hrr.pending_9,
            hrr.score_differential,
            hrr.tee_snapshot_id,
            hrr.adjusted_gross_score
           FROM public.handicap_round_results hrr
          WHERE (hrr.accepted = true)
        ), eighteen AS (
         SELECT base.profile_id,
            base.played_at,
            base.score_differential AS differential,
            false AS combined_from_9
           FROM base
          WHERE ((base.is_9_hole = false) AND (base.score_differential IS NOT NULL))
        ), nine_with_hi AS (
         SELECT base.profile_id,
            base.played_at,
            base.score_differential AS differential,
            false AS combined_from_9
           FROM base
          WHERE ((base.is_9_hole = true) AND (base.pending_9 = false) AND (base.score_differential IS NOT NULL))
        ), nine_pending AS (
         SELECT base.profile_id,
            base.played_at,
            base.participant_id,
            public.ciaga_played9_sd(base.participant_id) AS played9sd
           FROM base
          WHERE ((base.is_9_hole = true) AND (base.pending_9 = true))
        ), pending_pairs AS (
         SELECT nine_pending.profile_id,
            nine_pending.played_at,
            nine_pending.played9sd,
            row_number() OVER (PARTITION BY nine_pending.profile_id ORDER BY nine_pending.played_at, nine_pending.participant_id) AS rn
           FROM nine_pending
          WHERE (nine_pending.played9sd IS NOT NULL)
        ), combined_nines AS (
         SELECT a.profile_id,
            b.played_at,
            round(((a.played9sd + b.played9sd) / 2.0), 1) AS differential,
            true AS combined_from_9
           FROM (pending_pairs a
             JOIN pending_pairs b ON (((b.profile_id = a.profile_id) AND (b.rn = (a.rn + 1)))))
          WHERE ((a.rn % (2)::bigint) = 1)
        )
 SELECT eighteen.profile_id,
    eighteen.played_at,
    eighteen.differential,
    eighteen.combined_from_9
   FROM eighteen
UNION ALL
 SELECT nine_with_hi.profile_id,
    nine_with_hi.played_at,
    nine_with_hi.differential,
    nine_with_hi.combined_from_9
   FROM nine_with_hi
UNION ALL
 SELECT combined_nines.profile_id,
    combined_nines.played_at,
    combined_nines.differential,
    combined_nines.combined_from_9
   FROM combined_nines;


CREATE OR REPLACE FUNCTION public.ciaga_set_handicap_version(p_version text, p_rebuild boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update ciaga_system_settings
     set value = p_version,
         updated_at = now()
   where key = 'handicap_calc_version';

  if not found then
    insert into ciaga_system_settings(key, value) values ('handicap_calc_version', p_version);
  end if;

  if p_rebuild then
    -- rebuild everyone (CIAGA scale: fine)
    perform ciaga_recalc_all_handicaps();
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.ciaga_strokes_received_on_hole(course_handicap integer, hole_si integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select
    case
      when hole_si is null or hole_si < 1 or hole_si > 18 then 0
      else
        -- base strokes on every hole
        (course_handicap / 18)
        +
        -- remainder strokes on hardest holes
        case when (course_handicap % 18) >= hole_si then 1 else 0 end
    end;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_true_hi_as_of(p_profile_id uuid, p_as_of date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  select
    case
      when h.handicap_index is null then null
      else least(54.0, h.handicap_index)
    end
  from (
    select handicap_index
    from public.handicap_index_history
    where profile_id = p_profile_id
      and handicap_index is not null
      and as_of_date <= p_as_of
    order by as_of_date desc
    limit 1
  ) h;
$function$
;

CREATE OR REPLACE FUNCTION public.ciaga_unlock_competition(p_competition_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update competition_entries
     set locked = false
   where competition_id = p_competition_id;

  update competitions
     set status = 'draft',
         locked_at = null
   where id = p_competition_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.compute_all_results_when_round_finishes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
begin
  if new.status = 'finished' and old.status is distinct from new.status then
    perform public.compute_results_for_round(new.id);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_handicap_round_result(p_participant_id uuid)
 RETURNS TABLE(round_id uuid, participant_id uuid, profile_id uuid, played_at date, holes_started integer, holes_completed integer, is_9_hole boolean, accepted boolean, rejected_reason text, handicap_index_used numeric, course_handicap_used integer, tee_snapshot_id uuid, adjusted_gross_score integer, score_differential numeric, derived_from_9 boolean, pending_9 boolean)
 LANGUAGE sql
AS $function$with p as (
  select
    rp.id as participant_id,
    rp.round_id,
    rp.profile_id,
    rp.handicap_index as hi,
    rp.tee_snapshot_id,
    r.started_at,
    r.status
  from round_participants rp
  join rounds r on r.id = rp.round_id
  where rp.id = p_participant_id
),
tee as (
  select
    ts.id as tee_snapshot_id,
    ts.holes_count,
    ts.rating::numeric as cr,
    ts.slope::numeric as slope
  from round_tee_snapshots ts
  join p on p.tee_snapshot_id = ts.id
),
scores as (
  -- ✅ latest strokes per participant+hole (prevents fan-out)
  select distinct on (e.participant_id, e.hole_number)
    e.participant_id,
    e.hole_number,
    e.strokes
  from round_score_events e
  join p on p.participant_id = e.participant_id
  where e.strokes is not null
  order by e.participant_id, e.hole_number, e.created_at desc
),
holes as (
  select
    hs.participant_id,
    hs.round_id,
    hs.hole_number,
    hs.status as hole_status,
    h.par,
    h.stroke_index,
    s.strokes as raw_strokes
  from round_hole_states hs
  join p on p.participant_id = hs.participant_id

  -- ✅ correct join: hole snapshots belong to a tee snapshot
  join round_hole_snapshots h
    on h.round_tee_snapshot_id = p.tee_snapshot_id
   and h.hole_number = hs.hole_number

  left join scores s
    on s.participant_id = hs.participant_id
   and s.hole_number = hs.hole_number

  where
    -- ✅ for 9-hole tees, only include holes 1..9
    (select holes_count from tee) <> 9
    or hs.hole_number between 1 and 9
),
gate as (
  select
    count(*) filter (where hole_status <> 'not_started') as holes_started,
    count(*) filter (where hole_status = 'completed') as holes_completed
  from holes
),
par_total as (
  select sum(par)::int as par_sum
  from holes
),
ch as (
  select
    case
      when (select hi from p) is null then 54
      else
        round(
          ((select hi from p) * (select slope from tee) / 113.0)
          + ((select cr from tee) - (select par_sum from par_total))
        )::int
    end as course_handicap_used
),
adjusted as (
  select
    h.*,
    ((select course_handicap_used from ch) / 18) as base_strokes,
    ((select course_handicap_used from ch) % 18) as rem_strokes
  from holes h
),
ags as (
  select
    sum(
      case a.hole_status
        when 'completed' then
          least(
            a.raw_strokes,
            a.par
            + 2
            + a.base_strokes
            + case when a.rem_strokes > 0 and a.stroke_index <= a.rem_strokes then 1 else 0 end
          )
        when 'picked_up' then
          a.par
          + 2
          + a.base_strokes
          + case when a.rem_strokes > 0 and a.stroke_index <= a.rem_strokes then 1 else 0 end
        else -- not_started
          0
      end
    )::int as adjusted_gross_score
  from adjusted a
)
select
  (select round_id from p) as round_id,
  (select participant_id from p) as participant_id,
  (select profile_id from p) as profile_id,
  ((select started_at from p)::date) as played_at,

  g.holes_started,
  g.holes_completed,
  ((select holes_count from tee) = 9) as is_9_hole,

  case
    when (select holes_count from tee) = 9 then (g.holes_started >= 7)
    else (g.holes_started >= 14)
  end as accepted,

  case
    when (select status from p) <> 'finished' then 'round_not_finished'
    when (select holes_count from tee) = 9 and g.holes_started < 7 then 'min_holes_not_met_9'
    when (select holes_count from tee) <> 9 and g.holes_started < 14 then 'min_holes_not_met_18'
    else null
  end as rejected_reason,

  (select hi from p) as handicap_index_used,
  (select course_handicap_used from ch) as course_handicap_used,
  (select tee_snapshot_id from p) as tee_snapshot_id,

  (select adjusted_gross_score from ags) as adjusted_gross_score,

  case
    when (select status from p) <> 'finished' then null

    when (select holes_count from tee) = 9 and (select hi from p) is null then null

    when (select holes_count from tee) = 9 and (select hi from p) is not null then
      round(
        (
          round(
            (
              (((select adjusted_gross_score from ags)::numeric - (select cr from tee)) * 113.0)
              / (select slope from tee)
            ),
            1
          )
          + round((((select hi from p) * 0.52) + 1.2), 1)
        ),
        1
      )

    else
      round(
        (
          (((select adjusted_gross_score from ags)::numeric - (select cr from tee)) * 113.0)
          / (select slope from tee)
        ),
        1
      )
  end as score_differential,

  ((select holes_count from tee) = 9 and (select hi from p) is not null) as derived_from_9,
  ((select holes_count from tee) = 9 and (select hi from p) is null) as pending_9

from gate g;$function$
;

CREATE OR REPLACE FUNCTION public.compute_results_for_round(_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare
  p record;
  v_round_date date;
  v_hi numeric;
begin
  -- round date
  select coalesce(started_at::date, created_at::date)
    into v_round_date
  from rounds
  where id = _round_id;

  if v_round_date is null then
    return;
  end if;

  -- 0) IMPORTANT: sync hole states from score events so holes_started/completed are real
  perform public.sync_round_hole_states_from_events(_round_id);

  -- 1) backfill display_name + snapshot HI (as-of day before round)
  for p in
    select id, profile_id
    from round_participants
    where round_id = _round_id
  loop
    -- display_name backfill
    update round_participants rp
    set display_name = coalesce(rp.display_name, pr.name, pr.email, 'Player')
    from profiles pr
    where rp.id = p.id
      and rp.profile_id = pr.id
      and rp.display_name is null;

    -- HI snapshot
    if p.profile_id is not null then
      v_hi := public.ciaga_true_hi_as_of(p.profile_id, (v_round_date - 1));
      if v_hi is not null then
        v_hi := least(54.0, v_hi);
      end if;

      update round_participants
      set handicap_index = v_hi
      where id = p.id;
    end if;
  end loop;

  -- 2) delete derived rows ONLY for this round (avoid global wipe)
  delete from handicap_round_results where round_id = _round_id;

  -- 3) compute results for each participant in this round
  for p in
    select id
    from round_participants
    where round_id = _round_id
  loop
    perform upsert_handicap_round_result(p.id);
  end loop;

  -- 4) update HI history ONLY for profiles in this round
  for p in
    select distinct profile_id
    from round_participants
    where round_id = _round_id
      and profile_id is not null
  loop
    perform recalc_handicap_profile(p.profile_id);
  end loop;

end;
$function$
;

create or replace view "public"."current_handicaps" as  SELECT DISTINCT ON (profile_id) profile_id,
    handicap_index,
    as_of_date
   FROM public.handicap_index_history
  WHERE (handicap_index IS NOT NULL)
  ORDER BY profile_id, as_of_date DESC;


CREATE OR REPLACE FUNCTION public.current_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id
  from public.profiles p
  where p.owner_user_id = auth.uid()
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_current_handicaps(ids uuid[])
 RETURNS TABLE(profile_id uuid, handicap_index numeric, as_of_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ch.profile_id, ch.handicap_index, ch.as_of_date
  from current_handicaps ch
  where ch.profile_id = any(ids);
$function$
;

CREATE OR REPLACE FUNCTION public.get_profiles_public(ids uuid[])
 RETURNS TABLE(id uuid, name text, email text, avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    p.name,
    case when p.owner_user_id is null then null else p.email end as email,
    p.avatar_url
  from public.profiles p
  where p.id = any(ids);
$function$
;

CREATE OR REPLACE FUNCTION public.get_profiles_public_by_owner_ids(owner_ids uuid[])
 RETURNS TABLE(id uuid, owner_user_id uuid, name text, email text, avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    p.owner_user_id,
    p.name,
    case when p.owner_user_id is null then null else p.email end as email,
    p.avatar_url
  from public.profiles p
  where p.owner_user_id = any(owner_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.get_round_participants(_round_id uuid)
 RETURNS TABLE(id uuid, profile_id uuid, is_guest boolean, display_name text, role text, tee_snapshot_id uuid, handicap_index numeric, course_handicap numeric, handicap_index_computed numeric, course_handicap_computed numeric, handicap_index_used numeric, course_handicap_used numeric, name text, email text, avatar_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with r as (
  select
    id as round_id,
    coalesce(started_at::date, created_at::date) as round_date
  from rounds
  where id = _round_id
  limit 1
),
tee as (
  -- Pick the tee snapshot used by this round
  select
    rts.id as tee_snapshot_id,
    rts.rating::numeric as rating,
    rts.slope::numeric as slope,
    rts.par_total::numeric as par_total
  from round_participants rp
  join round_tee_snapshots rts
    on rts.id = rp.tee_snapshot_id
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1
),
computed_hi as (
  -- HI per participant as-of the day before the round date
  select
    rp.id as round_participant_id,
    rp.profile_id,
    (
      select h.handicap_index::numeric
      from handicap_index_history h
      join r on true
      where h.profile_id = rp.profile_id
        and h.as_of_date <= (r.round_date - 1)
      order by h.as_of_date desc nulls last
      limit 1
    ) as handicap_index_computed
  from round_participants rp
  where rp.round_id = _round_id
    and rp.profile_id is not null
),
computed_ch as (
  select
    c.round_participant_id,
    c.profile_id,
    c.handicap_index_computed,
    case
      when c.handicap_index_computed is null then null
      when (select slope from tee) is null then null
      when (select rating from tee) is null then null
      when (select par_total from tee) is null then null
      else
        round(
          (c.handicap_index_computed * ((select slope from tee) / 113.0))
          + ((select rating from tee) - (select par_total from tee))
        )
    end as course_handicap_computed
  from computed_hi c
),
used_vals as (
  -- Values actually applied for the round (typically populated for finished/accepted handicap rows)
  select
    hrr.participant_id as round_participant_id,
    hrr.handicap_index_used::numeric as handicap_index_used,
    hrr.course_handicap_used::numeric as course_handicap_used
  from handicap_round_results hrr
  where hrr.round_id = _round_id
)
select
  rp.id,
  rp.profile_id,
  rp.is_guest,
  rp.display_name,
  rp.role::text,
  rp.tee_snapshot_id,

  -- resolved: prefer used, fallback to computed
  coalesce(u.handicap_index_used, cc.handicap_index_computed) as handicap_index,
  coalesce(u.course_handicap_used, cc.course_handicap_computed) as course_handicap,

  -- both
  cc.handicap_index_computed,
  cc.course_handicap_computed,
  u.handicap_index_used,
  u.course_handicap_used,

  p.name,
  p.email,
  p.avatar_url
from round_participants rp
left join profiles p
  on p.id = rp.profile_id
left join computed_ch cc
  on cc.round_participant_id = rp.id
left join used_vals u
  on u.round_participant_id = rp.id
where rp.round_id = _round_id
order by rp.created_at asc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_round_setup_participants(_round_id uuid)
 RETURNS TABLE(id uuid, profile_id uuid, is_guest boolean, display_name text, role text, profile_name text, profile_email text, profile_avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    rp.id,
    rp.profile_id,
    rp.is_guest,
    rp.display_name,
    rp.role::text as role,
    p.name as profile_name,
    p.email as profile_email,
    p.avatar_url as profile_avatar_url
  from public.round_participants rp
  left join public.profiles p
    on p.id = rp.profile_id
  where rp.round_id = _round_id
  order by rp.created_at asc;
$function$
;

create or replace view "public"."hole_scoring_source" as  WITH latest AS (
         SELECT DISTINCT ON (rse.participant_id, rse.round_id, rse.hole_number) rse.participant_id,
            rse.round_id,
            rse.hole_number,
            rse.strokes
           FROM public.round_score_events rse
          WHERE (rse.strokes IS NOT NULL)
          ORDER BY rse.participant_id, rse.round_id, rse.hole_number, rse.created_at DESC, rse.id DESC
        )
 SELECT rp.profile_id,
    l.round_id,
    COALESCE(r.started_at, r.created_at) AS played_at,
    rcs.source_course_id AS course_id,
    rcs.course_name,
    rts.source_tee_box_id AS tee_box_id,
    rts.name AS tee_name,
    l.hole_number,
    rhs.par,
    rhs.yardage,
    rhs.stroke_index,
    l.strokes,
    (l.strokes - rhs.par) AS to_par,
    (l.strokes >= (rhs.par + 2)) AS is_double_plus,
    (l.strokes >= (rhs.par + 3)) AS is_triple_plus,
    hrr.handicap_index_used,
    hrr.course_handicap_used,
    public.ciaga_strokes_received_on_hole(hrr.course_handicap_used, rhs.stroke_index) AS strokes_received,
    (l.strokes - public.ciaga_strokes_received_on_hole(hrr.course_handicap_used, rhs.stroke_index)) AS net_strokes,
    ((l.strokes - public.ciaga_strokes_received_on_hole(hrr.course_handicap_used, rhs.stroke_index)) - rhs.par) AS net_to_par
   FROM ((((((latest l
     JOIN public.round_participants rp ON ((rp.id = l.participant_id)))
     JOIN public.rounds r ON ((r.id = l.round_id)))
     LEFT JOIN public.round_tee_snapshots rts ON ((rts.id = rp.tee_snapshot_id)))
     LEFT JOIN public.round_course_snapshots rcs ON ((rcs.id = rts.round_course_snapshot_id)))
     LEFT JOIN public.round_hole_snapshots rhs ON (((rhs.round_tee_snapshot_id = rts.id) AND (rhs.hole_number = l.hole_number))))
     LEFT JOIN public.handicap_round_results hrr ON (((hrr.round_id = l.round_id) AND (hrr.participant_id = rp.id))));


CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where owner_user_id = auth.uid()
      and is_admin = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_owner(_round_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.round_participants rp
    where rp.round_id = _round_id
      and rp.profile_id = public.my_profile_id()
      and rp.role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_owner(_round_id uuid, _uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.round_participants rp
    join public.profiles p on p.id = rp.profile_id
    where rp.round_id = _round_id
      and p.owner_user_id = _uid
      and rp.role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_participant(_round_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.round_participants rp
    where rp.round_id = _round_id
      and rp.profile_id = public.my_profile_id()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_participant(_round_id uuid, _uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.round_participants rp
    join public.profiles p on p.id = rp.profile_id
    where rp.round_id = _round_id
      and p.owner_user_id = _uid
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_scorer(_round_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select public.is_round_scorer(_round_id, auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.is_round_scorer(_round_id uuid, _uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.round_participants rp
    join public.profiles p on p.id = rp.profile_id
    where rp.round_id = _round_id
      and p.owner_user_id = _uid
      and rp.role in ('owner','scorer')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.mark_hole_completed_from_score_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.strokes is not null then
    update round_hole_states
       set status = 'completed',
           updated_at = now()
     where participant_id = new.participant_id
       and hole_number = new.hole_number
       and status <> 'picked_up';
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select public.owned_profile_id(auth.uid());
$function$
;

CREATE OR REPLACE FUNCTION public.owned_profile_id(_auth_uid uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  select p.id
  from public.profiles p
  where p.owner_user_id = _auth_uid
  limit 1;
$function$
;

create or replace view "public"."public_profiles" as  SELECT id,
    name,
    avatar_url,
    created_at
   FROM public.profiles p;


CREATE OR REPLACE FUNCTION public.recalc_handicap_profile(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$declare
  rec record;
  diffs numeric[];
  n int;
  k int;
  base_hi numeric;
  adj numeric;

  lhi numeric;
  capped_hi numeric;
  over_lhi numeric;
  soft_delta numeric;
  hard_delta numeric;

  v_version text;
begin
  v_version := ciaga_current_handicap_version();

  -- wipe and rebuild (CIAGA scale: simplest + correct)
  delete from handicap_index_history
  where profile_id = p_profile_id;

  for rec in
    select distinct played_at
    from ciaga_scoring_record_stream
    where profile_id = p_profile_id
    order by played_at
  loop
    -- pull up to last 20 differentials up to this date,
    -- then sort ascending so "lowest-of-N" is diffs[1:k]
    select array_agg(differential order by differential asc)
      into diffs
    from (
      select differential
      from ciaga_scoring_record_stream
      where profile_id = p_profile_id
        and played_at <= rec.played_at
      order by played_at desc
      limit 20
    ) x;

    n := coalesce(array_length(diffs, 1), 0);

    if n < 3 then
      -- not enough to form a HI yet
      insert into handicap_index_history(
        profile_id, as_of_date,
        handicap_index, low_handicap_index,
        soft_cap_delta, hard_cap_delta,
        esr_applied,
        calc_version, calculated_at
      )
      values (
        p_profile_id, rec.played_at,
        null, null,
        0, 0,
        0,
        v_version, now()
      );
      continue;
    end if;

    k := ciaga_lowest_of_n_count(n);
    adj := ciaga_hi_adjustment(n);

    -- base HI = avg(lowest k differentials) + adjustment, rounded to 1dp
    select round((avg(v) + adj), 1)
      into base_hi
    from (
      select unnest(diffs[1:k]) as v
    ) s;

    -- ✅ WHS max Handicap Index cap
    base_hi := least(54.0, base_hi);

    -- LHI = min HI in last 365 days up to this date (already computed rows)
    select min(handicap_index)
      into lhi
    from handicap_index_history
    where profile_id = p_profile_id
      and handicap_index is not null
      and as_of_date >= (rec.played_at - interval '365 days')::date
      and as_of_date <= rec.played_at;

    if lhi is null then
      -- first time we have a HI -> no cap (other than WHS 54.0)
      capped_hi := base_hi;
      soft_delta := 0;
      hard_delta := 0;
      lhi := capped_hi; -- start LHI
    else
      -- ✅ keep LHI within WHS max too (safety)
      lhi := least(54.0, lhi);

      over_lhi := base_hi - lhi;

      if over_lhi <= 3 then
        capped_hi := base_hi;

      elsif over_lhi <= 5 then
        -- soft cap: reduce excess above +3 by 50%
        capped_hi := round(lhi + 3 + ((over_lhi - 3) * 0.5), 1);

      else
        -- hard cap: max +5 over LHI
        capped_hi := round(lhi + 5, 1);
      end if;

      -- ✅ WHS max cap applied after soft/hard cap logic
      capped_hi := least(54.0, capped_hi);

      -- informational deltas (recomputed post-cap so they're always correct)
      soft_delta := round(greatest(0, base_hi - capped_hi), 1);
      hard_delta := round(greatest(0, base_hi - capped_hi), 1);
      -- Note: your original split between "soft" vs "hard" deltas was informational only;
      -- once we apply the 54 cap, the only truthful delta is base_hi - capped_hi.
    end if;

    -- ✅ final safety: ensure LHI stored doesn't exceed 54
    lhi := least(54.0, lhi);

    insert into handicap_index_history(
      profile_id, as_of_date,
      handicap_index, low_handicap_index,
      soft_cap_delta, hard_cap_delta,
      esr_applied,
      calc_version, calculated_at
    )
    values (
      p_profile_id, rec.played_at,
      capped_hi, lhi,
      soft_delta, hard_delta,
      0,
      v_version, now()
    );
  end loop;
end$function$
;

CREATE OR REPLACE FUNCTION public.recalc_profiles_when_round_finishes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare pid uuid;
begin
  if new.status = 'finished' and (old.status is distinct from new.status) then
    for pid in
      select distinct profile_id
      from round_participants
      where round_id = new.id
        and profile_id is not null
    loop
      perform recalc_handicap_profile(pid);
    end loop;
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.recompute_handicap_round(p_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare pid uuid;
begin
  for pid in
    select id from round_participants where round_id = p_round_id
  loop
    perform upsert_handicap_round_result(pid);
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.round0(x numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select round(x::numeric, 0);
$function$
;

CREATE OR REPLACE FUNCTION public.round1(x numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select round(x::numeric, 1);
$function$
;

create or replace view "public"."round_current_scores" as  SELECT DISTINCT ON (round_id, participant_id, hole_number) round_id,
    participant_id,
    hole_number,
    strokes,
    entered_by,
    created_at
   FROM public.round_score_events e
  ORDER BY round_id, participant_id, hole_number, created_at DESC, id DESC;


create or replace view "public"."round_current_totals" as  SELECT participant_id,
    (sum(strokes))::integer AS total_strokes,
    count(strokes) AS holes_with_scores
   FROM public.round_current_scores
  WHERE (strokes IS NOT NULL)
  GROUP BY participant_id;


CREATE OR REPLACE FUNCTION public.search_profiles_public(q text, lim integer DEFAULT 25)
 RETURNS TABLE(id uuid, name text, email text, avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    p.name,
    case when p.owner_user_id is null then null else p.email end as email,
    p.avatar_url
  from public.profiles p
  where
    (p.name ilike ('%' || q || '%'))
    or (p.email ilike ('%' || q || '%'))
  order by
    (p.name ilike (q || '%')) desc,
    p.name nulls last
  limit lim;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_round_hole_states()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  insert into round_hole_states (round_id, participant_id, hole_number, status)
  select new.round_id, new.id, gs, 'not_started'::hole_state
  from generate_series(1, 18) gs
  on conflict (participant_id, hole_number) do nothing;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_round_hole_status(p_participant_id uuid, p_hole_number integer, p_status public.hole_state)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare v_round_id uuid;
begin
  if p_hole_number < 1 or p_hole_number > 18 then
    raise exception 'hole_number must be between 1 and 18';
  end if;

  select round_id into v_round_id
  from round_participants
  where id = p_participant_id;

  if v_round_id is null then
    raise exception 'participant not found';
  end if;

  update round_hole_states
     set status = p_status,
         updated_at = now()
   where participant_id = p_participant_id
     and hole_number = p_hole_number;

  if not found then
    -- if states weren’t seeded for some reason, insert it
    insert into round_hole_states(round_id, participant_id, hole_number, status)
    values (v_round_id, p_participant_id, p_hole_number, p_status)
    on conflict (participant_id, hole_number) do update
      set status = excluded.status,
          updated_at = now();
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_course_name_from_override()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then
    update public.courses
      set name = new.name_override,
          updated_at = now()
    where id = new.course_id;
    return new;
  end if;

  if (tg_op = 'DELETE') then
    update public.courses c
      set name = coalesce(c.name_original, c.name),
          updated_at = now()
    where c.id = old.course_id;
    return old;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_round_hole_states_from_events(_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
declare
  tee_id uuid;
  holes_cnt int;
begin
  -- pick any participant tee snapshot for the round
  select rp.tee_snapshot_id into tee_id
  from round_participants rp
  where rp.round_id = _round_id
    and rp.tee_snapshot_id is not null
  limit 1;

  if tee_id is null then
    return;
  end if;

  select ts.holes_count into holes_cnt
  from round_tee_snapshots ts
  where ts.id = tee_id;

  if holes_cnt is null then
    holes_cnt := 18;
  end if;

  -- ensure rows exist for each participant + hole
  insert into round_hole_states (round_id, participant_id, hole_number, status)
  select
    rp.round_id,
    rp.id,
    gs.hole_number,
    'not_started'::text
  from round_participants rp
  cross join lateral (
    select generate_series(1, holes_cnt) as hole_number
  ) gs
  where rp.round_id = _round_id
  on conflict (participant_id, hole_number) do nothing;

  -- mark completed where latest event has strokes
  with latest as (
    select distinct on (participant_id, hole_number)
      participant_id,
      hole_number,
      strokes
    from round_score_events
    where round_id = _round_id
    order by participant_id, hole_number, created_at desc
  )
  update round_hole_states hs
  set status =
    case
      when l.strokes is null then 'not_started'
      else 'completed'
    end
  from latest l
  where hs.round_id = _round_id
    and hs.participant_id = l.participant_id
    and hs.hole_number = l.hole_number;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_handicap_round_result(p_participant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r record;
begin
  select * into r
  from compute_handicap_round_result(p_participant_id);

  insert into handicap_round_results (
    round_id, participant_id, profile_id,
    played_at, holes_started, holes_completed, is_9_hole,
    accepted, rejected_reason,
    handicap_index_used, course_handicap_used, tee_snapshot_id,
    adjusted_gross_score, score_differential, derived_from_9, pending_9,
    calc_version
  )
  values (
    r.round_id, r.participant_id, r.profile_id,
    r.played_at, r.holes_started, r.holes_completed, r.is_9_hole,
    r.accepted, r.rejected_reason,
    r.handicap_index_used, r.course_handicap_used, r.tee_snapshot_id,
    r.adjusted_gross_score, r.score_differential, r.derived_from_9, r.pending_9,
    ciaga_current_handicap_version()
  )
  on conflict (participant_id, round_id) do update set
    played_at = excluded.played_at,
    holes_started = excluded.holes_started,
    holes_completed = excluded.holes_completed,
    is_9_hole = excluded.is_9_hole,
    accepted = excluded.accepted,
    rejected_reason = excluded.rejected_reason,
    handicap_index_used = excluded.handicap_index_used,
    course_handicap_used = excluded.course_handicap_used,
    tee_snapshot_id = excluded.tee_snapshot_id,
    adjusted_gross_score = excluded.adjusted_gross_score,
    score_differential = excluded.score_differential,
    derived_from_9 = excluded.derived_from_9,
    pending_9 = excluded.pending_9,
    calc_version = ciaga_current_handicap_version(),
    calculated_at = now();
end $function$
;

create or replace view "public"."v_handicap_round_result_source" as  WITH base AS (
         SELECT rp.id AS participant_id,
            rp.round_id,
            rp.profile_id,
            rp.tee_snapshot_id,
            COALESCE(r.finished_at, r.started_at, r.created_at) AS played_at,
            rp.handicap_index AS handicap_index_used,
            ts.holes_count,
            ts.rating AS course_rating,
            ts.slope AS slope_rating,
            ts.par_total
           FROM ((public.round_participants rp
             JOIN public.rounds r ON ((r.id = rp.round_id)))
             LEFT JOIN public.round_tee_snapshots ts ON ((ts.id = rp.tee_snapshot_id)))
        ), hole_counts AS (
         SELECT b.participant_id,
            (count(DISTINCT rcs.hole_number))::integer AS holes_started,
            (count(DISTINCT rcs.hole_number) FILTER (WHERE (rcs.strokes IS NOT NULL)))::integer AS holes_completed
           FROM (base b
             LEFT JOIN public.round_current_scores rcs ON (((rcs.round_id = b.round_id) AND (rcs.participant_id = b.participant_id))))
          GROUP BY b.participant_id
        ), prepared AS (
         SELECT b.participant_id,
            b.round_id,
            b.profile_id,
            b.tee_snapshot_id,
            b.played_at,
            b.handicap_index_used,
            b.holes_count,
            b.course_rating,
            b.slope_rating,
            b.par_total,
            hc.holes_started,
            hc.holes_completed,
            (COALESCE(b.holes_count, 18) = 9) AS is_9_hole,
                CASE
                    WHEN (COALESCE(b.holes_count, 18) = 9) THEN (hc.holes_started >= 7)
                    ELSE (hc.holes_started >= 14)
                END AS accepted,
                CASE
                    WHEN ((COALESCE(b.holes_count, 18) = 9) AND (hc.holes_started < 7)) THEN (('acceptability_gate_failed: started '::text || hc.holes_started) || ' of 7'::text)
                    WHEN ((COALESCE(b.holes_count, 18) <> 9) AND (hc.holes_started < 14)) THEN (('acceptability_gate_failed: started '::text || hc.holes_started) || ' of 14'::text)
                    ELSE NULL::text
                END AS rejected_reason,
                CASE
                    WHEN (b.handicap_index_used IS NULL) THEN 54
                    WHEN ((b.slope_rating IS NULL) OR (b.course_rating IS NULL) OR (b.par_total IS NULL)) THEN NULL::integer
                    ELSE (round((((b.handicap_index_used * (b.slope_rating)::numeric) / 113.0) + (b.course_rating - (b.par_total)::numeric))))::integer
                END AS course_handicap_used
           FROM (base b
             JOIN hole_counts hc USING (participant_id))
        ), ags_calc AS (
         SELECT p.participant_id,
                CASE
                    WHEN p.accepted THEN ( SELECT (sum(x.adjusted_score))::integer AS sum
                       FROM ( SELECT hs.hole_number,
                                hs.par,
                                hs.stroke_index,
                                rcs.strokes AS raw_score,
                                    CASE
WHEN (rcs.hole_number IS NULL) THEN 'not_started'::text
WHEN (rcs.strokes IS NULL) THEN 'picked_up'::text
ELSE 'completed'::text
                                    END AS hole_status,
                                ((floor(((p.course_handicap_used)::numeric / (18)::numeric)))::integer +
                                    CASE
WHEN (((p.course_handicap_used % 18) > 0) AND (hs.stroke_index <= (p.course_handicap_used % 18))) THEN 1
ELSE 0
                                    END) AS strokes_received,
                                    CASE
WHEN (rcs.hole_number IS NULL) THEN (hs.par + ((floor(((p.course_handicap_used)::numeric / (18)::numeric)))::integer +
CASE
 WHEN (((p.course_handicap_used % 18) > 0) AND (hs.stroke_index <= (p.course_handicap_used % 18))) THEN 1
 ELSE 0
END))
WHEN (rcs.strokes IS NULL) THEN ((hs.par + 2) + ((floor(((p.course_handicap_used)::numeric / (18)::numeric)))::integer +
CASE
 WHEN (((p.course_handicap_used % 18) > 0) AND (hs.stroke_index <= (p.course_handicap_used % 18))) THEN 1
 ELSE 0
END))
ELSE LEAST(rcs.strokes, ((hs.par + 2) + ((floor(((p.course_handicap_used)::numeric / (18)::numeric)))::integer +
CASE
 WHEN (((p.course_handicap_used % 18) > 0) AND (hs.stroke_index <= (p.course_handicap_used % 18))) THEN 1
 ELSE 0
END)))
                                    END AS adjusted_score
                               FROM (public.round_hole_snapshots hs
                                 LEFT JOIN public.round_current_scores rcs ON (((rcs.round_id = p.round_id) AND (rcs.participant_id = p.participant_id) AND (rcs.hole_number = hs.hole_number))))
                              WHERE (hs.round_tee_snapshot_id = p.tee_snapshot_id)) x)
                    ELSE NULL::integer
                END AS adjusted_gross_score
           FROM prepared p
        ), final AS (
         SELECT p.round_id,
            p.participant_id,
            p.profile_id,
            p.played_at,
            p.holes_started,
            p.holes_completed,
            p.is_9_hole,
            p.accepted,
            p.rejected_reason,
            p.handicap_index_used,
            p.course_handicap_used,
            p.tee_snapshot_id,
            a.adjusted_gross_score,
            (p.accepted AND p.is_9_hole AND (p.handicap_index_used IS NULL)) AS pending_9,
            (p.accepted AND p.is_9_hole AND (p.handicap_index_used IS NOT NULL)) AS derived_from_9,
                CASE
                    WHEN (NOT p.accepted) THEN NULL::numeric
                    WHEN (p.is_9_hole AND (p.handicap_index_used IS NULL)) THEN NULL::numeric
                    WHEN (p.is_9_hole AND (p.handicap_index_used IS NOT NULL)) THEN public.round1((public.round1(((((a.adjusted_gross_score)::numeric - p.course_rating) * 113.0) / (NULLIF(p.slope_rating, 0))::numeric)) + public.round1(((p.handicap_index_used * 0.52) + 1.2))))
                    ELSE public.round1(((((a.adjusted_gross_score)::numeric - p.course_rating) * 113.0) / (NULLIF(p.slope_rating, 0))::numeric))
                END AS score_differential
           FROM (prepared p
             LEFT JOIN ags_calc a ON ((a.participant_id = p.participant_id)))
        )
 SELECT round_id,
    participant_id,
    profile_id,
    played_at,
    holes_started,
    holes_completed,
    is_9_hole,
    accepted,
    rejected_reason,
    handicap_index_used,
    course_handicap_used,
    tee_snapshot_id,
    adjusted_gross_score,
    pending_9,
    derived_from_9,
    score_differential
   FROM final;


create or replace view "public"."v_course_record_rounds" as  WITH base AS (
         SELECT v.round_id,
            v.participant_id,
            v.profile_id,
            v.played_at,
            v.accepted,
            v.is_9_hole,
            v.holes_completed,
            v.tee_snapshot_id,
            v.adjusted_gross_score,
            v.course_handicap_used
           FROM public.v_handicap_round_result_source v
          WHERE (v.accepted = true)
        ), snap AS (
         SELECT b.round_id,
            b.participant_id,
            b.profile_id,
            b.played_at,
            b.accepted,
            b.is_9_hole,
            b.holes_completed,
            b.tee_snapshot_id,
            b.adjusted_gross_score,
            b.course_handicap_used,
            rts.source_tee_box_id AS tee_box_id,
            rts.name AS tee_name,
            rts.holes_count,
            rts.par_total AS tee_par_total,
            rcs.source_course_id AS course_id,
            rcs.course_name
           FROM ((base b
             JOIN public.round_tee_snapshots rts ON ((rts.id = b.tee_snapshot_id)))
             JOIN public.round_course_snapshots rcs ON ((rcs.id = rts.round_course_snapshot_id)))
        ), gross AS (
         SELECT s_1.participant_id,
            s_1.round_id,
            (sum(rcs.strokes))::integer AS gross_score
           FROM ((snap s_1
             JOIN public.round_hole_snapshots rhs ON ((rhs.round_tee_snapshot_id = s_1.tee_snapshot_id)))
             LEFT JOIN public.round_current_scores rcs ON (((rcs.round_id = s_1.round_id) AND (rcs.participant_id = s_1.participant_id) AND (rcs.hole_number = rhs.hole_number))))
          GROUP BY s_1.participant_id, s_1.round_id
        )
 SELECT s.round_id,
    s.participant_id,
    s.profile_id,
    s.played_at,
    s.course_id,
    s.course_name,
    s.tee_box_id,
    s.tee_name,
    s.tee_snapshot_id,
    s.holes_count,
    s.tee_par_total AS par_total,
    (s.holes_completed = s.holes_count) AS is_complete,
        CASE
            WHEN (s.holes_completed = s.holes_count) THEN g.gross_score
            ELSE NULL::integer
        END AS gross_score,
    s.adjusted_gross_score,
    s.course_handicap_used,
        CASE
            WHEN ((s.adjusted_gross_score IS NOT NULL) AND (s.course_handicap_used IS NOT NULL)) THEN (s.adjusted_gross_score - s.course_handicap_used)
            ELSE NULL::integer
        END AS net_score
   FROM (snap s
     LEFT JOIN gross g ON (((g.round_id = s.round_id) AND (g.participant_id = s.participant_id))));


grant delete on table "public"."ciaga_dump_columns" to "anon";

grant insert on table "public"."ciaga_dump_columns" to "anon";

grant references on table "public"."ciaga_dump_columns" to "anon";

grant select on table "public"."ciaga_dump_columns" to "anon";

grant trigger on table "public"."ciaga_dump_columns" to "anon";

grant truncate on table "public"."ciaga_dump_columns" to "anon";

grant update on table "public"."ciaga_dump_columns" to "anon";

grant delete on table "public"."ciaga_dump_columns" to "authenticated";

grant insert on table "public"."ciaga_dump_columns" to "authenticated";

grant references on table "public"."ciaga_dump_columns" to "authenticated";

grant select on table "public"."ciaga_dump_columns" to "authenticated";

grant trigger on table "public"."ciaga_dump_columns" to "authenticated";

grant truncate on table "public"."ciaga_dump_columns" to "authenticated";

grant update on table "public"."ciaga_dump_columns" to "authenticated";

grant delete on table "public"."ciaga_dump_columns" to "service_role";

grant insert on table "public"."ciaga_dump_columns" to "service_role";

grant references on table "public"."ciaga_dump_columns" to "service_role";

grant select on table "public"."ciaga_dump_columns" to "service_role";

grant trigger on table "public"."ciaga_dump_columns" to "service_role";

grant truncate on table "public"."ciaga_dump_columns" to "service_role";

grant update on table "public"."ciaga_dump_columns" to "service_role";

grant delete on table "public"."ciaga_dump_foreign_keys" to "anon";

grant insert on table "public"."ciaga_dump_foreign_keys" to "anon";

grant references on table "public"."ciaga_dump_foreign_keys" to "anon";

grant select on table "public"."ciaga_dump_foreign_keys" to "anon";

grant trigger on table "public"."ciaga_dump_foreign_keys" to "anon";

grant truncate on table "public"."ciaga_dump_foreign_keys" to "anon";

grant update on table "public"."ciaga_dump_foreign_keys" to "anon";

grant delete on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant insert on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant references on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant select on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant trigger on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant truncate on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant update on table "public"."ciaga_dump_foreign_keys" to "authenticated";

grant delete on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant insert on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant references on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant select on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant trigger on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant truncate on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant update on table "public"."ciaga_dump_foreign_keys" to "service_role";

grant delete on table "public"."ciaga_dump_objects" to "anon";

grant insert on table "public"."ciaga_dump_objects" to "anon";

grant references on table "public"."ciaga_dump_objects" to "anon";

grant select on table "public"."ciaga_dump_objects" to "anon";

grant trigger on table "public"."ciaga_dump_objects" to "anon";

grant truncate on table "public"."ciaga_dump_objects" to "anon";

grant update on table "public"."ciaga_dump_objects" to "anon";

grant delete on table "public"."ciaga_dump_objects" to "authenticated";

grant insert on table "public"."ciaga_dump_objects" to "authenticated";

grant references on table "public"."ciaga_dump_objects" to "authenticated";

grant select on table "public"."ciaga_dump_objects" to "authenticated";

grant trigger on table "public"."ciaga_dump_objects" to "authenticated";

grant truncate on table "public"."ciaga_dump_objects" to "authenticated";

grant update on table "public"."ciaga_dump_objects" to "authenticated";

grant delete on table "public"."ciaga_dump_objects" to "service_role";

grant insert on table "public"."ciaga_dump_objects" to "service_role";

grant references on table "public"."ciaga_dump_objects" to "service_role";

grant select on table "public"."ciaga_dump_objects" to "service_role";

grant trigger on table "public"."ciaga_dump_objects" to "service_role";

grant truncate on table "public"."ciaga_dump_objects" to "service_role";

grant update on table "public"."ciaga_dump_objects" to "service_role";

grant delete on table "public"."ciaga_dump_samples" to "anon";

grant insert on table "public"."ciaga_dump_samples" to "anon";

grant references on table "public"."ciaga_dump_samples" to "anon";

grant select on table "public"."ciaga_dump_samples" to "anon";

grant trigger on table "public"."ciaga_dump_samples" to "anon";

grant truncate on table "public"."ciaga_dump_samples" to "anon";

grant update on table "public"."ciaga_dump_samples" to "anon";

grant delete on table "public"."ciaga_dump_samples" to "authenticated";

grant insert on table "public"."ciaga_dump_samples" to "authenticated";

grant references on table "public"."ciaga_dump_samples" to "authenticated";

grant select on table "public"."ciaga_dump_samples" to "authenticated";

grant trigger on table "public"."ciaga_dump_samples" to "authenticated";

grant truncate on table "public"."ciaga_dump_samples" to "authenticated";

grant update on table "public"."ciaga_dump_samples" to "authenticated";

grant delete on table "public"."ciaga_dump_samples" to "service_role";

grant insert on table "public"."ciaga_dump_samples" to "service_role";

grant references on table "public"."ciaga_dump_samples" to "service_role";

grant select on table "public"."ciaga_dump_samples" to "service_role";

grant trigger on table "public"."ciaga_dump_samples" to "service_role";

grant truncate on table "public"."ciaga_dump_samples" to "service_role";

grant update on table "public"."ciaga_dump_samples" to "service_role";

grant delete on table "public"."ciaga_dump_views" to "anon";

grant insert on table "public"."ciaga_dump_views" to "anon";

grant references on table "public"."ciaga_dump_views" to "anon";

grant select on table "public"."ciaga_dump_views" to "anon";

grant trigger on table "public"."ciaga_dump_views" to "anon";

grant truncate on table "public"."ciaga_dump_views" to "anon";

grant update on table "public"."ciaga_dump_views" to "anon";

grant delete on table "public"."ciaga_dump_views" to "authenticated";

grant insert on table "public"."ciaga_dump_views" to "authenticated";

grant references on table "public"."ciaga_dump_views" to "authenticated";

grant select on table "public"."ciaga_dump_views" to "authenticated";

grant trigger on table "public"."ciaga_dump_views" to "authenticated";

grant truncate on table "public"."ciaga_dump_views" to "authenticated";

grant update on table "public"."ciaga_dump_views" to "authenticated";

grant delete on table "public"."ciaga_dump_views" to "service_role";

grant insert on table "public"."ciaga_dump_views" to "service_role";

grant references on table "public"."ciaga_dump_views" to "service_role";

grant select on table "public"."ciaga_dump_views" to "service_role";

grant trigger on table "public"."ciaga_dump_views" to "service_role";

grant truncate on table "public"."ciaga_dump_views" to "service_role";

grant update on table "public"."ciaga_dump_views" to "service_role";

grant references on table "public"."ciaga_system_settings" to "anon";

grant select on table "public"."ciaga_system_settings" to "anon";

grant trigger on table "public"."ciaga_system_settings" to "anon";

grant delete on table "public"."ciaga_system_settings" to "authenticated";

grant insert on table "public"."ciaga_system_settings" to "authenticated";

grant references on table "public"."ciaga_system_settings" to "authenticated";

grant select on table "public"."ciaga_system_settings" to "authenticated";

grant trigger on table "public"."ciaga_system_settings" to "authenticated";

grant truncate on table "public"."ciaga_system_settings" to "authenticated";

grant update on table "public"."ciaga_system_settings" to "authenticated";

grant delete on table "public"."ciaga_system_settings" to "service_role";

grant insert on table "public"."ciaga_system_settings" to "service_role";

grant references on table "public"."ciaga_system_settings" to "service_role";

grant select on table "public"."ciaga_system_settings" to "service_role";

grant trigger on table "public"."ciaga_system_settings" to "service_role";

grant truncate on table "public"."ciaga_system_settings" to "service_role";

grant update on table "public"."ciaga_system_settings" to "service_role";

grant references on table "public"."competition_entries" to "anon";

grant select on table "public"."competition_entries" to "anon";

grant trigger on table "public"."competition_entries" to "anon";

grant delete on table "public"."competition_entries" to "authenticated";

grant insert on table "public"."competition_entries" to "authenticated";

grant references on table "public"."competition_entries" to "authenticated";

grant select on table "public"."competition_entries" to "authenticated";

grant trigger on table "public"."competition_entries" to "authenticated";

grant truncate on table "public"."competition_entries" to "authenticated";

grant update on table "public"."competition_entries" to "authenticated";

grant delete on table "public"."competition_entries" to "service_role";

grant insert on table "public"."competition_entries" to "service_role";

grant references on table "public"."competition_entries" to "service_role";

grant select on table "public"."competition_entries" to "service_role";

grant trigger on table "public"."competition_entries" to "service_role";

grant truncate on table "public"."competition_entries" to "service_role";

grant update on table "public"."competition_entries" to "service_role";

grant references on table "public"."competitions" to "anon";

grant select on table "public"."competitions" to "anon";

grant trigger on table "public"."competitions" to "anon";

grant delete on table "public"."competitions" to "authenticated";

grant insert on table "public"."competitions" to "authenticated";

grant references on table "public"."competitions" to "authenticated";

grant select on table "public"."competitions" to "authenticated";

grant trigger on table "public"."competitions" to "authenticated";

grant truncate on table "public"."competitions" to "authenticated";

grant update on table "public"."competitions" to "authenticated";

grant delete on table "public"."competitions" to "service_role";

grant insert on table "public"."competitions" to "service_role";

grant references on table "public"."competitions" to "service_role";

grant select on table "public"."competitions" to "service_role";

grant trigger on table "public"."competitions" to "service_role";

grant truncate on table "public"."competitions" to "service_role";

grant update on table "public"."competitions" to "service_role";

grant references on table "public"."course_tee_boxes" to "anon";

grant select on table "public"."course_tee_boxes" to "anon";

grant trigger on table "public"."course_tee_boxes" to "anon";

grant delete on table "public"."course_tee_boxes" to "authenticated";

grant insert on table "public"."course_tee_boxes" to "authenticated";

grant references on table "public"."course_tee_boxes" to "authenticated";

grant select on table "public"."course_tee_boxes" to "authenticated";

grant trigger on table "public"."course_tee_boxes" to "authenticated";

grant truncate on table "public"."course_tee_boxes" to "authenticated";

grant update on table "public"."course_tee_boxes" to "authenticated";

grant delete on table "public"."course_tee_boxes" to "service_role";

grant insert on table "public"."course_tee_boxes" to "service_role";

grant references on table "public"."course_tee_boxes" to "service_role";

grant select on table "public"."course_tee_boxes" to "service_role";

grant trigger on table "public"."course_tee_boxes" to "service_role";

grant truncate on table "public"."course_tee_boxes" to "service_role";

grant update on table "public"."course_tee_boxes" to "service_role";

grant references on table "public"."course_tee_holes" to "anon";

grant select on table "public"."course_tee_holes" to "anon";

grant trigger on table "public"."course_tee_holes" to "anon";

grant delete on table "public"."course_tee_holes" to "authenticated";

grant insert on table "public"."course_tee_holes" to "authenticated";

grant references on table "public"."course_tee_holes" to "authenticated";

grant select on table "public"."course_tee_holes" to "authenticated";

grant trigger on table "public"."course_tee_holes" to "authenticated";

grant truncate on table "public"."course_tee_holes" to "authenticated";

grant update on table "public"."course_tee_holes" to "authenticated";

grant delete on table "public"."course_tee_holes" to "service_role";

grant insert on table "public"."course_tee_holes" to "service_role";

grant references on table "public"."course_tee_holes" to "service_role";

grant select on table "public"."course_tee_holes" to "service_role";

grant trigger on table "public"."course_tee_holes" to "service_role";

grant truncate on table "public"."course_tee_holes" to "service_role";

grant update on table "public"."course_tee_holes" to "service_role";

grant references on table "public"."courses" to "anon";

grant select on table "public"."courses" to "anon";

grant trigger on table "public"."courses" to "anon";

grant delete on table "public"."courses" to "authenticated";

grant insert on table "public"."courses" to "authenticated";

grant references on table "public"."courses" to "authenticated";

grant select on table "public"."courses" to "authenticated";

grant trigger on table "public"."courses" to "authenticated";

grant truncate on table "public"."courses" to "authenticated";

grant update on table "public"."courses" to "authenticated";

grant delete on table "public"."courses" to "service_role";

grant insert on table "public"."courses" to "service_role";

grant references on table "public"."courses" to "service_role";

grant select on table "public"."courses" to "service_role";

grant trigger on table "public"."courses" to "service_role";

grant truncate on table "public"."courses" to "service_role";

grant update on table "public"."courses" to "service_role";

grant delete on table "public"."feed_comments" to "anon";

grant insert on table "public"."feed_comments" to "anon";

grant references on table "public"."feed_comments" to "anon";

grant select on table "public"."feed_comments" to "anon";

grant trigger on table "public"."feed_comments" to "anon";

grant truncate on table "public"."feed_comments" to "anon";

grant update on table "public"."feed_comments" to "anon";

grant delete on table "public"."feed_comments" to "authenticated";

grant insert on table "public"."feed_comments" to "authenticated";

grant references on table "public"."feed_comments" to "authenticated";

grant select on table "public"."feed_comments" to "authenticated";

grant trigger on table "public"."feed_comments" to "authenticated";

grant truncate on table "public"."feed_comments" to "authenticated";

grant update on table "public"."feed_comments" to "authenticated";

grant delete on table "public"."feed_comments" to "service_role";

grant insert on table "public"."feed_comments" to "service_role";

grant references on table "public"."feed_comments" to "service_role";

grant select on table "public"."feed_comments" to "service_role";

grant trigger on table "public"."feed_comments" to "service_role";

grant truncate on table "public"."feed_comments" to "service_role";

grant update on table "public"."feed_comments" to "service_role";

grant delete on table "public"."feed_item_targets" to "anon";

grant insert on table "public"."feed_item_targets" to "anon";

grant references on table "public"."feed_item_targets" to "anon";

grant select on table "public"."feed_item_targets" to "anon";

grant trigger on table "public"."feed_item_targets" to "anon";

grant truncate on table "public"."feed_item_targets" to "anon";

grant update on table "public"."feed_item_targets" to "anon";

grant delete on table "public"."feed_item_targets" to "authenticated";

grant insert on table "public"."feed_item_targets" to "authenticated";

grant references on table "public"."feed_item_targets" to "authenticated";

grant select on table "public"."feed_item_targets" to "authenticated";

grant trigger on table "public"."feed_item_targets" to "authenticated";

grant truncate on table "public"."feed_item_targets" to "authenticated";

grant update on table "public"."feed_item_targets" to "authenticated";

grant delete on table "public"."feed_item_targets" to "service_role";

grant insert on table "public"."feed_item_targets" to "service_role";

grant references on table "public"."feed_item_targets" to "service_role";

grant select on table "public"."feed_item_targets" to "service_role";

grant trigger on table "public"."feed_item_targets" to "service_role";

grant truncate on table "public"."feed_item_targets" to "service_role";

grant update on table "public"."feed_item_targets" to "service_role";

grant delete on table "public"."feed_items" to "anon";

grant insert on table "public"."feed_items" to "anon";

grant references on table "public"."feed_items" to "anon";

grant select on table "public"."feed_items" to "anon";

grant trigger on table "public"."feed_items" to "anon";

grant truncate on table "public"."feed_items" to "anon";

grant update on table "public"."feed_items" to "anon";

grant delete on table "public"."feed_items" to "authenticated";

grant insert on table "public"."feed_items" to "authenticated";

grant references on table "public"."feed_items" to "authenticated";

grant select on table "public"."feed_items" to "authenticated";

grant trigger on table "public"."feed_items" to "authenticated";

grant truncate on table "public"."feed_items" to "authenticated";

grant update on table "public"."feed_items" to "authenticated";

grant delete on table "public"."feed_items" to "service_role";

grant insert on table "public"."feed_items" to "service_role";

grant references on table "public"."feed_items" to "service_role";

grant select on table "public"."feed_items" to "service_role";

grant trigger on table "public"."feed_items" to "service_role";

grant truncate on table "public"."feed_items" to "service_role";

grant update on table "public"."feed_items" to "service_role";

grant delete on table "public"."feed_reactions" to "anon";

grant insert on table "public"."feed_reactions" to "anon";

grant references on table "public"."feed_reactions" to "anon";

grant select on table "public"."feed_reactions" to "anon";

grant trigger on table "public"."feed_reactions" to "anon";

grant truncate on table "public"."feed_reactions" to "anon";

grant update on table "public"."feed_reactions" to "anon";

grant delete on table "public"."feed_reactions" to "authenticated";

grant insert on table "public"."feed_reactions" to "authenticated";

grant references on table "public"."feed_reactions" to "authenticated";

grant select on table "public"."feed_reactions" to "authenticated";

grant trigger on table "public"."feed_reactions" to "authenticated";

grant truncate on table "public"."feed_reactions" to "authenticated";

grant update on table "public"."feed_reactions" to "authenticated";

grant delete on table "public"."feed_reactions" to "service_role";

grant insert on table "public"."feed_reactions" to "service_role";

grant references on table "public"."feed_reactions" to "service_role";

grant select on table "public"."feed_reactions" to "service_role";

grant trigger on table "public"."feed_reactions" to "service_role";

grant truncate on table "public"."feed_reactions" to "service_role";

grant update on table "public"."feed_reactions" to "service_role";

grant delete on table "public"."feed_reports" to "anon";

grant insert on table "public"."feed_reports" to "anon";

grant references on table "public"."feed_reports" to "anon";

grant select on table "public"."feed_reports" to "anon";

grant trigger on table "public"."feed_reports" to "anon";

grant truncate on table "public"."feed_reports" to "anon";

grant update on table "public"."feed_reports" to "anon";

grant delete on table "public"."feed_reports" to "authenticated";

grant insert on table "public"."feed_reports" to "authenticated";

grant references on table "public"."feed_reports" to "authenticated";

grant select on table "public"."feed_reports" to "authenticated";

grant trigger on table "public"."feed_reports" to "authenticated";

grant truncate on table "public"."feed_reports" to "authenticated";

grant update on table "public"."feed_reports" to "authenticated";

grant delete on table "public"."feed_reports" to "service_role";

grant insert on table "public"."feed_reports" to "service_role";

grant references on table "public"."feed_reports" to "service_role";

grant select on table "public"."feed_reports" to "service_role";

grant trigger on table "public"."feed_reports" to "service_role";

grant truncate on table "public"."feed_reports" to "service_role";

grant update on table "public"."feed_reports" to "service_role";

grant references on table "public"."follows" to "anon";

grant select on table "public"."follows" to "anon";

grant trigger on table "public"."follows" to "anon";

grant delete on table "public"."follows" to "authenticated";

grant insert on table "public"."follows" to "authenticated";

grant references on table "public"."follows" to "authenticated";

grant select on table "public"."follows" to "authenticated";

grant trigger on table "public"."follows" to "authenticated";

grant truncate on table "public"."follows" to "authenticated";

grant update on table "public"."follows" to "authenticated";

grant delete on table "public"."follows" to "service_role";

grant insert on table "public"."follows" to "service_role";

grant references on table "public"."follows" to "service_role";

grant select on table "public"."follows" to "service_role";

grant trigger on table "public"."follows" to "service_role";

grant truncate on table "public"."follows" to "service_role";

grant update on table "public"."follows" to "service_role";

grant references on table "public"."handicap_index_history" to "anon";

grant select on table "public"."handicap_index_history" to "anon";

grant trigger on table "public"."handicap_index_history" to "anon";

grant delete on table "public"."handicap_index_history" to "authenticated";

grant insert on table "public"."handicap_index_history" to "authenticated";

grant references on table "public"."handicap_index_history" to "authenticated";

grant select on table "public"."handicap_index_history" to "authenticated";

grant trigger on table "public"."handicap_index_history" to "authenticated";

grant truncate on table "public"."handicap_index_history" to "authenticated";

grant update on table "public"."handicap_index_history" to "authenticated";

grant delete on table "public"."handicap_index_history" to "service_role";

grant insert on table "public"."handicap_index_history" to "service_role";

grant references on table "public"."handicap_index_history" to "service_role";

grant select on table "public"."handicap_index_history" to "service_role";

grant trigger on table "public"."handicap_index_history" to "service_role";

grant truncate on table "public"."handicap_index_history" to "service_role";

grant update on table "public"."handicap_index_history" to "service_role";

grant references on table "public"."handicap_round_results" to "anon";

grant select on table "public"."handicap_round_results" to "anon";

grant trigger on table "public"."handicap_round_results" to "anon";

grant delete on table "public"."handicap_round_results" to "authenticated";

grant insert on table "public"."handicap_round_results" to "authenticated";

grant references on table "public"."handicap_round_results" to "authenticated";

grant select on table "public"."handicap_round_results" to "authenticated";

grant trigger on table "public"."handicap_round_results" to "authenticated";

grant truncate on table "public"."handicap_round_results" to "authenticated";

grant update on table "public"."handicap_round_results" to "authenticated";

grant delete on table "public"."handicap_round_results" to "service_role";

grant insert on table "public"."handicap_round_results" to "service_role";

grant references on table "public"."handicap_round_results" to "service_role";

grant select on table "public"."handicap_round_results" to "service_role";

grant trigger on table "public"."handicap_round_results" to "service_role";

grant truncate on table "public"."handicap_round_results" to "service_role";

grant update on table "public"."handicap_round_results" to "service_role";

grant references on table "public"."invites" to "anon";

grant select on table "public"."invites" to "anon";

grant trigger on table "public"."invites" to "anon";

grant delete on table "public"."invites" to "authenticated";

grant insert on table "public"."invites" to "authenticated";

grant references on table "public"."invites" to "authenticated";

grant select on table "public"."invites" to "authenticated";

grant trigger on table "public"."invites" to "authenticated";

grant truncate on table "public"."invites" to "authenticated";

grant update on table "public"."invites" to "authenticated";

grant delete on table "public"."invites" to "service_role";

grant insert on table "public"."invites" to "service_role";

grant references on table "public"."invites" to "service_role";

grant select on table "public"."invites" to "service_role";

grant trigger on table "public"."invites" to "service_role";

grant truncate on table "public"."invites" to "service_role";

grant update on table "public"."invites" to "service_role";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant references on table "public"."round_course_snapshots" to "anon";

grant select on table "public"."round_course_snapshots" to "anon";

grant trigger on table "public"."round_course_snapshots" to "anon";

grant delete on table "public"."round_course_snapshots" to "authenticated";

grant insert on table "public"."round_course_snapshots" to "authenticated";

grant references on table "public"."round_course_snapshots" to "authenticated";

grant select on table "public"."round_course_snapshots" to "authenticated";

grant trigger on table "public"."round_course_snapshots" to "authenticated";

grant truncate on table "public"."round_course_snapshots" to "authenticated";

grant update on table "public"."round_course_snapshots" to "authenticated";

grant delete on table "public"."round_course_snapshots" to "service_role";

grant insert on table "public"."round_course_snapshots" to "service_role";

grant references on table "public"."round_course_snapshots" to "service_role";

grant select on table "public"."round_course_snapshots" to "service_role";

grant trigger on table "public"."round_course_snapshots" to "service_role";

grant truncate on table "public"."round_course_snapshots" to "service_role";

grant update on table "public"."round_course_snapshots" to "service_role";

grant references on table "public"."round_hole_snapshots" to "anon";

grant select on table "public"."round_hole_snapshots" to "anon";

grant trigger on table "public"."round_hole_snapshots" to "anon";

grant delete on table "public"."round_hole_snapshots" to "authenticated";

grant insert on table "public"."round_hole_snapshots" to "authenticated";

grant references on table "public"."round_hole_snapshots" to "authenticated";

grant select on table "public"."round_hole_snapshots" to "authenticated";

grant trigger on table "public"."round_hole_snapshots" to "authenticated";

grant truncate on table "public"."round_hole_snapshots" to "authenticated";

grant update on table "public"."round_hole_snapshots" to "authenticated";

grant delete on table "public"."round_hole_snapshots" to "service_role";

grant insert on table "public"."round_hole_snapshots" to "service_role";

grant references on table "public"."round_hole_snapshots" to "service_role";

grant select on table "public"."round_hole_snapshots" to "service_role";

grant trigger on table "public"."round_hole_snapshots" to "service_role";

grant truncate on table "public"."round_hole_snapshots" to "service_role";

grant update on table "public"."round_hole_snapshots" to "service_role";

grant references on table "public"."round_hole_states" to "anon";

grant select on table "public"."round_hole_states" to "anon";

grant trigger on table "public"."round_hole_states" to "anon";

grant delete on table "public"."round_hole_states" to "authenticated";

grant insert on table "public"."round_hole_states" to "authenticated";

grant references on table "public"."round_hole_states" to "authenticated";

grant select on table "public"."round_hole_states" to "authenticated";

grant trigger on table "public"."round_hole_states" to "authenticated";

grant truncate on table "public"."round_hole_states" to "authenticated";

grant update on table "public"."round_hole_states" to "authenticated";

grant delete on table "public"."round_hole_states" to "service_role";

grant insert on table "public"."round_hole_states" to "service_role";

grant references on table "public"."round_hole_states" to "service_role";

grant select on table "public"."round_hole_states" to "service_role";

grant trigger on table "public"."round_hole_states" to "service_role";

grant truncate on table "public"."round_hole_states" to "service_role";

grant update on table "public"."round_hole_states" to "service_role";

grant references on table "public"."round_participants" to "anon";

grant select on table "public"."round_participants" to "anon";

grant trigger on table "public"."round_participants" to "anon";

grant delete on table "public"."round_participants" to "authenticated";

grant insert on table "public"."round_participants" to "authenticated";

grant references on table "public"."round_participants" to "authenticated";

grant select on table "public"."round_participants" to "authenticated";

grant trigger on table "public"."round_participants" to "authenticated";

grant truncate on table "public"."round_participants" to "authenticated";

grant update on table "public"."round_participants" to "authenticated";

grant delete on table "public"."round_participants" to "service_role";

grant insert on table "public"."round_participants" to "service_role";

grant references on table "public"."round_participants" to "service_role";

grant select on table "public"."round_participants" to "service_role";

grant trigger on table "public"."round_participants" to "service_role";

grant truncate on table "public"."round_participants" to "service_role";

grant update on table "public"."round_participants" to "service_role";

grant references on table "public"."round_score_events" to "anon";

grant select on table "public"."round_score_events" to "anon";

grant trigger on table "public"."round_score_events" to "anon";

grant insert on table "public"."round_score_events" to "authenticated";

grant references on table "public"."round_score_events" to "authenticated";

grant select on table "public"."round_score_events" to "authenticated";

grant trigger on table "public"."round_score_events" to "authenticated";

grant truncate on table "public"."round_score_events" to "authenticated";

grant delete on table "public"."round_score_events" to "service_role";

grant insert on table "public"."round_score_events" to "service_role";

grant references on table "public"."round_score_events" to "service_role";

grant select on table "public"."round_score_events" to "service_role";

grant trigger on table "public"."round_score_events" to "service_role";

grant truncate on table "public"."round_score_events" to "service_role";

grant update on table "public"."round_score_events" to "service_role";

grant references on table "public"."round_tee_snapshots" to "anon";

grant select on table "public"."round_tee_snapshots" to "anon";

grant trigger on table "public"."round_tee_snapshots" to "anon";

grant delete on table "public"."round_tee_snapshots" to "authenticated";

grant insert on table "public"."round_tee_snapshots" to "authenticated";

grant references on table "public"."round_tee_snapshots" to "authenticated";

grant select on table "public"."round_tee_snapshots" to "authenticated";

grant trigger on table "public"."round_tee_snapshots" to "authenticated";

grant truncate on table "public"."round_tee_snapshots" to "authenticated";

grant update on table "public"."round_tee_snapshots" to "authenticated";

grant delete on table "public"."round_tee_snapshots" to "service_role";

grant insert on table "public"."round_tee_snapshots" to "service_role";

grant references on table "public"."round_tee_snapshots" to "service_role";

grant select on table "public"."round_tee_snapshots" to "service_role";

grant trigger on table "public"."round_tee_snapshots" to "service_role";

grant truncate on table "public"."round_tee_snapshots" to "service_role";

grant update on table "public"."round_tee_snapshots" to "service_role";

grant references on table "public"."rounds" to "anon";

grant select on table "public"."rounds" to "anon";

grant trigger on table "public"."rounds" to "anon";

grant delete on table "public"."rounds" to "authenticated";

grant insert on table "public"."rounds" to "authenticated";

grant references on table "public"."rounds" to "authenticated";

grant select on table "public"."rounds" to "authenticated";

grant trigger on table "public"."rounds" to "authenticated";

grant truncate on table "public"."rounds" to "authenticated";

grant update on table "public"."rounds" to "authenticated";

grant delete on table "public"."rounds" to "service_role";

grant insert on table "public"."rounds" to "service_role";

grant references on table "public"."rounds" to "service_role";

grant select on table "public"."rounds" to "service_role";

grant trigger on table "public"."rounds" to "service_role";

grant truncate on table "public"."rounds" to "service_role";

grant update on table "public"."rounds" to "service_role";


  create policy "ciaga_system_settings: admin read"
  on "public"."ciaga_system_settings"
  as permissive
  for select
  to authenticated
using (public.is_admin());



  create policy "competition_entries: read"
  on "public"."competition_entries"
  as permissive
  for select
  to authenticated
using (true);



  create policy "competitions: read"
  on "public"."competitions"
  as permissive
  for select
  to authenticated
using (true);



  create policy "course_tee_boxes: read"
  on "public"."course_tee_boxes"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "course_tee_holes: read"
  on "public"."course_tee_holes"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "courses: read"
  on "public"."courses"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "feed_comments_delete_self"
  on "public"."feed_comments"
  as permissive
  for delete
  to authenticated
using ((profile_id = public.current_profile_id()));



  create policy "feed_comments_insert_self"
  on "public"."feed_comments"
  as permissive
  for insert
  to authenticated
with check (((profile_id = public.current_profile_id()) AND (EXISTS ( SELECT 1
   FROM public.feed_item_targets t
  WHERE ((t.feed_item_id = feed_comments.feed_item_id) AND (t.viewer_profile_id = public.current_profile_id()))))));



  create policy "feed_comments_select_if_can_read_item"
  on "public"."feed_comments"
  as permissive
  for select
  to authenticated
using (((visibility <> 'removed'::text) AND (EXISTS ( SELECT 1
   FROM public.feed_item_targets t
  WHERE ((t.feed_item_id = feed_comments.feed_item_id) AND (t.viewer_profile_id = public.current_profile_id()))))));



  create policy "feed_comments_update_self"
  on "public"."feed_comments"
  as permissive
  for update
  to authenticated
using ((profile_id = public.current_profile_id()))
with check ((profile_id = public.current_profile_id()));



  create policy "feed_item_targets_select_self"
  on "public"."feed_item_targets"
  as permissive
  for select
  to authenticated
using ((viewer_profile_id = public.current_profile_id()));



  create policy "feed_items_insert_actor"
  on "public"."feed_items"
  as permissive
  for insert
  to authenticated
with check ((actor_profile_id = public.current_profile_id()));



  create policy "feed_items_select_targeted"
  on "public"."feed_items"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.feed_item_targets t
  WHERE ((t.feed_item_id = feed_items.id) AND (t.viewer_profile_id = public.current_profile_id())))));



  create policy "feed_items_update_actor"
  on "public"."feed_items"
  as permissive
  for update
  to authenticated
using ((actor_profile_id = public.current_profile_id()))
with check ((actor_profile_id = public.current_profile_id()));



  create policy "feed_reactions_delete_self"
  on "public"."feed_reactions"
  as permissive
  for delete
  to authenticated
using ((profile_id = public.current_profile_id()));



  create policy "feed_reactions_insert_self"
  on "public"."feed_reactions"
  as permissive
  for insert
  to authenticated
with check (((profile_id = public.current_profile_id()) AND (EXISTS ( SELECT 1
   FROM public.feed_item_targets t
  WHERE ((t.feed_item_id = feed_reactions.feed_item_id) AND (t.viewer_profile_id = public.current_profile_id()))))));



  create policy "feed_reactions_select_if_can_read_item"
  on "public"."feed_reactions"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.feed_item_targets t
  WHERE ((t.feed_item_id = feed_reactions.feed_item_id) AND (t.viewer_profile_id = public.current_profile_id())))));



  create policy "feed_reactions_update_self"
  on "public"."feed_reactions"
  as permissive
  for update
  to authenticated
using ((profile_id = public.current_profile_id()))
with check ((profile_id = public.current_profile_id()));



  create policy "feed_reports_insert_self"
  on "public"."feed_reports"
  as permissive
  for insert
  to authenticated
with check ((reporter_profile_id = public.current_profile_id()));



  create policy "feed_reports_select_self"
  on "public"."feed_reports"
  as permissive
  for select
  to authenticated
using ((reporter_profile_id = public.current_profile_id()));



  create policy "follows_delete_own"
  on "public"."follows"
  as permissive
  for delete
  to authenticated
using ((follower_id = auth.uid()));



  create policy "follows_delete_self"
  on "public"."follows"
  as permissive
  for delete
  to authenticated
using ((follower_id = public.current_profile_id()));



  create policy "follows_insert_own"
  on "public"."follows"
  as permissive
  for insert
  to authenticated
with check ((follower_id = auth.uid()));



  create policy "follows_insert_self"
  on "public"."follows"
  as permissive
  for insert
  to authenticated
with check ((follower_id = public.current_profile_id()));



  create policy "follows_select_authenticated"
  on "public"."follows"
  as permissive
  for select
  to authenticated
using (true);



  create policy "follows_select_self"
  on "public"."follows"
  as permissive
  for select
  to authenticated
using (((follower_id = public.current_profile_id()) OR (following_id = public.current_profile_id())));



  create policy "auth can read handicap history"
  on "public"."handicap_index_history"
  as permissive
  for select
  to authenticated
using (true);



  create policy "handicap_index_history: read all (auth)"
  on "public"."handicap_index_history"
  as permissive
  for select
  to authenticated
using (true);



  create policy "handicap_round_results: read all (auth)"
  on "public"."handicap_round_results"
  as permissive
  for select
  to authenticated
using (true);



  create policy "hrr_insert_own_if_round_participant"
  on "public"."handicap_round_results"
  as permissive
  for insert
  to authenticated
with check (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = handicap_round_results.profile_id) AND (p.owner_user_id = auth.uid())))) AND public.is_round_participant(round_id, auth.uid())));



  create policy "hrr_select_own"
  on "public"."handicap_round_results"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = handicap_round_results.profile_id) AND (p.owner_user_id = auth.uid())))));



  create policy "hrr_update_own"
  on "public"."handicap_round_results"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = handicap_round_results.profile_id) AND (p.owner_user_id = auth.uid())))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = handicap_round_results.profile_id) AND (p.owner_user_id = auth.uid())))));



  create policy "admins can manage invites"
  on "public"."invites"
  as permissive
  for all
  to public
using (public.is_admin())
with check (public.is_admin());



  create policy "profiles: admin can insert"
  on "public"."profiles"
  as permissive
  for insert
  to public
with check (public.is_admin());



  create policy "profiles: admin can read all"
  on "public"."profiles"
  as permissive
  for select
  to public
using (public.is_admin());



  create policy "profiles: admin can update all"
  on "public"."profiles"
  as permissive
  for update
  to public
using (public.is_admin())
with check (public.is_admin());



  create policy "profiles: owner can read"
  on "public"."profiles"
  as permissive
  for select
  to authenticated
using ((owner_user_id = auth.uid()));



  create policy "profiles: owner can update"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((owner_user_id = auth.uid()))
with check ((owner_user_id = auth.uid()));



  create policy "round_course_snapshots: owner can create"
  on "public"."round_course_snapshots"
  as permissive
  for insert
  to authenticated
with check (public.is_round_owner(round_id, auth.uid()));



  create policy "round_course_snapshots: read"
  on "public"."round_course_snapshots"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "round_hole_snapshots: owner can create"
  on "public"."round_hole_snapshots"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM (public.round_tee_snapshots rts
     JOIN public.round_course_snapshots rcs ON ((rcs.id = rts.round_course_snapshot_id)))
  WHERE ((rts.id = round_hole_snapshots.round_tee_snapshot_id) AND public.is_round_owner(rcs.round_id, auth.uid())))));



  create policy "round_hole_snapshots: read"
  on "public"."round_hole_snapshots"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "round_hole_states: participant update"
  on "public"."round_hole_states"
  as permissive
  for update
  to authenticated
using (public.is_round_participant(round_id, auth.uid()))
with check (public.is_round_participant(round_id, auth.uid()));



  create policy "owner can delete participants in draft rounds"
  on "public"."round_participants"
  as permissive
  for delete
  to authenticated
using (((EXISTS ( SELECT 1
   FROM (public.round_participants me
     JOIN public.rounds r ON ((r.id = round_participants.round_id)))
  WHERE ((me.round_id = round_participants.round_id) AND (me.profile_id = public.owned_profile_id()) AND (me.role = 'owner'::public.round_role) AND (r.status = 'draft'::public.round_status)))) AND (role <> 'owner'::public.round_role)));



  create policy "round_participants: owner can update"
  on "public"."round_participants"
  as permissive
  for update
  to authenticated
using (public.is_round_owner(round_id, auth.uid()))
with check (public.is_round_owner(round_id, auth.uid()));



  create policy "round_participants: owner delete non-owner"
  on "public"."round_participants"
  as permissive
  for delete
  to authenticated
using ((public.is_round_owner(round_id, auth.uid()) AND (role <> 'owner'::public.round_role)));



  create policy "round_participants: owner insert"
  on "public"."round_participants"
  as permissive
  for insert
  to authenticated
with check (public.is_round_owner(round_id, auth.uid()));



  create policy "round_participants: read"
  on "public"."round_participants"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "round_participants: scorer update"
  on "public"."round_participants"
  as permissive
  for update
  to authenticated
using (public.is_round_scorer(round_id, auth.uid()))
with check (public.is_round_scorer(round_id, auth.uid()));



  create policy "round_score_events: participant insert"
  on "public"."round_score_events"
  as permissive
  for insert
  to authenticated
with check (public.is_round_participant(round_id, auth.uid()));



  create policy "round_score_events: read"
  on "public"."round_score_events"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "round_tee_snapshots: owner can create"
  on "public"."round_tee_snapshots"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.round_course_snapshots rcs
  WHERE ((rcs.id = round_tee_snapshots.round_course_snapshot_id) AND public.is_round_owner(rcs.round_id, auth.uid())))));



  create policy "round_tee_snapshots: read"
  on "public"."round_tee_snapshots"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "rounds: participants can update"
  on "public"."rounds"
  as permissive
  for update
  to authenticated
using (public.is_round_participant(id, auth.uid()))
with check (public.is_round_participant(id, auth.uid()));



  create policy "rounds: read"
  on "public"."rounds"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "rounds_owner_or_scorer_can_finish"
  on "public"."rounds"
  as permissive
  for update
  to authenticated
using (public.is_round_scorer(id, auth.uid()))
with check (public.is_round_scorer(id, auth.uid()));


CREATE TRIGGER set_tee_updated_at BEFORE UPDATE ON public.course_tee_boxes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_seed_round_hole_states AFTER INSERT ON public.round_participants FOR EACH ROW EXECUTE FUNCTION public.seed_round_hole_states();

CREATE TRIGGER trg_mark_hole_completed_from_score_event AFTER INSERT ON public.round_score_events FOR EACH ROW EXECUTE FUNCTION public.mark_hole_completed_from_score_event();

CREATE TRIGGER trg_compute_results_on_round_finish AFTER UPDATE OF status ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.compute_all_results_when_round_finishes();

CREATE TRIGGER trg_recalc_hi_on_round_finish AFTER UPDATE OF status ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.recalc_profiles_when_round_finishes();


  create policy "Give anon users access to JPG images in folder 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'avatars'::text) AND (storage.extension(name) = 'jpg'::text) AND (lower((storage.foldername(name))[1]) = 'public'::text) AND (auth.role() = 'anon'::text)));



  create policy "Give users access to own folder 1oj01fe_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));



  create policy "Give users access to own folder 1oj01fe_1"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'avatars'::text) AND (( SELECT (auth.uid())::text AS uid) = (storage.foldername(name))[1])));



