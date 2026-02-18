# Supabase Environments

## Project References

### Staging / Development
- **Project Ref:** `balcwdqjzouufxigszup`
- **URL:** https://balcwdqjzouufxigszup.supabase.co
- **Purpose:** Development, testing, and staging
- **Current Status:** Currently linked (see `.temp/project-ref`)

### Production
- **Project Ref:** `jcmkyxlfyrhkgeszefjb`
- **URL:** https://jcmkyxlfyrhkgeszefjb.supabase.co
- **Purpose:** Live production database
- **Current Status:** Not linked

## Migration Workflow

### 1. Test on Staging First
```bash
# Ensure you're linked to staging
npx supabase link --project-ref balcwdqjzouufxigszup

# Push migrations to staging
npx supabase db push

# Verify migrations worked
npx supabase db diff --schema public
```

### 2. Apply to Production (After Verification)
```bash
# Switch to production
npx supabase link --project-ref jcmkyxlfyrhkgeszefjb

# Push migrations to production
npx supabase db push

# Verify
npx supabase db diff --schema public
```

### 3. Local Development
```bash
# Start local Supabase instance
npx supabase start

# Migrations are automatically applied to local instance
# or manually push:
npx supabase db push --local
```

## Current Linked Project
The currently linked project is stored in: `.temp/project-ref`

To check which project is currently linked:
```bash
cat supabase/.temp/project-ref
```

## Safety Notes

⚠️ **ALWAYS** test migrations on staging before applying to production!

⚠️ Double-check which project is linked before running `db push`:
```bash
npx supabase status --local=false
```
