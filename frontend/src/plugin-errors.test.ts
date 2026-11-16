import test from 'node:test'
import assert from 'node:assert/strict'
import { responseError } from './plugins/errors.js'
test('plugin transport preserves stable server codes and classifies HTTP failures', () => {
 const conflict = responseError(409, { error: 'Changed', code: 'CONFIG_CONFLICT' })
 assert.equal(conflict.code, 'CONFIG_CONFLICT');assert.equal(conflict.status, 409);assert.equal(conflict.message, 'Changed')
 assert.equal(responseError(403, {}).code, 'FORBIDDEN');assert.equal(responseError(429, {}).code, 'RATE_LIMITED')
})
