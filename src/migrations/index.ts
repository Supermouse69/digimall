import * as migration_20261029_105114_roles_to_single_role from './20261029_105114_roles_to_single_role';
import * as migration_20261029_125942_legal_pages_and_settings from './20261029_125942_legal_pages_and_settings';

export const migrations = [
  {
    up: migration_20261029_105114_roles_to_single_role.up,
    down: migration_20261029_105114_roles_to_single_role.down,
    name: '20261029_105114_roles_to_single_role',
  },
  {
    up: migration_20261029_125942_legal_pages_and_settings.up,
    down: migration_20261029_125942_legal_pages_and_settings.down,
    name: '20261029_125942_legal_pages_and_settings'
  },
];
