import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {multiTenantPlugin} from "@payloadcms/plugin-multi-tenant";
import {payloadCloudPlugin} from "@payloadcms/payload-cloud"
import {Config} from './payload-types';

//import { Users } from "collections/Users";

import { Categories } from "./app/collections/Categories";
import { Media } from "./app/collections/Media";
import { Users } from "./app/collections/Users";
import { Products } from "./app/collections/Products";
import { Tags } from "./app/collections/Tags";
import { Tenants } from "./app/collections/Tenants";

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Categories, Products, Tags, Tenants],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URL || '',
  }),
  sharp,
  plugins: [
    payloadCloudPlugin(),
    multiTenantPlugin<Config>({
      collections: {
        products: {},
      },
      tenantsArrayField: {
        includeDefaultField: false,
      },
      userHasAccessToAllTenants: (user) => Boolean(user?.roles?.includes("super-admin"))
    }),
    // storage-adapter-placeholder
  ],
})