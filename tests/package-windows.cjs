const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('Windows probes retain real registry separators and MSI shortcut ownership',()=>{
 const slash=String.fromCharCode(92);
 assert.ok(read('tests/windows/webview2.ps1').includes(['SOFTWARE','Microsoft','EdgeUpdate','Clients'].join(slash)));
 assert.ok(read('tests/windows/install.ps1').includes(['HKLM:','SOFTWARE','Microsoft','Windows','CurrentVersion','Uninstall','*'].join(slash)));
 const wix=read('build/packaging/windows.wxs');
 assert.ok(wix.includes('KeyPath="yes" />'));
 assert.ok(!wix.includes('</File>'));
 assert.ok(wix.includes('ComponentRef Id="StartMenuEntry"'));
});
test('MSI non-advertised shortcut uses a user registry keypath in the menu component',()=>{
 const wix=read('build/packaging/windows.wxs');
 const menu=wix.split('<Directory Id="ProgramMenuFolder">')[1]?.split('</Directory>')[0];
 assert.ok(menu,'Start Menu component must belong to ProgramMenuFolder, not INSTALLFOLDER');
 assert.match(menu,/<Component Id="StartMenuEntry"/);
 assert.match(menu,/<RegistryValue[^>]*Root="HKCU"[^>]*KeyPath="yes"/);
 assert.ok(!menu.includes('<File '),'Do not mix machine files with the shortcut keypath');
 assert.ok(!wix.includes('Root="HKMU"'),'An ambiguous registry root causes ICE57');
 const pack=read('scripts/package-windows.ps1');
 assert.ok(!pack.includes('-sval') && !pack.includes('-sice'),'Keep MSI ICE validation enabled');
});
test('Windows packaging keeps one executable name',()=>{
 const config=JSON.parse(read('wails.json'));assert.equal(config.name,'locknote-ai');assert.equal(config.outputfilename,'locknote-ai');
 const nsis=read('build/windows/installer/project.nsi');assert.match(nsis,/PRODUCT_EXECUTABLE/);assert.ok(!nsis.includes('RMDir /r $INSTDIR'));
 const wix=read('build/packaging/windows.wxs');assert.ok(wix.includes('$(var.AppExe)'));assert.ok(wix.includes('Target='));assert.ok(!wix.includes('Advertise="yes"'));
});
test('MSI links UI and checks WebView2',()=>{
 const wix=read('build/packaging/windows.wxs');assert.match(wix,/WixUI_InstallDir/);assert.match(wix,/WIXUI_INSTALLDIR/);assert.match(wix,/WebView2/);assert.match(wix,/RegistrySearch/);
 const flow=read('.github/workflows/release-v2.yml');assert.match(flow,/WixUIExtension/);assert.ok(flow.includes('tests/windows/acceptance.ps1'));assert.ok(flow.includes('if: always()'));
});
test('MSI payload table splits the literal short-name separator',()=>{
 const script=read('scripts/package-windows.ps1');
 assert.ok(script.includes("[regex]::Escape('|')"));
 assert.ok(!script.includes("-split '|'"));
});
