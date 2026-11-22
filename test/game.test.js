import test from 'node:test';
import assert from 'node:assert/strict';
import {newBoard,playLine} from '../game.js';
test('board starts empty and has expected dimensions',()=>{
 const b=newBoard(3);assert.equal(b.horizontal.length,3);assert.equal(b.vertical.length,2);assert.equal(b.boxes.length,2);
});
test('closing a box awards its ownership to closer',()=>{
 const b=newBoard(2);
 assert.deepEqual(playLine(b,'h',0,0,'A').claimed,[]);
 playLine(b,'v',0,0,'B');playLine(b,'v',0,1,'A');
 const result=playLine(b,'h',1,0,'B');
 assert.deepEqual(result.claimed,[[0,0]]);assert.equal(result.complete,true);assert.equal(b.boxes[0][0],'B');
});
test('rejects duplicate or invalid moves',()=>{
 const b=newBoard(2);playLine(b,'h',0,0,'A');
 assert.match(playLine(b,'h',0,0,'A').error,/already/);
 assert.match(playLine(b,'h',20,0,'A').error,/bounds/);
 assert.match(playLine(b,'x',0,0,'A').error,/Invalid/);
});
test('single line can complete two boxes',()=>{
 const b=newBoard(3);
 for(const [o,r,c] of [['h',0,0],['h',0,1],['v',0,0],['v',0,2],['h',1,0],['h',1,1]]) playLine(b,o,r,c,'A');
 const result=playLine(b,'v',0,1,'B');
 assert.equal(result.claimed.length,2);
 assert.equal(b.boxes[0][0],'B');assert.equal(b.boxes[0][1],'B');
});
