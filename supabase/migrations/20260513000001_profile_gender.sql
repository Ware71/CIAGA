ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'male';

ALTER TABLE profiles
  ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('male', 'female'));
