#!/usr/bin/env bash
# Copy the relay to a VM over SSH and run setup-vm.sh there.
#   bash deploy.sh <vm-ip> <ssh-private-key> [ssh-user=ubuntu] [public-hostname]
set -euo pipefail

IP="${1:?usage: deploy.sh <vm-ip> <ssh-private-key> [ssh-user] [hostname]}"
KEY="${2:?ssh private key path required}"
USER_NAME="${3:-ubuntu}"
HOSTNAME_ARG="${4:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

ssh "${SSH_OPTS[@]}" "$USER_NAME@$IP" 'mkdir -p ~/uv-relay'
scp "${SSH_OPTS[@]}" "$HERE/relay.mjs" "$HERE/package.json" "$HERE/package-lock.json" "$HERE/setup-vm.sh" \
  "$USER_NAME@$IP:uv-relay/"
ssh "${SSH_OPTS[@]}" "$USER_NAME@$IP" "sudo bash ~/uv-relay/setup-vm.sh $HOSTNAME_ARG"
