import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotRequest} from './extension/snapshots.mjs';
test('snapshots persist by origin and rule revision, rejecting cross-origin writes',async()=>{
 const values={};const storage={get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)};
 const payload={key:'https://blog.csdn.net|type:/article',revision:'rules-A',entries:[{signature:'descriptor',category:'advertisement'}]};
 await snapshotRequest(storage,'snapshotSet',payload,'https://blog.csdn.net');
 assert.deepEqual((await snapshotRequest(storage,'snapshotGet',payload,'https://blog.csdn.net')).entries,payload.entries);
 assert.deepEqual((await snapshotRequest(storage,'snapshotGet',{...payload,revision:'rules-B'},'https://blog.csdn.net')).entries,[]);
 await assert.rejects(snapshotRequest(storage,'snapshotSet',payload,'https://www.csdn.net'));
 await assert.rejects(snapshotRequest(storage,'snapshotSet',{...payload,entries:[{signature:'a',category:'fake'}]},'https://blog.csdn.net'));
});
