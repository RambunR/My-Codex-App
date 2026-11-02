import test from 'node:test';
import assert from 'node:assert/strict';
import {responseSecurityHeaders} from '../shared/security-headers';

test('pages and APIs prohibit framing, active embedded objects and MIME sniffing without blocking hosted auth or payment navigation',()=>{
  for(const route of ['/','/studio','/wallet','/api/wallet','/assets/app.js']){
    const headers=responseSecurityHeaders(route);
    assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.equal(headers['X-Frame-Options'],'DENY');
    assert.equal(headers['Referrer-Policy'],'strict-origin-when-cross-origin');
    assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);assert.match(headers['Content-Security-Policy'],/object-src 'none'/);assert.match(headers['Content-Security-Policy'],/base-uri 'self'/);
    assert.doesNotMatch(headers['Content-Security-Policy'],/script-src|connect-src|navigate-to|form-action/);
  }
});
test('login and provider callback URLs suppress referrer disclosure',()=>{
  for(const route of ['/auth','/api/auth/google/callback','/api/auth/apple/callback','/api/auth/reset-password'])assert.equal(responseSecurityHeaders(route)['Referrer-Policy'],'no-referrer');
});
