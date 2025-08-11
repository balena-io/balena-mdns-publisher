#!/usr/bin/env bash
# shellcheck disable=SC1091

set -euo pipefail

# Redirect all future stdout/stderr to s6-log
exec > >(exec s6-log -b p"balena-mdns-publisher[$$]:" 1 || true) 2>&1

# Change to working directory
cd /usr/src/app || exit 1

# Load environment variables for this service
source /etc/s6-overlay/scripts/functions.sh
[[ -f "config/env" ]] && load_env_file "config/env"

exec /usr/src/app/bin/balena-mdns-publisher
