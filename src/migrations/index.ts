import * as migration_20261029_105114_roles_to_single_role from './20261029_105114_roles_to_single_role';

export const migrations = [
  {
    up: migration_20261029_105114_roles_to_single_role.up,
    down: migration_20261029_105114_roles_to_single_role.down,
    name: '20261029_105114_roles_to_single_role'
  },
];
