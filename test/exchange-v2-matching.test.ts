import { expect, test } from 'vitest';
import { findDirectMatches, findThreeWayCycles, matchKey, type MatchIntent } from '../backend/exchange-v2/matching';

test('matches explicit direct and three-way target edges without treating open intent as consent',()=>{
  const a:MatchIntent={id:'a',ownerUserId:'a',sourceAssignmentId:'X',targets:['Y']};
  const b:MatchIntent={id:'b',ownerUserId:'b',sourceAssignmentId:'Y',targets:['X','Z']};
  const c:MatchIntent={id:'c',ownerUserId:'c',sourceAssignmentId:'Z',targets:[]};
  expect(findDirectMatches(a,[a,b,c])).toEqual([{intentIds:['a','b'],consented:[true,true]}]);
  expect(findThreeWayCycles(a,[a,b,c])).toEqual([{intentIds:['a','b','c'],consented:[true,true,false]}]);
});

test('cycle keys deduplicate rotations but distinguish different exact outcomes',()=>{
  expect(matchKey('DUTY_OPS',['a','b','c'])).toBe(matchKey('DUTY_OPS',['b','c','a']));
  expect(matchKey('DUTY_OPS',['a','b','c'])).not.toBe(matchKey('DUTY_OPS',['a','c','b']));
});
