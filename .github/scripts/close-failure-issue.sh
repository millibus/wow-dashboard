#!/usr/bin/env bash
# Close the open pipeline-failure incident issue after a successful refresh.
# Env: GH_TOKEN, GH_REPO, RUN_URL
set -euo pipefail

LABEL="pipeline-failure"
existing=$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number // empty' || true)

if [ -z "$existing" ]; then
  exit 0
fi

gh issue comment "$existing" --body "Recovered: this run refreshed the data successfully. ${RUN_URL}"
gh issue close "$existing" --reason completed
echo "Closed incident issue #${existing}."
