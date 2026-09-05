#!/bin/sh
set -eu

deploy_user=${1:-dashbridge-deploy}
stack_root=/opt/stacks/dashbridge-analytics
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

[ "$(id -u)" -eq 0 ] || { echo 'Run bootstrap-vps.sh as root.' >&2; exit 1; }
id "$deploy_user" >/dev/null 2>&1 || { echo "User $deploy_user does not exist." >&2; exit 1; }
docker network inspect analytics_private >/dev/null 2>&1 || docker network create analytics_private
mkdir -p "$stack_root/data" "$stack_root/backups"
mkdir -p "$stack_root/app"
chown 10001:10001 "$stack_root/data"
chmod 0750 "$stack_root/data"

for item in server.js analytics-contract.js package.json compose.yaml public; do
    [ -e "$source_dir/$item" ] || { echo "Missing bootstrap input: $item" >&2; exit 1; }
done
cp "$source_dir/compose.yaml" "$stack_root/compose.yaml"
cp "$source_dir/server.js" "$source_dir/analytics-contract.js" "$stack_root/app/"
rm -rf "$stack_root/app/public"
cp -a "$source_dir/public" "$stack_root/app/public"
install -m 0755 "$source_dir/ops/dashbridge-analytics-apply" /usr/local/sbin/dashbridge-analytics-apply

cat >"/etc/sudoers.d/dashbridge-analytics-deploy" <<EOF
$deploy_user ALL=(root) NOPASSWD: /usr/local/sbin/dashbridge-analytics-apply /tmp/dashbridge-analytics-*.tar.gz [a-f0-9]*
EOF
chmod 0440 /etc/sudoers.d/dashbridge-analytics-deploy
visudo -cf /etc/sudoers.d/dashbridge-analytics-deploy >/dev/null

cd "$stack_root"
docker compose config --quiet
docker compose up -d --force-recreate analytics
echo 'VPS analytics runtime is installed. Verify Caddy and then run the local publish script.'
