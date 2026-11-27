#!/usr/bin/env bash
# Dev helper: publish the API to a temp folder and (re)start it on :8080 with MoMo sandbox creds.
# Running from a published copy keeps bin/ unlocked so `dotnet build` / `dotnet test` work while it runs.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/stayra-api-run"
for pid in $(netstat -ano 2>/dev/null | grep -E ":8080 .*LISTENING" | awk '{print $NF}' | sort -u); do taskkill //PID "$pid" //F >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true; done
dotnet publish "$ROOT/src/Stayra.Api" -c Debug -o "$OUT" --nologo -v q
cd "$ROOT/src/Stayra.Api"   # content root: appsettings + data/uploads live here
export ASPNETCORE_ENVIRONMENT=Development Momo__PartnerCode=MOMO Momo__AccessKey=F8BBA842ECF85 Momo__SecretKey=K951B6PE1waDMi640xX08PD3vg6EkVlz
nohup dotnet "$OUT/Stayra.Api.dll" --urls http://localhost:8080 --contentRoot "$ROOT/src/Stayra.Api" > /tmp/stayra-api.log 2>&1 &
echo "API starting (log: /tmp/stayra-api.log)"
