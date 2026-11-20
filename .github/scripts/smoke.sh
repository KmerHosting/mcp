#!/usr/bin/env bash
# Live smoke checks: is the deployed platform up and answering as expected?
#
# Usage: smoke.sh <checks file>
# Each line: METHOD URL EXPECTED_CODES [TEXT THAT MUST APPEAR IN THE BODY]
#   EXPECTED_CODES is a comma list (200,204). Blank lines and lines starting with # are skipped.
#   Redirects are not followed, so a 307/308 is checked as such.
# Each check gets 3 tries (network blips), 20 s each. Any failure fails the job.
set -uo pipefail

file="${1:?checks file}"
body="$(mktemp)"
failed=0
passed=0

while read -r method url codes text; do
  [[ -z "${method:-}" || "$method" == \#* ]] && continue
  ok=0
  for attempt in 1 2 3; do
    args=(-s -o "$body" -m 20 -X "$method" -w '%{http_code} %{time_total}')
    if [[ "$method" == OPTIONS ]]; then
      args+=(-H 'Origin: https://dash.kmerhosting.com' -H 'Access-Control-Request-Method: POST')
    fi
    read -r code took < <(curl "${args[@]}" "$url" || true)
    if [[ ",$codes," == *",$code,"* ]] && { [[ -z "${text:-}" ]] || grep -qF -- "$text" "$body"; }; then
      ok=1
      break
    fi
    sleep 5
  done
  if ((ok)); then
    passed=$((passed + 1))
    printf 'ok    %s %s %s (%ss)\n' "$code" "$method" "$url" "$took"
  else
    failed=$((failed + 1))
    detail="got ${code:-no answer}, expected $codes${text:+ with \"$text\"}"
    printf 'FAIL  %s %s: %s\n' "$method" "$url" "$detail"
    echo "::error title=Smoke check failed::$method $url: $detail"
  fi
done < "$file"

rm -f "$body"
echo "$passed passed, $failed failed"
((failed == 0))
