#!/usr/bin/env bash
# Create the homestorm-secrets Secret in the cluster from a local env file.
#
# Reads real secret values from a gitignored env file (default:
# ./cluster-secrets.env) and creates the k8s Secret out-of-band. The chart wires
# its env via secretKeyRef to this Secret; the chart itself never sees plaintext.
#
# Usage:
#   1. cp deploy/cluster-secrets.env.example cluster-secrets.env
#   2. edit cluster-secrets.env with real values (NEVER commit it)
#   3. bash scripts/create-cluster-secret.sh
#   4. verify: kubectl -n homestorm get secret homestorm-secrets -o yaml
#
# Keys required (match the secretKeyRef references in deploy/chart/templates/):
#   DATABASE_URL       postgres://homestorm:<password>@homestorm-db:5432/homestorm
#   POSTGRES_PASSWORD  same password as in DATABASE_URL (initdb consumes it)
#   BETTER_AUTH_SECRET signs login sessions (ADR 0011): `openssl rand -base64 32`;
#                      changing it signs everyone out
#
# Sealed Secrets (encrypt at rest in arch-infra) is a planned follow-up — a
# no-downtime env-source swap once the operator is wired cluster-wide.

set -euo pipefail

NAMESPACE="${HOMESTORM_NS:-homestorm}"
SECRET_NAME="${HOMESTORM_SECRET_NAME:-homestorm-secrets}"
ENV_FILE="${HOMESTORM_SECRET_ENV:-./cluster-secrets.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy deploy/cluster-secrets.env.example and edit." >&2
  exit 1
fi

# ⚠️ `apply` REPLACES the Secret with exactly the keys in the file, so a key
# missing here would vanish from the cluster and the api pod would fail to
# start (CreateContainerConfigError). Refuse instead.
for key in DATABASE_URL POSTGRES_PASSWORD BETTER_AUTH_SECRET; do
  if ! grep -qE "^${key}=.+" "$ENV_FILE"; then
    echo "ERROR: $ENV_FILE has no value for $key (see deploy/cluster-secrets.env.example)." >&2
    exit 1
  fi
done

# Ensure namespace exists (Argo CD also creates it via CreateNamespace=true, but
# we may run this before the Application is committed).
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 \
  || kubectl create namespace "$NAMESPACE"

# Recreate the secret idempotently. --dry-run | apply keeps it server-side
# compatible with ArgoCD's sync.
kubectl create secret generic "$SECRET_NAME" \
  --namespace="$NAMESPACE" \
  --from-env-file="$ENV_FILE" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

echo
echo "Created/updated $NAMESPACE/$SECRET_NAME"
echo "Keys present:"
kubectl -n "$NAMESPACE" get secret "$SECRET_NAME" -o jsonpath='{.data}' \
  | tr ',' '\n' | grep -oE '"[A-Z_]+":' | tr -d '":'
