#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu EC2 instance (t3.micro/t4g.small free
# tier is plenty). Run once, as a sudo-capable user, before the first
# deploy from CI:
#
#   scp deploy/setup-ec2.sh ubuntu@<host>:~
#   ssh ubuntu@<host> 'chmod +x setup-ec2.sh && ./setup-ec2.sh'
#
# After this, add the repo's deploy key to the "homework" user's
# ~/.ssh/authorized_keys (or reuse this key for the DEPLOY_SSH_KEY secret),
# and set these GitHub Actions secrets on the repo:
#   DEPLOY_HOST  DEPLOY_USER=homework  DEPLOY_PATH=/opt/homework-board
#   DEPLOY_SSH_KEY (private key)  DEPLOY_PORT=22 (optional)
set -euo pipefail

APP_DIR=/opt/homework-board
APP_USER=homework

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  sudo useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p "$APP_DIR"
sudo chown "$APP_USER:$APP_USER" "$APP_DIR"

sudo -u "$APP_USER" git clone https://github.com/initrode/bgs.git "$APP_DIR" 2>/dev/null \
  || echo "  $APP_DIR already has a checkout — skipping clone"

# Chromium's shared-library dependencies (fonts, nss, atk, ...); the browser
# binary itself is fetched per npm-install by `playwright install`.
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev && npx playwright install --with-deps chromium"

echo "Now put your school credentials in $APP_DIR/.satchel.env (owned by $APP_USER, chmod 600)."
echo "See README.md 'Credentials' for the variables it needs."

sudo cp "$APP_DIR/deploy/homework-board.service" /etc/systemd/system/homework-board.service
sudo systemctl daemon-reload
sudo systemctl enable --now homework-board

# Deploys run `sudo systemctl restart homework-board` over SSH as $APP_USER —
# let that one command run without a password prompt.
echo "$APP_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart homework-board" \
  | sudo tee /etc/sudoers.d/homework-board-restart >/dev/null
sudo chmod 440 /etc/sudoers.d/homework-board-restart

echo "Done. Check status with: sudo systemctl status homework-board"
