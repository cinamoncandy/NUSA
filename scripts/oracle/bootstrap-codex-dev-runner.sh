#!/usr/bin/env bash
set -euo pipefail
umask 077

REPO="${NUSA_GITHUB_REPO:-cinamoncandy/NUSA}"
RUNNER_TOKEN="${GITHUB_RUNNER_TOKEN:?GITHUB_RUNNER_TOKEN is required}"
RUNNER_USER="${NUSA_RUNNER_USER:-nusa-dev}"
RUNNER_ROOT="/opt/actions-runner"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (cloud-init or sudo)." >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git jq build-essential python3
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@11.7.0 --activate
npm install -g @openai/codex

id "$RUNNER_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUNNER_USER"
git config --system user.name "NUSA Oracle Codex"
git config --system user.email "noreply@nusa.local"

mkdir -p "$RUNNER_ROOT"
chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_ROOT"
cd /tmp
version=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name | ltrimstr("v")')
curl -fsSLo actions-runner.tar.gz "https://github.com/actions/runner/releases/download/v${version}/actions-runner-linux-arm64-${version}.tar.gz"
tar -xzf actions-runner.tar.gz -C "$RUNNER_ROOT"
rm -f actions-runner.tar.gz

cd "$RUNNER_ROOT"
sudo -u "$RUNNER_USER" ./config.sh   --url "https://github.com/$REPO"   --token "$RUNNER_TOKEN"   --name "oracle-codex-dev"   --labels "nusa-codex-dev"   --work _work   --unattended   --replace
./svc.sh install "$RUNNER_USER"
./svc.sh start
unset RUNNER_TOKEN GITHUB_RUNNER_TOKEN

echo "NUSA Oracle Codex runner bootstrap complete."
echo "No NUSA production credentials, broker credentials, exchange credentials, or runtime databases were installed."
