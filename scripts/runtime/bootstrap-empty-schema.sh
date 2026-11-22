#!/usr/bin/env bash
# Bootstrap the basic-framework baseline into an EMPTY, dedicated MySQL schema.
#
# Usage: bootstrap-empty-schema.sh <database>
#
# Contract (see the deployment guide):
#   - <database> matches ^[A-Za-z0-9_]{1,64}$ and already exists (freshly provisioned).
#   - Before any import, refuses unless the schema exists and holds zero
#     tables/views + routines + events as seen by the connecting account.
#   - Imports the repository SQL with only its exact "DROP TABLE IF EXISTS `name`;" lines
#     (expected: 14) removed; aborts on any other DROP/TRUNCATE, USE,
#     CREATE DATABASE/SCHEMA or CREATE TABLE IF NOT EXISTS. Existing tables
#     therefore make CREATE TABLE fail instead of being dropped.
#   - mysql runs without --force and stops at the first SQL error.
#
# Connection (option files ignored via --no-defaults; no other mysql flags):
#   TCP:    MYSQL_HOST, optional MYSQL_TCP_PORT (default 3306)
#   Socket: MYSQL_UNIX_PORT
#   Always: MYSQL_USER. Password only via inherited MYSQL_PWD.
set -euo pipefail

readonly EXPECTED_DROPS=14
die() { local code=$1; shift; printf 'bootstrap-empty-schema: %s\n' "$*" >&2; exit "$code"; }

[[ $# -eq 1 ]] || die 2 "usage: bootstrap-empty-schema.sh <database>"
db=$1
[[ $db =~ ^[A-Za-z0-9_]{1,64}$ ]] || die 2 "invalid database name"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
sql=$script_dir/../../数据库文件/basic_framework.sql
[[ -f $sql && -r $sql ]] || die 2 "baseline SQL not readable: $sql"
command -v mysql >/dev/null || die 2 "mysql client not found"

conn=(--no-defaults --batch --local-infile=0 --default-character-set=utf8mb4)
if [[ -n ${MYSQL_UNIX_PORT:-} ]]; then
  [[ -z ${MYSQL_HOST:-} || $MYSQL_HOST == localhost ]] || die 2 "set MYSQL_UNIX_PORT or MYSQL_HOST, not both"
  conn+=(--protocol=SOCKET "--socket=$MYSQL_UNIX_PORT")
elif [[ -n ${MYSQL_HOST:-} ]]; then
  port=${MYSQL_TCP_PORT:-3306}
  [[ $port =~ ^[0-9]{1,5}$ ]] || die 2 "MYSQL_TCP_PORT must be numeric"
  conn+=(--protocol=TCP --ssl-mode=VERIFY_IDENTITY "--host=$MYSQL_HOST" "--port=$port")
  if [[ -n ${MYSQL_SSL_CA:-} ]]; then
    conn+=("--ssl-ca=$MYSQL_SSL_CA")
  fi
else
  die 2 "set MYSQL_HOST (TCP) or MYSQL_UNIX_PORT (socket)"
fi
[[ -n ${MYSQL_USER:-} ]] || die 2 "MYSQL_USER is required"
conn+=("--user=$MYSQL_USER")

# Emit the baseline minus its exact DROP lines; fail closed on anything else risky.
filter() {
  awk -v want="$EXPECTED_DROPS" '
    /^DROP TABLE IF EXISTS `[A-Za-z0-9_]+`;$/ { n++; next }
    { u = toupper($0) }
    u ~ /(^|;)[[:space:]]*(DROP|TRUNCATE|USE)([^A-Z0-9_]|$)/ ||
    u ~ /(^|;)[[:space:]]*CREATE[[:space:]]+(DATABASE|SCHEMA)([^A-Z0-9_]|$)/ ||
    u ~ /CREATE[[:space:]]+TABLE[[:space:]]+IF[[:space:]]+NOT/ {
      printf "line %d: disallowed statement\n", NR > "/dev/stderr"; bad = 1; exit 3
    }
    { print }
    END {
      if (bad) exit 3
      if (n != want) { printf "expected %d DROP lines, found %d\n", want, n > "/dev/stderr"; exit 3 }
    }' "$sql"
}
filter >/dev/null || die 3 "baseline SQL failed validation; nothing imported"

q="SELECT CONCAT(
 (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$db'), ' ',
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$db')
 + (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '$db')
 + (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = '$db'))"
out=$(mysql "${conn[@]}" --skip-column-names -e "$q") || die 4 "emptiness check failed (connection/SQL error); nothing imported"
[[ $out =~ ^[0-9]+\ [0-9]+$ ]] || die 3 "unexpected check result; nothing imported"
read -r exists count <<<"$out"
[[ $exists == 1 ]] || die 3 "schema $db missing or not visible; nothing imported"
[[ $count == 0 ]] || die 3 "schema $db not empty ($count objects); nothing imported"

echo "bootstrap-empty-schema: $db is empty; importing baseline"
filter | mysql "${conn[@]}" "--database=$db" || die 4 "import failed; schema may be partial: drop and re-provision it, do not retry"
echo "bootstrap-empty-schema: import complete"
