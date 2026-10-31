#!/usr/bin/env bash
# Builds the release image for amd64 and arm64 and pushes it to every repository in RELEASE_IMAGES.
# semantic-release runs this in its prepare step, so a failed push stops the release before any tag exists.
set -euo pipefail

version="$1"
repo_url="https://github.com/${GITHUB_REPOSITORY:-halitsever/girici-web-proxy}"

tags=()
for image in ${RELEASE_IMAGES:?set RELEASE_IMAGES to the image repositories to push}; do
  tags+=(--tag "$image:$version" --tag "$image:${version%.*}" --tag "$image:v${version%%.*}" --tag "$image:latest")
done

metadata="$(mktemp)"
docker buildx build . \
  --platform linux/amd64,linux/arm64 \
  --build-arg "GIRICI_VERSION=$version" \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=${GITHUB_SHA:-unknown}" \
  --label "org.opencontainers.image.source=$repo_url" \
  --label "org.opencontainers.image.licenses=AGPL-3.0-only" \
  --annotation "index:org.opencontainers.image.source=$repo_url" \
  --annotation "index:org.opencontainers.image.description=Girici, a self-hosted web proxy" \
  --annotation "index:org.opencontainers.image.licenses=AGPL-3.0-only" \
  --provenance=true \
  --sbom=true \
  --metadata-file "$metadata" \
  "${tags[@]}" \
  --push

digest="$(jq -r '."containerimage.digest"' "$metadata")"
echo "Pushed $version as $digest"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "digest=$digest" >> "$GITHUB_OUTPUT"
fi
