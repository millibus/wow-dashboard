#!/usr/bin/env bash
# Open or update ONE deduplicated incident issue when the data refresh fails.
# - Creates the issue on the first failure.
# - Comments only when the failure fingerprint changes, or after a reminder
#   interval (so hourly repeats of the same failure stay silent).
# - Bodies contain only the safe failure code and the run link — never logs,
#   requests, headers, or credentials.
# Env: GH_TOKEN, GH_REPO, FAILURE_CODE, RUN_URL
set -euo pipefail

TITLE="Data refresh pipeline is failing"
LABEL="pipeline-failure"
REMINDER_SECONDS=$((24 * 60 * 60))
CODE="${FAILURE_CODE:-UNKNOWN}"
MARKER="<!-- fingerprint:${CODE} -->"

triage_block() {
  cat <<EOF
${MARKER}
The hourly data refresh failed with code \`${CODE}\`.

Run: ${RUN_URL}

**Triage checklist**
- \`AUTH_BAD_CREDENTIALS\` → the Blizzard OAuth client was rejected. Regenerate the client secret at https://develop.battle.net/access/clients, verify with \`curl -u "\$ID:\$SECRET" -d grant_type=client_credentials https://oauth.battle.net/token\`, then update both repo secrets (\`gh secret set BLIZZARD_CLIENT_ID\` / \`gh secret set BLIZZARD_CLIENT_SECRET\`) and re-run the workflow.
- \`HTTP_429\` / \`NETWORK_*\` → likely transient; check whether the next scheduled run recovers.
- \`HTTP_5xx\` → Blizzard API incident; check https://us.forums.blizzard.com/en/blizzard/c/support/api-discussion
- Anything else → open the run log above (it is sanitized) and investigate.

This issue closes automatically when a refresh succeeds.
EOF
}

existing=$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number // empty' || true)

if [ -z "$existing" ]; then
  gh label create "$LABEL" --description "Automated: the hourly data refresh is failing" --color B60205 2>/dev/null || true
  triage_block | gh issue create --title "$TITLE" --label "$LABEL" --body-file -
  echo "Opened new incident issue (code ${CODE})."
  exit 0
fi

# Issue already open: find the fingerprint and time of the last update we made.
info=$(gh issue view "$existing" --json body,comments,createdAt \
  --jq '{body: .body, createdAt: .createdAt, last: (.comments | if length > 0 then .[-1] else null end)}')
last_text=$(echo "$info" | jq -r 'if .last then .last.body else .body end')
# Fall back to the issue's creation time when there are no comments yet, so a
# fresh incident does not immediately look older than the reminder interval.
last_time=$(echo "$info" | jq -r 'if .last then .last.createdAt else .createdAt end')

last_code=$(echo "$last_text" | sed -n 's/.*<!-- fingerprint:\([A-Za-z0-9_]*\) -->.*/\1/p' | head -1)

now=$(date +%s)
last_epoch=0
if [ -n "$last_time" ]; then
  last_epoch=$(date -d "$last_time" +%s 2>/dev/null || echo 0)
fi
age=$((now - last_epoch))

if [ "$last_code" != "$CODE" ] || [ "$age" -ge "$REMINDER_SECONDS" ]; then
  triage_block | gh issue comment "$existing" --body-file -
  echo "Commented on issue #${existing} (code ${CODE}, previous ${last_code:-none}, age ${age}s)."
else
  echo "Issue #${existing} already tracks code ${CODE} (updated ${age}s ago); staying silent."
fi
