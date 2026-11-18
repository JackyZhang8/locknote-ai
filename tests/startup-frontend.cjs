const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('frontend milestones are unique and report to the desktop binding',()=>{
 const marks=[],reports=[];const window={go:{main:{desktop:{StartupMark:(...args)=>{reports.push(args)}}}}};
 vm.runInNewContext(fs.readFileSync('frontend/src/runtime/startup.js','utf8'),{window,performance:{now:()=>123,mark:name=>marks.push(name),measure(){}},Promise});
 window.LNStartup.mark('frontend.workspace.start');window.LNStartup.mark('frontend.workspace.start');
 assert.deepEqual(marks,['frontend.entry','frontend.workspace.start']);assert.equal(reports.length,2);
});
test('history and plugin settings are absent from eager imports',()=>{
 const app=fs.readFileSync('frontend/src/App.tsx','utf8');assert.ok(app.includes('lazy('));
 const plugins=fs.readFileSync('frontend/src/plugins/PluginWorkspace.tsx','utf8');assert.ok(!plugins.includes("import { PluginDialog } from './PluginSettings'"));
});
test('boot readiness waits for deep-linked and initial note data, with statistics deferred',()=>{
 const controller=fs.readFileSync('frontend/src/controller.js','utf8');
 assert.ok(controller.includes('return selectNote(state.notes[0].id'));
 assert.ok(controller.includes('return selectNote(noteId, { boot: true })'));
 assert.ok(controller.includes('boot: opts.boot'));
 assert.ok(controller.includes('if (opts && opts.boot) throw err;'));
 assert.ok(controller.includes('.then(function () { ensureFilled(); })'));
 assert.ok(controller.includes('if (!boot) tasks.push(loadStats())'));
});
