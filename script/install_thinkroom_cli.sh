#!/bin/sh
set -eu

repository="https://raw.githubusercontent.com/kieranklaassen/thinkroom/main"
install_dir="${THINKROOM_INSTALL_DIR:-$HOME/.local/bin}"
share_dir="$(dirname "$install_dir")/share/thinkroom/skill/thinkroom"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

mkdir -p "$install_dir" "$share_dir/agents"

fetch_file() {
  source_path="$1"
  destination="$2"
  if [ -n "${THINKROOM_SOURCE_ROOT:-}" ]; then
    cp "$THINKROOM_SOURCE_ROOT/$source_path" "$destination"
  else
    curl -fsSL "$repository/$source_path" -o "$destination"
  fi
}

fetch_file "cli/bin/thinkroom.js" "$temporary/thinkroom"
fetch_file "cli/skill/thinkroom/SKILL.md" "$temporary/SKILL.md"
fetch_file "cli/skill/thinkroom/agents/openai.yaml" "$temporary/openai.yaml"

install -m 0755 "$temporary/thinkroom" "$install_dir/thinkroom"
install -m 0644 "$temporary/SKILL.md" "$share_dir/SKILL.md"
install -m 0644 "$temporary/openai.yaml" "$share_dir/agents/openai.yaml"

printf 'Installed Thinkroom CLI at %s\n' "$install_dir/thinkroom"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to PATH, then run: thinkroom init\n' "$install_dir" ;;
esac
