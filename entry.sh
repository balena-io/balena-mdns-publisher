#!/command/with-contenv bash
# shellcheck shell=bash

set -euo pipefail

# Redirect all future stdout/stderr to s6-log
exec > >(exec s6-log -b p"balena-mdns-publisher[$$]:" 1 || true) 2>&1

# Change to working directory
cd /usr/src/app || exit 1

exec /usr/src/app/bin/balena-mdns-publisher
