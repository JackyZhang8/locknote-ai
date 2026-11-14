const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Linux packaging uses the standalone appimagetool repository and emits both formats', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locknote-packaging-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'build/bin', 'mock-bin']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../scripts/package-linux.sh'), path.join(root, 'scripts/package-linux.sh'));
  fs.writeFileSync(path.join(root, 'VERSION'), 'v0.1.0\n');
  fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT');
  fs.writeFileSync(path.join(root, 'build/appicon.png'), 'icon');
  fs.writeFileSync(path.join(root, 'build/bin/locknote-ai'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'mock-bin/dpkg-deb'), '#!/bin/bash\nset -eu\ntouch "${@: -1}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'mock-bin/curl'), `#!/bin/bash
set -eu
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  https://github.com/AppImage/appimagetool/releases/*/appimagetool-x86_64.AppImage) ;;
  *) echo "Unsupported appimagetool release URL: $url" >&2; exit 22 ;;
esac
cat > "$output" <<'TOOL'
#!/bin/bash
set -eu
test "$1" = '--appimage-extract-and-run'
test -x "$2/AppRun"
test -x "$2/usr/bin/locknote-ai"
test -f "$2/locknote-ai.desktop"
test -f "$2/locknote-ai.png"
touch "$3"
TOOL
`, { mode: 0o755 });
  const result = spawnSync('bash', ['scripts/package-linux.sh'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}/mock-bin:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  for (const ext of ['deb', 'AppImage']) assert.ok(fs.existsSync(path.join(root, `dist/locknote-ai-0.1.0-linux.${ext}`)));
});
