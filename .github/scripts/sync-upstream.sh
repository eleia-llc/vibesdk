#!/usr/bin/env bash
# Publish cloudflare/vibesdk main onto a branch in this fork and open a PR.
# Never pushes to main. See the header of sync-upstream.yml for the token
# this script needs when upstream changes files under .github/workflows/.
set -euo pipefail

redact() {
  sed -E \
    -e 's#x-access-token:[^@[:space:]]+#x-access-token:REDACTED#g' \
    -e 's/ghs_[A-Za-z0-9_]+/ghs_REDACTED/g' \
    -e 's/ghp_[A-Za-z0-9_]+/ghp_REDACTED/g' \
    -e 's/github_pat_[A-Za-z0-9_]+/github_pat_REDACTED/g'
}

# Distinguish a rejected fast-forward from auth, network, and workflow-scope errors.
# GITHUB_TOKEN failures that mention workflow files are not "no fast-forward".
classify_push_failure() {
  local err="$1"
  if printf '%s\n' "$err" | grep -Eqi 'non-fast-forward|fetch first|Updates were rejected'; then
    printf 'non-fast-forward'
  elif printf '%s\n' "$err" | grep -Eqi 'refusing to allow .*workflow|without `workflows` permission|workflows scope|Unable to determine if workflow can be created'; then
    printf 'workflow-permission'
  elif printf '%s\n' "$err" | grep -Eqi 'Authentication failed|Invalid username or token|Permission to .* denied|could not read Username|Bad credentials|HTTP 401|The requested URL returned error: 403|403 Forbidden'; then
    printf 'auth'
  elif printf '%s\n' "$err" | grep -Eqi 'Could not resolve host|Connection timed out|Network is unreachable|unable to access|RPC failed|the remote end hung up|SSL_ERROR|gnutls'; then
    printf 'network'
  else
    printf 'other'
  fi
}

PUSH_ERR=""
PUSH_CLASS=""

push_ref() {
  local src="$1"
  local dest="$2"
  local status
  set +e
  PUSH_ERR="$(git push origin "${src}:refs/heads/${dest}" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    PUSH_ERR=""
    PUSH_CLASS=""
    return 0
  fi
  printf '%s\n' "$PUSH_ERR" | redact >&2
  PUSH_CLASS="$(classify_push_failure "$PUSH_ERR")"
  return 1
}

fail_push() {
  local class="$1"
  echo "Push failed: ${class}."
  case "$class" in
    workflow-permission)
      echo "The token cannot create or update files under .github/workflows/."
      echo "GITHUB_TOKEN has no workflows permission, and the workflow permissions: block cannot grant one."
      echo "Set secret UPSTREAM_SYNC_TOKEN, or UPSTREAM_SYNC_APP_ID plus UPSTREAM_SYNC_APP_PRIVATE_KEY. Details are in the workflow file header."
      ;;
    auth)
      echo "Authentication or permission failure. This is not a non-fast-forward rejection, so no alternate branch was published."
      ;;
    network)
      echo "Network failure while pushing. This is not a non-fast-forward rejection, so no alternate branch was published."
      ;;
    other)
      echo "Unrecognized git push error. This is not a non-fast-forward rejection, so no alternate branch was published."
      ;;
    *)
      echo "Push did not fast-forward and the alternate branch also failed."
      ;;
  esac
  exit 1
}

TOKEN_KIND="github-token"
ELEVATED=false
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

if [[ -n "${UPSTREAM_SYNC_APP_ID:-}" && -n "${UPSTREAM_SYNC_APP_PRIVATE_KEY:-}" ]]; then
  TOKEN="$(python3 .github/scripts/upstream-sync-app-token.py)"
  TOKEN_KIND="github-app"
  ELEVATED=true
elif [[ -n "${UPSTREAM_SYNC_TOKEN:-}" ]]; then
  TOKEN="${UPSTREAM_SYNC_TOKEN}"
  TOKEN_KIND="pat"
  ELEVATED=true
fi

if [[ -z "${TOKEN}" ]]; then
  echo "No GitHub token is available."
  exit 1
fi

echo "::add-mask::${TOKEN}"
export GH_TOKEN="${TOKEN}"
git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

git remote remove upstream 2>/dev/null || true
git remote add upstream https://github.com/cloudflare/vibesdk.git
git fetch --no-tags upstream main
git fetch --no-tags origin main

UPSTREAM_SHA="$(git rev-parse upstream/main)"
SHORT="$(git rev-parse --short=12 upstream/main)"
MIRROR_BRANCH="sync/upstream-main"

open_pr_number() {
  gh pr list --base main --head "${GITHUB_REPOSITORY%%/*}:$1" --state open --json number --jq '.[0].number // empty'
}

if git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main; then
  echo "origin/main already contains upstream/main (${UPSTREAM_SHA})."
  existing="$(open_pr_number "$MIRROR_BRANCH")"
  if [[ -n "$existing" ]]; then
    gh pr close "$existing" --comment "upstream/main ya está contenido en main de este fork. Este PR de sincronización se cierra sin cambios."
  fi
  exit 0
fi

mapfile -t workflow_files < <(git diff --name-only origin/main "$UPSTREAM_SHA" -- .github/workflows || true)
held_back=false
SOURCE_REF="$UPSTREAM_SHA"

make_sanitized_commit() {
  git checkout --detach "$UPSTREAM_SHA"
  git checkout origin/main -- .github/workflows
  if git diff --cached --quiet; then
    printf '%s' "$UPSTREAM_SHA"
    return 0
  fi
  git -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    -c user.name="github-actions[bot]" \
    commit -m "ci: keep fork workflows until a workflows-scoped token is configured" >&2
  if git diff --quiet origin/main HEAD; then
    echo "The only upstream changes are under .github/workflows/." >&2
    echo "GITHUB_TOKEN cannot push those files. Set UPSTREAM_SYNC_TOKEN or the GitHub App secrets named in the workflow header." >&2
    return 1
  fi
  git rev-parse HEAD
}

if [[ "$ELEVATED" != true && "${#workflow_files[@]}" -gt 0 ]]; then
  echo "Upstream changes workflow files and no workflows-scoped token is configured. Keeping this fork's .github/workflows/."
  SOURCE_REF="$(make_sanitized_commit)"
  held_back=true
fi

RESULT=""

publish() {
  local dest="$1"
  if push_ref "$SOURCE_REF" "$dest"; then
    RESULT="success"
    return 0
  fi
  if [[ "$PUSH_CLASS" == "workflow-permission" && "$ELEVATED" != true && "$held_back" != true ]]; then
    echo "Push was rejected for workflow permissions. Retrying without upstream workflow files." >&2
    SOURCE_REF="$(make_sanitized_commit)"
    held_back=true
    if push_ref "$SOURCE_REF" "$dest"; then
      RESULT="success"
      return 0
    fi
  fi
  RESULT="$PUSH_CLASS"
}

branch="$MIRROR_BRANCH"
publish "$branch"
if [[ "$RESULT" == "non-fast-forward" ]]; then
  echo "Refusing to force-push ${MIRROR_BRANCH}. Publishing sync/upstream-${SHORT} instead."
  branch="sync/upstream-${SHORT}"
  publish "$branch"
fi
if [[ "$RESULT" != "success" ]]; then
  fail_push "$RESULT"
fi

if [[ "$ELEVATED" == true ]]; then
  ci_note="Este PR lo abre un token que no es el GITHUB_TOKEN del workflow (${TOKEN_KIND}). Los workflows \`pull_request\`, incluido CI, sí deben ejecutarse."
else
  ci_note="Este PR lo abre \`GITHUB_TOKEN\`. GitHub no dispara otros workflows con eventos creados por ese token, así que CI no corre solo. Para que CI corra, configura \`UPSTREAM_SYNC_TOKEN\` o la GitHub App descritos en \`.github/workflows/sync-upstream.yml\` y vuelve a lanzar este workflow, o cierra y reabre el PR con una cuenta humana."
fi

body_file="$(mktemp)"
{
  echo "## Resumen"
  echo
  echo "Trae \`main\` de [cloudflare/vibesdk](https://github.com/cloudflare/vibesdk) (\`${SHORT}\`) a este fork."
  echo
  echo "El workflow solo publica la rama \`${branch}\` y abre este PR. No hace push a \`main\`. Si hay conflictos, se resuelven en este PR; \`main\` sigue intacto."
  echo
  echo "## Notas"
  echo
  echo "- Si \`sync/upstream-main\` no puede avanzar en fast-forward, el workflow no la reescribe. Publica \`sync/upstream-<sha>\`."
  echo "- Un fallo de autenticación, de red o de permiso sobre \`.github/workflows/\` no se trata como un fast-forward rechazado."
  echo "- ${ci_note}"
  if [[ "$held_back" == true ]]; then
    echo "- Los archivos bajo \`.github/workflows/\` se dejaron como están en este fork, porque el token no puede modificarlos:"
    for file in "${workflow_files[@]}"; do
      echo "  - \`${file}\`"
    done
  fi
  echo "- No mezclar este PR mientras GitHub reporte conflictos."
} > "$body_file"

title="chore: sincronizar con cloudflare/vibesdk main"
existing="$(open_pr_number "$branch")"
if [[ -n "$existing" ]]; then
  gh pr edit "$existing" --title "$title" --body-file "$body_file"
  echo "Updated pull request #${existing}."
else
  gh pr create --base main --head "$branch" --title "$title" --body-file "$body_file"
fi
