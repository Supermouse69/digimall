import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { buildConfig } from "payload";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";
import { vercelBlobStorage } from "@payloadcms/storage-vercel-blob";
import { s3Storage } from "@payloadcms/storage-s3";
import { resendAdapter } from "@payloadcms/email-resend";
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
import { Fares } from "./collections/Fares";
import { Orders } from "./collections/Orders";
import { StoreOrders } from "./collections/StoreOrders";
import { PushSubscriptions } from "./collections/PushSubscriptions";
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

// On Vercel the disk is temporary: uploads MUST go to real storage there (CLAUDE.md §10.8).
// Locally (dev, tests, `next start`), files stay in ./media and ./private-media unless keys are set.
const onVercel = process.env.VERCEL === "1";
const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const hasR2 = Boolean(process.env.R2_BUCKET && process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
if (onVercel && (!hasBlob || !hasR2)) {
  throw new Error("Missing file storage settings on Vercel (BLOB_READ_WRITE_TOKEN and R2_*). See .env.example.");
}

// Our own site only (CLAUDE.md §10.4). Local addresses only outside Vercel (dev / tests).
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const allowedOrigins = [appUrl, ...(onVercel ? [] : ["http://localhost:3000", "http://127.0.0.1:3000", "http://127.0.0.1:3123"])].filter(
  (origin, index, all) => all.indexOf(origin) === index,
);

// Email: Resend when its key is set; dev prints emails to the terminal; production without a key
// sends nothing (Payload warns) rather than pretending.
const email = process.env.RESEND_API_KEY
  ? resendAdapter({
      apiKey: process.env.RESEND_API_KEY,
      defaultFromAddress: process.env.EMAIL_FROM ?? "no-reply@digimall.online",
      defaultFromName: "DigiMall",
    })
  : process.env.NODE_ENV === "production"
    ? undefined
    : devConsoleEmailAdapter;

export default buildConfig({
  serverURL: process.env.NEXT_PUBLIC_APP_URL,
  // Logged-in (cookie) requests to /api are only accepted from these origins
  csrf: allowedOrigins,
  cors: allowedOrigins,
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      // Sellers' floating chat (chat head) on every admin page; nothing shows for the super-admin
      providers: ["/components/admin/seller-chat-head#SellerChatHead"],
      // Super-admin to-do queues on the dashboard (nothing shows for sellers)
      beforeDashboard: ["/components/admin/admin-desk#AdminDesk"],
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
    Orders,
    StoreOrders,
    Fares,
    PushSubscriptions,
    AuditLogs,
  ],
  // Max 4 MB per uploaded file (CLAUDE.md §10.8; 4 MB because of Vercel's request limit)
  upload: {
    limits: { fileSize: MAX_UPLOAD_BYTES },
  },
  globals: [Settings],
  editor: lexicalEditor(),
  email,
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
    // PUBLIC images (products, logos): Vercel Blob, served straight from its CDN
    vercelBlobStorage({
      enabled: hasBlob,
      collections: { media: { disablePayloadAccessControl: true } },
      token: process.env.BLOB_READ_WRITE_TOKEN ?? "",
      addRandomSuffix: true,
    }),
    // PRIVATE files (IDs, licenses, receipts, GCash QRs, landmark + chat photos): a PRIVATE
    // Cloudflare R2 bucket. Every download goes through Payload's access check
    // (/api/private-media/file/...), so the bucket itself is never public.
    s3Storage({
      enabled: hasR2,
      collections: { "private-media": true },
      bucket: process.env.R2_BUCKET ?? "",
      config: {
        endpoint: process.env.R2_ENDPOINT,
        region: "auto",
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "" },
        forcePathStyle: true,
      },
    }),
  ],
})
