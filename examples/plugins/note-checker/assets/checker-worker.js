self.onmessage = event => {
  const issues = [];
  String(event.data).split('\n').forEach((line, i) => {
    if (issues.length >= 200) return;
    if (/[\t ]+$/.test(line)) issues.push({ line: i + 1, key: 'trailingWhitespace' });
    if (issues.length < 200 && /\b(TODO|FIXME)\b/.test(line)) issues.push({ line: i + 1, key: 'todoMarker' });
  });
  self.postMessage({ issues });
};
