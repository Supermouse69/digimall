import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";
import { Config } from './payload-types';

import { isSuperAdmin } from "./lib/access";
import { Categories } from "./collections/Categories";
import { Media } from "./collections/Media";
import { Users } from "./collections/Users";
import { Products } from "./collections/Products";
import { Tags } from "./collections/Tags";
import { Tenants } from "./collections/Tenants";

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Fail fast with a clear message instead of silently running with an empty secret
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
};

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Categories, Products, Tags, Tenants],
  editor: lexicalEditor(),
  // Not used (the app uses tRPC + REST); off to shrink the attack surface
  graphQL: {
    disable: true,
  },
  secret: requireEnv("PAYLOAD_SECRET"),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: requireEnv("DATABASE_URI"),
  }),
  sharp,
  plugins: [
    multiTenantPlugin<Config>({
      collections: {
        products: {},
      },
      tenantsArrayField: {
        includeDefaultField: false,
      },
      userHasAccessToAllTenants: (user) => isSuperAdmin(user),
    }),
    // storage-adapter-placeholder
  ],
})
