#!/usr/bin/env bash
# A throwaway Postgres 16 for migration rehearsal. Starts (or reuses) a cluster
# under $PG_SCRATCH, listening only on a unix socket there, and prints the
# PGHOST/PGPORT/PGUSER lines to export. Postgres refuses to run as root, so a
# root caller is dropped to the postgres user; anyone else runs as themselves.
#
#   eval "$(./local_pg.sh start)"
#   ./substrate.sh
#   ./local_pg.sh stop
#
# Needs the postgresql-16 server binaries (PG_BIN below). Nothing here touches
# a real project.
set -euo pipefail
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_SCRATCH="${PG_SCRATCH:-/tmp/jarvis-pg}"
PG_PORT="${PG_PORT:-54329}"
DATA="$PG_SCRATCH/data"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

case "${1:-}" in
  start)
    mkdir -p "$PG_SCRATCH"
    if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$PG_SCRATCH"; fi
    if [ ! -f "$DATA/PG_VERSION" ]; then
      as_pg "$PG_BIN/initdb" -D "$DATA" --auth=trust -U postgres >"$PG_SCRATCH/initdb.log" 2>&1
    fi
    if ! as_pg "$PG_BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      as_pg "$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PG_PORT -k $PG_SCRATCH -c listen_addresses=''" -l "$PG_SCRATCH/server.log" start >/dev/null
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        if "$PG_BIN/pg_isready" -h "$PG_SCRATCH" -p "$PG_PORT" -U postgres >/dev/null 2>&1; then break; fi
        sleep 1
      done
    fi
    echo "export PGHOST=$PG_SCRATCH PGPORT=$PG_PORT PGUSER=postgres"
    ;;
  stop)
    as_pg "$PG_BIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 2
    ;;
esac
