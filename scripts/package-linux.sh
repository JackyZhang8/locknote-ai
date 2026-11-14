#!/usr/bin/env bash
# Run on the Ubuntu release runner after the desktop build.
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(tr -d '\r\n' < VERSION)"
version="${version#v}"
name="locknote-ai-${version}-linux"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p dist "$work/deb/DEBIAN" "$work/deb/usr/bin" "$work/deb/usr/share/applications" "$work/deb/usr/share/icons/hicolor/256x256/apps" "$work/deb/usr/share/doc/locknote-ai"
install -m755 build/bin/locknote-ai "$work/deb/usr/bin/locknote-ai"
install -m644 build/appicon.png "$work/deb/usr/share/icons/hicolor/256x256/apps/locknote-ai.png"
install -m644 LICENSE "$work/deb/usr/share/doc/locknote-ai/copyright"
cat > "$work/deb/usr/share/applications/locknote-ai.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Locknote AI
Comment=Local-first Markdown notes with AI integration
Exec=locknote-ai
Icon=locknote-ai
Terminal=false
Categories=Office;Utility;
DESKTOP
cat > "$work/deb/DEBIAN/control" <<CONTROL
Package: locknote-ai
Version: $version
Architecture: amd64
Maintainer: Locknote AI contributors
Section: utils
Priority: optional
Depends: libgtk-3-0, libwebkit2gtk-4.0-37
Description: Local-first Markdown notes with an integrated MCP server
CONTROL
dpkg-deb --root-owner-group --build "$work/deb" "dist/$name.deb"

# AppImage carries the application; GTK/WebKit remain platform prerequisites.
appdir="$work/LocknoteAI.AppDir"
mkdir -p "$appdir/usr"
cp -R "$work/deb/usr/." "$appdir/usr/"
cp "$work/deb/usr/share/applications/locknote-ai.desktop" "$appdir/"
cp build/appicon.png "$appdir/locknote-ai.png"
cat > "$appdir/AppRun" <<'APPRUN'
#!/bin/sh
appdir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$appdir/usr/bin/locknote-ai" "$@"
APPRUN
chmod +x "$appdir/AppRun"
curl --fail --location --retry 3 -o "$work/appimagetool" https://github.com/AppImage/AppImageKit/releases/download/13/appimagetool-x86_64.AppImage
chmod +x "$work/appimagetool"
ARCH=x86_64 "$work/appimagetool" --appimage-extract-and-run "$appdir" "dist/$name.AppImage"
