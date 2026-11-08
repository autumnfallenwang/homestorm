#!/bin/sh
# The nightly backup (templates/cronjob-backup.yaml): a pg_dump of the meeting database, attachments included, into
# the backup volume, keeping the newest $KEEP. The PG* variables say which database. Restore with scripts/backup.sh.
set -eu

name="homestorm-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="/backup/.$name.partial"

# One JSON line per outcome, in the house log shape, so Loki can find it: | json | event="backup.done"
log() {
  printf '{"level":"%s","time":"%s","service":"homestorm-backup","event":"%s",%s}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3"
}
trap 'status=$?; rm -f "$tmp"; [ "$status" -eq 0 ] || log error backup.failed "\"msg\":\"backup failed\",\"exit\":$status"' EXIT

# Written under a temporary name, and checked that it reads back as a dump, so a cut-off file is never kept as a backup.
pg_dump --format=custom --file="$tmp"
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "/backup/$name"

# Only after a good dump, so the old ones are never all gone while new ones are failing.
ls -1t /backup/homestorm-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm -f --

bytes=$(wc -c <"/backup/$name" | tr -d ' ')
kept=$(ls -1 /backup/homestorm-*.dump | wc -l | tr -d ' ')
log info backup.done "\"msg\":\"backup written\",\"file\":\"$name\",\"bytes\":$bytes,\"kept\":$kept"
