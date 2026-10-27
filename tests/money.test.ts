import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseUsdCents} from '../shared/money';

test('USD input converts ordinary decimal strings into exact integer cents without a US$200 ceiling',()=>{
  for(const [input,cents] of [['0',0],['0.10',10],['5',500],['5.0',500],['5.01',501],['10.99',1099],['1.15',115],['234.56',23456],['500',50000],['999999.99',99999999],[' 5.00 ',500],['000005.05',505]] as const)assert.equal(parseUsdCents(input),cents,input);
});

test('USD input rejects fractional cents, numeric shortcuts and amounts outside the provider range',()=>{
  for(const input of ['', ' ', '-5','+5','5.001','5.999','1e3','0x20','NaN','Infinity','5,00','1000000','1000000.00','9007199254740992.00'])assert.equal(parseUsdCents(input),null,input);
});
