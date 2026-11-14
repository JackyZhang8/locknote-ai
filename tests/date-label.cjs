const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('frontend/src/controller.js','utf8');
const format=source.slice(source.indexOf('  function dateLabel('),source.indexOf('  function scopeLabel('));
function label(now,stamp,zone='Asia/Shanghai'){
 process.env.TZ=zone;
 const NativeDate=Date;
 class FixedDate extends NativeDate{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return new NativeDate(now).getTime();}
 }
 return vm.runInNewContext(format+'; dateLabel(stamp)',{Date:FixedDate,stamp,DAY:86400000,tr:s=>s});
}
test('yesterday evening is yesterday even when less than 24 hours ago',()=>{
 assert.equal(label('2026-11-15T10:00:00+08:00','2026-11-14T21:11:00+08:00'),'昨天 21:11');
});
test('local calendar dates handle UTC timestamps and month/year boundaries',()=>{
 assert.equal(label('2026-11-15T00:05:00+08:00','2026-11-14T16:01:00Z'),'今天 00:01');
 assert.equal(label('2026-03-01T00:05:00+08:00','2026-02-28T23:59:00+08:00'),'昨天 23:59');
 assert.equal(label('2027-01-01T00:05:00+08:00','2026-12-31T23:59:00+08:00'),'昨天 23:59');
});
test('calendar day counting survives short and long daylight saving days',()=>{
 assert.equal(label('2026-03-09T00:10:00-04:00','2026-03-08T00:20:00-05:00','America/New_York'),'昨天 00:20');
 assert.equal(label('2026-11-01T23:50:00-05:00','2026-11-01T00:10:00-04:00','America/New_York'),'今天 00:10');
});
test('future calendar dates are not called today, invalid input remains empty',()=>{
 assert.equal(label('2026-11-15T10:00:00+08:00','2026-11-16T21:11:00+08:00'),'2026-11-16 21:11');
 assert.equal(label('2026-11-15T10:00:00+08:00','invalid'),'');
 assert.equal(label('2026-11-15T10:00:00+08:00',''),'');
});
