import test from 'node:test'
import assert from 'node:assert/strict'
import { blockWorkspaceShortcut } from './history/keyboard.js'
test('modal blocks workspace commands while keeping native copy and selection',()=>{for(const key of ['n','k','s','p'])assert.equal(blockWorkspaceShortcut({key,ctrlKey:true,metaKey:false,altKey:false}),true);for(const key of ['c','a','ArrowDown'])assert.equal(blockWorkspaceShortcut({key,ctrlKey:true,metaKey:false,altKey:false}),false)})
