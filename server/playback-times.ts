import {assert} from './errors.js';

// Existing databases enforce a 180000 cap on the original session fields.
// The additive table carries longer actual totals without rebuilding sessions
// or their episode, purchase and progress relationships.
export const LEGACY_PLAYBACK_MAX_MS=180_000;
export function playbackTimeSql(alias='p',field:'watched_ms'|'reported_ms'='watched_ms'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias),400,'INVALID_SQL_ALIAS','Invalid playback query alias.');
  assert(field==='watched_ms'||field==='reported_ms',400,'INVALID_SQL_ALIAS','Invalid playback time field.');
  return `COALESCE((SELECT t.${field} FROM playback_session_times_long t WHERE t.session_id=${alias}.id),(SELECT t.${field} FROM playback_session_times_extended t WHERE t.session_id=${alias}.id),(SELECT t.${field} FROM playback_session_times t WHERE t.session_id=${alias}.id),${alias}.${field})`;
}
export function playbackSessionFieldsSql(alias='p'){
  const times=`${playbackTimeSql(alias)} AS watched_ms,${playbackTimeSql(alias,'reported_ms')} AS reported_ms`;
  return `${alias}.id,${alias}.episode_id,${alias}.viewer_key,${alias}.started_at_ms,${alias}.last_seen_ms,${times},${alias}.counted_view,${alias}.qualified_at_ms`;
}
