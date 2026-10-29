import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RichText } from "@payloadcms/richtext-lexical/react";

import { LEGAL_PAGE_SLUGS, type LegalPageSlug } from "@/collections/LegalPages";
import { caller } from "@/trpc/server";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

const isLegalSlug = (slug: string): slug is LegalPageSlug =>
  (LEGAL_PAGE_SLUGS as readonly string[]).includes(slug);

export const generateMetadata = async ({ params }: Props): Promise<Metadata> => {
  const { slug } = await params;
  if (!isLegalSlug(slug)) return {};
  const page = await caller.legal.getOne({ slug }).catch(() => null);
  return page ? { title: `${page.title} · DigiMall` } : {};
};

// Public legal pages. The text is written by the developer in the Payload admin.
const Page = async ({ params }: Props) => {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();

  const page = await caller.legal.getOne({ slug }).catch(() => null);
  if (!page) notFound();

  const updated = new Date(page.publishedAt ?? page.updatedAt).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-[#F4F4F0]">
      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
        <Link href="/" className="font-semibold text-xl">DigiMall</Link>
        <article className="bg-white border rounded-md p-5 sm:p-8 flex flex-col gap-4">
          <h1 className="text-2xl sm:text-3xl font-semibold">{page.title}</h1>
          <p className="text-sm text-neutral-600">
            Version {page.version} · Updated {updated}
          </p>
          <div className="flex flex-col gap-3 leading-relaxed">
            <RichText data={page.content} />
          </div>
        </article>
      </div>
    </main>
  );
};

export default Page;
