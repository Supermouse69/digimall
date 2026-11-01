import { Navbar } from "@/modules/home/ui/components/navbar";
import { Footer } from "@/modules/home/ui/components/footer";
import { requireCurrentConsent } from "@/modules/legal/server/require-consent";

// Cart, checkout, orders: the normal navbar without the search bar
const Layout = async ({ children }: { children: React.ReactNode }) => {
  await requireCurrentConsent();
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 bg-[#F4F4F0]">{children}</main>
      <Footer />
    </div>
  );
};

export default Layout;
