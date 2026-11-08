#!/usr/bin/env bash
# The cluster's nightly database backups (deploy/chart, `backup.*`): list them, take one now, copy one to this machine,
# or restore one.
#
#   scripts/backup.sh list                   the dumps in the backup volume, newest first
#   scripts/backup.sh now                    take a backup now (a Job from the CronJob), and wait for it
#   scripts/backup.sh fetch <name> [dest]    copy a dump here (default: ./<name>), e.g. to keep a copy off this disk
#   scripts/backup.sh restore <file>         replace everything in the live database with a fetched dump
#
# The volume is local-path storage, which only root can read on the node, so list and fetch go through a short-lived
# pod that mounts it read-only.
set -euo pipefail

NS=homestorm
PVC=homestorm-backup
CRONJOB=homestorm-backup
DB_POD=homestorm-db-0
DB_NAME=homestorm
DB_USER=homestorm
IMAGE=postgres:17-alpine
SHELL_POD="homestorm-backup-shell-$$"

die() {
  echo "backup.sh: $*" >&2
  exit 1
}

# A pod with the backup volume mounted read-only, deleted when this script exits.
start_shell_pod() {
  local overrides
  overrides=$(
    cat <<JSON
{
  "spec": {
    "securityContext": { "runAsNonRoot": true, "runAsUser": 999, "runAsGroup": 999 },
    "containers": [{
      "name": "shell",
      "image": "$IMAGE",
      "command": ["sleep", "600"],
      "securityContext": { "allowPrivilegeEscalation": false, "capabilities": { "drop": ["ALL"] } },
      "volumeMounts": [{ "name": "backup", "mountPath": "/backup", "readOnly": true }]
    }],
    "volumes": [{ "name": "backup", "persistentVolumeClaim": { "claimName": "$PVC", "readOnly": true } }]
  }
}
JSON
  )
  kubectl -n "$NS" get pvc "$PVC" >/dev/null 2>&1 || die "no $PVC volume yet: is the chart with backups deployed?"
  trap 'kubectl -n "$NS" delete pod "$SHELL_POD" --wait=false >/dev/null 2>&1 || true' EXIT
  kubectl -n "$NS" run "$SHELL_POD" --image="$IMAGE" --restart=Never --overrides="$overrides" >/dev/null
  kubectl -n "$NS" wait --for=condition=Ready "pod/$SHELL_POD" --timeout=120s >/dev/null
}

cmd=${1:-}
case "$cmd" in
  list)
    start_shell_pod
    kubectl -n "$NS" exec "$SHELL_POD" -- sh -c 'ls -lt /backup/homestorm-*.dump 2>/dev/null || echo "No backups yet."'
    ;;

  now)
    job="$CRONJOB-manual-$(date +%Y%m%d%H%M%S)"
    kubectl -n "$NS" create job "$job" --from="cronjob/$CRONJOB" >/dev/null
    echo "Started $job; waiting for it…"
    if kubectl -n "$NS" wait --for=condition=Complete "job/$job" --timeout=600s >/dev/null; then
      kubectl -n "$NS" logs "job/$job"
    else
      kubectl -n "$NS" logs "job/$job" || true
      die "$job didn't complete"
    fi
    ;;

  fetch)
    name=${2:-}
    [[ $name =~ ^homestorm-[0-9TZ]+\.dump$ ]] || die "usage: backup.sh fetch homestorm-<time>.dump [dest] (see: backup.sh list)"
    dest=${3:-./$name}
    [[ -e $dest ]] && die "$dest already exists"
    start_shell_pod
    kubectl -n "$NS" exec "$SHELL_POD" -- cat "/backup/$name" >"$dest.partial"
    # The dump must read back whole before it counts as fetched.
    kubectl -n "$NS" exec -i "$DB_POD" -- pg_restore --list >/dev/null <"$dest.partial" ||
      die "$dest.partial doesn't read back as a dump"
    mv "$dest.partial" "$dest"
    echo "Fetched $dest ($(wc -c <"$dest" | tr -d ' ') bytes)."
    ;;

  restore)
    file=${2:-}
    [[ -f $file ]] || die "usage: backup.sh restore <file> (fetch one first)"
    echo "This replaces EVERYTHING in the live homestorm database with $file."
    echo "Meetings changed since that backup are lost. Take a backup first (backup.sh now) if unsure."
    read -r -p "Type 'restore' to go on: " answer
    [[ $answer == restore ]] || die "not restored"
    # One transaction: it all applies, or nothing changes.
    kubectl -n "$NS" exec -i "$DB_POD" -- pg_restore --clean --if-exists --no-owner --single-transaction \
      -U "$DB_USER" -d "$DB_NAME" <"$file"
    # The API holds rounds and live streams in memory (ADR 0010), so it starts over from the restored data.
    kubectl -n "$NS" rollout restart deploy/homestorm-api >/dev/null
    kubectl -n "$NS" rollout status deploy/homestorm-api --timeout=180s
    echo "Restored $file."
    ;;

  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
