#!/bin/sh
# Deploys the committed tree to the Vercel project this checkout is linked to (`vercel link`).
# Vercel blocks CLI deploys whose commit author is not on the Vercel team, so this deploys a plain
# export without .git. VERCEL_REGION (e.g. icn1) pins the functions next to the Supabase project.
set -e
root=$(git rev-parse --show-toplevel)
[ -d "$root/.vercel" ] || { echo "link the checkout first: vercel link" >&2; exit 1; }
[ -z "$(git -C "$root" status --porcelain)" ] || echo "note: uncommitted changes are not deployed" >&2
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
git -C "$root" archive HEAD | tar -x -C "$out"
cp -R "$root/.vercel" "$out/.vercel"
if [ -n "$VERCEL_REGION" ]; then
  node -e 'const f=process.argv[1];const j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.regions=[process.argv[2]];require("fs").writeFileSync(f,JSON.stringify(j,null,2))' "$out/vercel.json" "$VERCEL_REGION"
fi
vercel deploy --prod --yes --cwd "$out"
