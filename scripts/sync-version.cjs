// VERSION is the only editable application version. Wails requires numeric metadata.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (!/^v\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('VERSION must have the format vMAJOR.MINOR.PATCH');
}
const file = path.join(root, 'wails.json');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.info = { ...config.info, productVersion: version.slice(1) };
const output = JSON.stringify(config, null, 2) + '\n';
if (fs.readFileSync(file, 'utf8') !== output) fs.writeFileSync(file, output);
console.log(version);
