import Link from "next/link";

// Small centered card for the one-step auth pages (verify email, forgot/reset password)
export const AuthCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <main className="min-h-screen bg-[#F4F4F0] flex items-center justify-center p-4">
    <div className="max-w-md w-full flex flex-col gap-4">
      <Link href="/" className="font-semibold text-2xl">DigiMall</Link>
      <div className="bg-white border rounded-md p-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  </main>
);
