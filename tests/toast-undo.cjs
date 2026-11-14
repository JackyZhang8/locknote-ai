const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Resolve pointer-events declarations affecting the toast in stylesheet order.
function pointerEvents(classes) {
  const css = fs.readFileSync('frontend/src/styles.css', 'utf8').split('/*').map((part, index) => index ? part.slice(part.indexOf('*/') + 2) : part).join('');
  let value = 'auto';
  for (const rule of css.matchAll(/([^{}]+)[{]([^{}]*)[}]/g)) {
    const matches = rule[1].trim().split(',').some(selector => {
      selector = selector.trim();
      return selector === '.toast' || (classes.includes('show') && selector === '.toast.show');
    });
    if (!matches) continue;
    for (const declaration of rule[2].split(';')) {
      const [property, setting] = declaration.split(':').map(part => part.trim());
      if (property === 'pointer-events') value = setting;
    }
  }
  return value;
}

test('visible deletion toast accepts clicks on its undo button', () => {
  assert.equal(pointerEvents(['toast', 'show']), 'auto');
});

test('hidden toast does not intercept clicks on the workspace', () => {
  assert.equal(pointerEvents(['toast']), 'none');
});
