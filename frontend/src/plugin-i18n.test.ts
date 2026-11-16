import test from 'node:test'
import assert from 'node:assert/strict'
import { translate, localizeManifest } from './plugins/i18n.js'
import type { PluginManifest } from './plugins/types.js'
const manifest: PluginManifest = {
 id: 'example.locale', name: 'Raw name', description: 'Raw description', version: '0.1.0', apiVersion: 1, minAppVersion: '0.1.0', entry: 'main.js', capabilities: [], defaultLocale: 'en',
 locales: { en: { name: 'Outline', 'commands.open': 'Open outline', greeting: 'Hello {name}', empty: '' }, zh: { name: '大纲', description: '笔记标题导航', greeting: '你好 {name}' }, 'zh-TW': { name: '大綱' } },
 commands: [{ id: 'open', title: 'Raw command' }],
}
test('plugin localization resolves exact locale, language, default and raw fallback', () => {
 assert.equal(localizeManifest(manifest, 'zh-TW').name, '大綱')
 assert.equal(localizeManifest(manifest, 'zh-CN').name, '大纲')
 assert.equal(localizeManifest(manifest, 'fr-FR').name, 'Outline')
 assert.equal(localizeManifest(manifest, 'zh-CN').commands![0].title, 'Open outline')
 assert.equal(localizeManifest(manifest, 'en').description, 'Raw description')
 assert.equal(translate(manifest, 'en', 'empty', {}, 'Fallback'), 'Fallback')
 assert.equal(translate(manifest, 'en', 'greeting', { name: '$& <Ada>' }), 'Hello $& <Ada>')
 assert.equal(manifest.name, 'Raw name')
})
