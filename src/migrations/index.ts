import * as migration_20261029_105114_roles_to_single_role from './20261029_105114_roles_to_single_role';
import * as migration_20261029_125942_legal_pages_and_settings from './20261029_125942_legal_pages_and_settings';
import * as migration_20261031_002034_mark_existing_users_verified from './20261031_002034_mark_existing_users_verified';
import * as migration_20261031_091554_phase3_stores_products from './20261031_091554_phase3_stores_products';

export const migrations = [
  {
    up: migration_20261029_105114_roles_to_single_role.up,
    down: migration_20261029_105114_roles_to_single_role.down,
    name: '20261029_105114_roles_to_single_role',
  },
  {
    up: migration_20261029_125942_legal_pages_and_settings.up,
    down: migration_20261029_125942_legal_pages_and_settings.down,
    name: '20261029_125942_legal_pages_and_settings',
  },
  {
    up: migration_20261031_002034_mark_existing_users_verified.up,
    down: migration_20261031_002034_mark_existing_users_verified.down,
    name: '20261031_002034_mark_existing_users_verified',
  },
  {
    up: migration_20261031_091554_phase3_stores_products.up,
    down: migration_20261031_091554_phase3_stores_products.down,
    name: '20261031_091554_phase3_stores_products'
  },
];
