#!/bin/sh
# Railway runs startCommand as exec form, so `&&` chains in railway.json
# don't work — the second command is treated as positional argv. Invoking
# this script via `sh` forces a real shell, where `&&` and `set -e` mean
# what they should.
set -e
node scripts/migrate.js
exec node src/web/server.js
