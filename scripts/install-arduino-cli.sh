#!/bin/sh
set -eu

VERSION="1.5.1"
BINDIR="${BINDIR:-/usr/local/bin}"

# SHA-256 values for the official Arduino CLI v1.5.1 release assets.
case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    ASSET="arduino-cli_${VERSION}_Linux_64bit.tar.gz"
    SHA256="28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b"
    ;;
  Linux:aarch64|Linux:arm64)
    ASSET="arduino-cli_${VERSION}_Linux_ARM64.tar.gz"
    SHA256="1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62"
    ;;
  *)
    echo "Unsupported Arduino CLI install platform: $(uname -s)/$(uname -m)" >&2
    exit 1
    ;;
esac

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ARCHIVE="$WORK_DIR/$ASSET"
URL="https://github.com/arduino/arduino-cli/releases/download/v${VERSION}/${ASSET}"

curl -fsSL "$URL" -o "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | sha256sum -c -
tar -xzf "$ARCHIVE" -C "$WORK_DIR" arduino-cli
mkdir -p "$BINDIR"
install -m 0755 "$WORK_DIR/arduino-cli" "$BINDIR/arduino-cli"

ACTUAL_VERSION="$("$BINDIR/arduino-cli" version)"
printf '%s\n' "$ACTUAL_VERSION"
printf '%s\n' "$ACTUAL_VERSION" | grep -Fq "Version: ${VERSION} " || {
  echo "Expected Arduino CLI ${VERSION}" >&2
  exit 1
}
