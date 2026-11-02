import {assert} from './errors.js';

/** SQL identifiers are internal aliases. Profile names remain bound database
 * values; no display name or request parameter is interpolated into SQL. */
export function publisherNameSql(seriesAlias='s',userAlias='u'){
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(seriesAlias)&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(userAlias),400,'INVALID_SQL_ALIAS','Invalid publisher query alias.');
  return `COALESCE((SELECT p.display_name FROM series_publisher_profiles a JOIN publisher_profiles p ON p.id=a.publisher_id WHERE a.series_id=${seriesAlias}.id),(SELECT p.display_name FROM publisher_profiles p WHERE p.is_official=1 AND p.legacy_owner_id=${seriesAlias}.creator_id),${userAlias}.name)`;
}
