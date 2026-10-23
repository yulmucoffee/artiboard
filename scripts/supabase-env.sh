#!/bin/sh
# Prints the three variables the Supabase backend reads, from a running local stack (supabase start), so tests can run
# against it: eval "$(sh scripts/supabase-env.sh)" && AB_SUPABASE=1 npm test
set -e
status=$(supabase status -o env "$@")
eval "$(printf '%s\n' "$status" | grep -E '^(API_URL|SECRET_KEY|SERVICE_ROLE_KEY|PUBLISHABLE_KEY|ANON_KEY)=')"
[ -n "$API_URL" ] || { echo 'no API_URL from supabase status; is the stack running?' >&2; exit 1; }
echo "export SUPABASE_URL='$API_URL'"
echo "export SUPABASE_SECRET_KEY='${SECRET_KEY:-$SERVICE_ROLE_KEY}'"
echo "export SUPABASE_PUBLISHABLE_KEY='${PUBLISHABLE_KEY:-$ANON_KEY}'"
