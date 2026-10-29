#!/bin/sh
set -eu

# A bind-mounted /data directory is created by the host and may be owned by a
# different uid than the image's fx42 user. Fix ownership before dropping
# privileges so SQLite can create the database and WAL files.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data /run/fx42
  chown -R fx42:fx42 /data /run/fx42
  exec gosu fx42 "$@"
fi

exec "$@"
