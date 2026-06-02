-- Link events to a group season based on their event date
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS group_season_id uuid
    REFERENCES public.group_seasons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_group_season ON public.events(group_season_id);
