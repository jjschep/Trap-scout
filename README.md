
# Trap Scout (Netlify + Git)

Your Supabase settings are already in `config.js`:
- URL: https://rbkaospswxatykrfjyrh.supabase.co
- anon key: **embedded**

## Deploy from Git (Netlify)
1) Create a **GitHub repo** named `trap-scout`.
2) Upload **all files from this folder** to the repo.
3) In Netlify: **New site from Git** → pick your repo.
   - Build command: *(leave empty)*
   - Publish directory: `.`
4) Deploy. Netlify will give you a site URL.

## Cache refresh
If changes don't appear, bump cache in `service-worker.js`:
`const CACHE = 'trap-scout-v2'` and commit.

## RLS
Policy allows anon SELECT on blocks/traps/visits and INSERT on visits.
Tighten later if needed.
