-- Account legal / consent fields.
--
-- Supports:
--   * Terms & Privacy acceptance tracking (clickwrap at sign-up + re-acceptance
--     when the Terms version changes).
--   * Self-service account deletion via anonymise-in-place: deleted_at flags a
--     profile that has been scrubbed to "Former member" (identifiers removed,
--     auth user deleted) while its shared competition records are retained.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version     text;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'Set when the account was self-deleted (anonymised in place). Non-null = former member.';
COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'When the user last accepted the Terms of Use / Privacy Policy.';
COMMENT ON COLUMN public.profiles.terms_version IS
  'Version string of the Terms the user last accepted (see CURRENT_TERMS_VERSION in the app).';
