import { supabase } from '@/lib/supabaseClient'

type User = {
  id: string
  email?: string
  user_metadata?: { full_name?: string; avatar_url?: string }
}

export async function ensureProfile(user: User) {
  const name = user.user_metadata?.full_name || user.email || 'Player'
  const avatar_url = user.user_metadata?.avatar_url || null

  await supabase.from('profiles').upsert(
    {
      id: user.id,
      name,
      email: user.email ?? null,
      avatar_url,
    },
    { onConflict: 'id' }
  )
}
