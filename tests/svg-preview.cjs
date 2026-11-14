const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const window={LNSVG:{sanitize:source=>source}};
vm.runInNewContext(fs.readFileSync('web/markdown.js','utf8'),{window});
test('SVG blocks get a safe image preview and source disclosure',()=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>';
 const fenced=['```svg',svg,'```'].join(String.fromCharCode(10));
 assert.match(window.LNMarkdown.render(svg),/svg-preview/);
 assert.match(window.LNMarkdown.render(fenced),/data-diagram-mode/);
 assert.match(window.LNMarkdown.render(fenced),/&lt;svg/);
 assert.doesNotMatch(window.LNMarkdown.render(['```html',svg,'```'].join(String.fromCharCode(10))),/svg-preview/);
});
test('Mermaid and flowchart direction fences provide diagram controls',()=>{
 for (const language of ['mermaid','flowchart LR']) {
  const html=window.LNMarkdown.render(['```'+language,'A-->B','```'].join(String.fromCharCode(10)));
  assert.match(html,/data-diagram/);
  assert.match(html,/data-diagram-mode/);
  assert.match(html,/A--&gt;B/);
 }
});
