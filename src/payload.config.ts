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
import { Tenants } from "./collections/Tenants";
import { LegalPages } from "./collections/LegalPages";
import { AuditLogs } from "./collections/AuditLogs";
import { Reports } from "./collections/Reports";
import { Conversations } from "./collections/Conversations";
import { Messages } from "./collections/Messages";
import { Invites } from "./collections/Invites";
import { PrivateMedia } from "./collections/PrivateMedia";
import { RiderProfiles } from "./collections/RiderProfiles";
import { MAX_UPLOAD_BYTES } from "./lib/image-upload";
import { devConsoleEmailAdapter } from "./modules/email/dev-console-adapter";
import { Settings } from "./globals/Settings";

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
    components: {
      // Sellers' floating chat (chat head) on every admin page; nothing shows for the super-admin
      providers: ["/components/admin/seller-chat-head#SellerChatHead"],
    },
  },
  collections: [
    Users,
    Invites,
    RiderProfiles,
    Media,
    PrivateMedia,
    Categories,
    Products,
    Tenants,
    LegalPages,
    Reports,
    Conversations,
    Messages,
    AuditLogs,
  ],
  // Max 5 MB per uploaded file (CLAUDE.md §10.8)
  upload: {
    limits: { fileSize: MAX_UPLOAD_BYTES },
  },
  globals: [Settings],
  editor: lexicalEditor(),
  // Dev: print emails (with links) to the terminal. Production: a real email service is added
  // before launch (Resend) — until then Payload refuses to pretend it sent anything.
  email: process.env.NODE_ENV === "production" ? undefined : devConsoleEmailAdapter,
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
