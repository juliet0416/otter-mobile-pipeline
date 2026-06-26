#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="${HOME}/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PROFILE_DIR" .private

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env: ${name}" >&2
    exit 1
  fi
}

decode_base64_file() {
  local value="$1"
  local output="$2"
  printf '%s' "$value" | base64 --decode > "$output"
}

install_profile() {
  local secret_name="$1"
  local output_prefix="$2"
  local encoded="${!secret_name:-}"
  if [ -z "$encoded" ]; then
    echo "Missing required env: ${secret_name}" >&2
    exit 1
  fi

  local raw_path=".private/${output_prefix}.mobileprovision"
  local plist_path=".private/${output_prefix}.plist"
  decode_base64_file "$encoded" "$raw_path"
  security cms -D -i "$raw_path" > "$plist_path"

  local uuid
  uuid=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$plist_path")
  local name
  name=$(/usr/libexec/PlistBuddy -c 'Print Name' "$plist_path")
  cp "$raw_path" "${PROFILE_DIR}/${uuid}.mobileprovision"

  echo "${output_prefix}_uuid=${uuid}" >> "$GITHUB_OUTPUT"
  echo "${output_prefix}_name=${name}" >> "$GITHUB_OUTPUT"
  echo "[ios-signing] installed ${output_prefix} profile: ${name}"
}

require_env IOS_DISTRIBUTION_CERT_BASE64
require_env IOS_CERT_PASSWORD
require_env IOS_KEYCHAIN_PASSWORD

CERT_PATH=".private/apple-distribution.p12"
KEYCHAIN_PATH="${RUNNER_TEMP}/mobile-signing.keychain-db"
decode_base64_file "$IOS_DISTRIBUTION_CERT_BASE64" "$CERT_PATH"

security create-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$CERT_PATH" -P "$IOS_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g')
security default-keychain -s "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

install_profile IOS_PROFILE_APP_BASE64 app
if [ -n "${IOS_PROFILE_WIDGET_BASE64:-}" ]; then
  install_profile IOS_PROFILE_WIDGET_BASE64 widget
else
  echo "widget_uuid=" >> "$GITHUB_OUTPUT"
  echo "widget_name=" >> "$GITHUB_OUTPUT"
fi

echo "keychain_path=${KEYCHAIN_PATH}" >> "$GITHUB_OUTPUT"
echo "[ios-signing] certificate imported into temporary keychain"
