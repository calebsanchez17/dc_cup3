import test from 'node:test';
import assert from 'node:assert/strict';
import {PLACE_POINTS,pointsFor,standings} from './scoring.js';

test('puntos por posición y baja',()=>{
  assert.deepEqual(PLACE_POINTS.slice(1),[12,9,8,7,6,5,4,3,2,1,0,0]);
  assert.equal(pointsFor(1,7),19);
  assert.equal(pointsFor(12,4),4);
});

test('ranking ordena por puntos, booyahs y bajas',()=>{
  const teams=[{id:1,name:'DC'},{id:2,name:'B'}];
  const rooms=[{id:1},{id:2}];
  const results=[
    {roomId:1,teamId:1,placement:1,kills:4},
    {roomId:1,teamId:2,placement:2,kills:7},
    {roomId:2,teamId:1,placement:3,kills:3},
    {roomId:2,teamId:2,placement:4,kills:2},
  ];
  const table=standings(teams,rooms,results,0);
  assert.equal(table[0].id,1);
  assert.equal(table[0].booyahs,1);
});

test('Booyah de Oro al llegar a 90 en una victoria',()=>{
  const teams=[{id:1,name:'DC'},{id:2,name:'B'}];
  const rooms=Array.from({length:6},(_,i)=>({id:i+1}));
  const results=rooms.map(room=>({roomId:room.id,teamId:1,placement:1,kills:3}));
  const table=standings(teams,rooms,results,90);
  assert.equal(table[0].points,90);
  assert.equal(table[0].booyahs,6);
  assert.equal(table[0].goldBooyahs,1);
  assert.equal(table[1].points,0);
});
