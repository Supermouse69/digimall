// Adds sample products to the test stores so the product cards can be tried out.
// Writes to the database (only ADDS documents) — dev database only.
//   Add:    bun run seed:mock
//   Remove: bun run seed:mock --remove   (deletes only products/images marked [MOCK])
import sharp from "sharp";
import { getPayload } from "payload";
import config from "@payload-config";

const MARKER = "[MOCK]";

type MockItem = { name: string; price: number; color: string; description: string };

const MOCK_PRODUCTS: Record<string, MockItem[]> = {
  ianpogi: [
    { name: "Rice 1 kg", price: 55, color: "#E9DCC0", description: "Well-milled white rice, repacked per kilo." },
    { name: "Canned Sardines in Tomato Sauce", price: 25, color: "#F2B5A7", description: "155 g can." },
    { name: "Instant Pancit Canton", price: 18, color: "#F7D57A", description: "Original flavor, 1 pack." },
    { name: "3-in-1 Coffee (10 sachets)", price: 75, color: "#C9A27E", description: "Bundle of 10 sachets." },
    { name: "Laundry Powder Sachet", price: 15, color: "#A9D3F5", description: "Good for one wash." },
    { name: "Fresh Eggs (12 pcs)", price: 96, color: "#F5E6C8", description: "Medium size, one dozen." },
  ],
  zaritenant: [
    { name: "Pandesal (10 pcs)", price: 30, color: "#E8C38F", description: "Baked fresh every morning." },
    { name: "Softdrink 1.5 L", price: 75, color: "#B9E3C6", description: "Cola, chilled on request." },
    { name: "Potato Chips", price: 20, color: "#F9E08B", description: "Small pack, cheese flavor." },
    { name: "Bottled Water 500 mL", price: 15, color: "#BFE0F7", description: "Purified drinking water." },
    { name: "Sliced Bread Loaf", price: 65, color: "#EBCB9E", description: "Classic white loaf." },
    { name: "Ice Candy (Buko)", price: 10, color: "#E3F1E0", description: "Homemade, one piece." },
  ],
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Simple generated product picture: colored background + a bag icon + the product name.
const makeImage = async (item: MockItem): Promise<Buffer> => {
  const words = item.name.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 16) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  const text = lines
    .slice(0, 3)
    .map((line, i) => `<text x="300" y="${430 + i * 52}" text-anchor="middle">${escapeXml(line)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="600" height="600" fill="${item.color}"/>
    <g fill="none" stroke="#3A3A35" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
      <path d="M210 170h180l-14 170a14 14 0 0 1-14 13H238a14 14 0 0 1-14-13z"/>
      <path d="M260 185v-30a40 40 0 0 1 80 0v30"/>
    </g>
    <g font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#2B2B27">${text}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
};

const run = async () => {
  const payload = await getPayload({ config });
  const remove = process.argv.includes("--remove");

  if (remove) {
    const products = await payload.delete({
      collection: "products",
      where: { description: { contains: MARKER } },
    });
    const media = await payload.delete({
      collection: "media",
      where: { alt: { contains: MARKER } },
    });
    console.log(`Removed ${products.docs.length} mock products and ${media.docs.length} mock images.`);
    return;
  }

  for (const [slug, items] of Object.entries(MOCK_PRODUCTS)) {
    const tenant = (
      await payload.find({ collection: "tenants", where: { slug: { equals: slug } }, limit: 1 })
    ).docs[0];
    if (!tenant) {
      console.log(`Store "${slug}" not found — skipped.`);
      continue;
    }

    for (const item of items) {
      const existing = await payload.find({
        collection: "products",
        where: { and: [{ name: { equals: item.name } }, { tenant: { equals: tenant.id } }] },
        limit: 1,
      });
      if (existing.docs.length > 0) {
        console.log(`  ${slug}: "${item.name}" already exists — skipped.`);
        continue;
      }

      const data = await makeImage(item);
      const fileName = `mock-${slug}-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.webp`;
      const image = await payload.create({
        collection: "media",
        data: { alt: `${MARKER} ${item.name}` },
        file: { data, mimetype: "image/webp", name: fileName, size: data.length },
      });

      await payload.create({
        collection: "products",
        data: {
          name: item.name,
          price: item.price,
          description: `${MARKER} ${item.description}`,
          image: image.id,
          cover: image.id,
          tenant: tenant.id,
        },
      });
      console.log(`  ${slug}: added "${item.name}" (₱${item.price})`);
    }
  }
  console.log("Done.");
};

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error("Mock seeding failed:", error);
  process.exit(1);
}
