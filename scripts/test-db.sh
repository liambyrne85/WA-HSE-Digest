#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL cluster, applies a Supabase stub + all
# migrations, then runs the RLS test suite. Requires PostgreSQL 15+ binaries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
trap '"$PGBIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

RUNAS=()
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$WORK" 2>/dev/null || true
  chmod 755 "$WORK"
  RUNAS=(runuser -u postgres --)
fi

"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ applying $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "→ running RLS tests"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_test.sql"
echo "→ running records engine tests"
"${PSQL[@]}" -f "$ROOT/supabase/tests/records_test.sql"
echo "→ running dashboard tests"
"${PSQL[@]}" -f "$ROOT/supabase/tests/dashboard_test.sql"
echo "✔ all database tests passed"
