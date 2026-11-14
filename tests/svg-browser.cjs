// Run with PLAYWRIGHT_MODULE and optional CHROMIUM_PATH pointing to local installations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('SVG allowlist removes scripts, events, HTML, styles and external resources',async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage();
  await page.addScriptTag({content:fs.readFileSync('web/svg.js','utf8')});
  const result=await page.evaluate(()=>window.LNSVG.sanitize('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><rect width="20" fill="url(#paint)" style="fill:red"/><image href="https://example.invalid/x"/><circle fill="url(https://example.invalid/x)"/></svg>'));
  assert.match(result,/<rect/);
  assert.match(result,/url(#paint)/);
  assert.doesNotMatch(result,/script|onload|foreignObject|style=|<image|example.invalid/);
  assert.equal(await page.evaluate(()=>window.LNSVG.sanitize('<svg><rect></svg>')),'');
 } finally {await browser.close()}
});
