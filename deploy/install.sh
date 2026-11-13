#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$USER}"

if [ ! -d "$REPO_DIR/.venv" ]; then
  python3 -m venv --system-site-packages "$REPO_DIR/.venv"
fi

"$REPO_DIR/.venv/bin/pip" install -q -r "$REPO_DIR/requirements.txt"

if ! "$REPO_DIR/.venv/bin/python" -c "import gpiozero" >/dev/null 2>&1; then
  "$REPO_DIR/.venv/bin/pip" install -q gpiozero
fi

sed -e "s|__REPO_DIR__|$REPO_DIR|g" "$REPO_DIR/deploy/segredo-stack.service" | sudo tee /etc/systemd/system/segredo-stack.service >/dev/null
sed -e "s|__REPO_DIR__|$REPO_DIR|g" -e "s|__USER__|$RUN_USER|g" "$REPO_DIR/deploy/segredo-gpio.service" | sudo tee /etc/systemd/system/segredo-gpio.service >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now docker
sudo systemctl enable --now segredo-stack.service
sudo systemctl enable --now segredo-gpio.service

echo "Servicos instalados e iniciados:"
sudo systemctl status segredo-stack.service segredo-gpio.service --no-pager -l || true
