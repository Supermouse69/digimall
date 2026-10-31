import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { cn, formatCurrency, generateTenantURL } from "@/lib/utils";

interface ProductCardProps {
  id: string;
  name: string;
  imageUrl?: string | null;
  tenantSlug: string;
  tenantName: string;
  tenantImageUrl?: string | null;
  price: number;
  isAvailable: boolean;
}

export const ProductCard = ({
  id,
  name,
  imageUrl,
  tenantSlug,
  tenantName,
  tenantImageUrl,
  price,
  isAvailable,
}: ProductCardProps) => {
  const router = useRouter();
  const handleUserClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    router.push(generateTenantURL(tenantSlug));
  };

  return (
    <Link href={`${generateTenantURL(tenantSlug)}/products/${id}`}>
      <div className="hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-shadow border rounded-md bg-white overflow-hidden h-full flex flex-col">
        <div className="relative aspect-square">
          <Image
            alt={name}
            fill
            // Matches the product grid: 1 col on phones, 2 on tablets, 3-4 on wide screens
            sizes="(min-width: 1536px) 25vw, (min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
            src={imageUrl || "/placeholder.svg"}
            className={cn("object-cover", !isAvailable && "opacity-50 grayscale")}
          />
          {!isAvailable && (
            <span className="absolute top-2 left-2 rounded bg-black text-white text-xs font-medium px-2 py-1">
              Not available
            </span>
          )}
        </div>
        <div className="p-4 border-y flex flex-col gap-3 flex-1">
          <h2 className="text-lg font-medium line-clamp-4">{name}</h2>
          <div className="flex items-center gap-2" onClick={handleUserClick}>
            {tenantImageUrl && (
              <Image
                alt={tenantName}
                src={tenantImageUrl}
                width={16}
                height={16}
                className="rounded-full border shrink-0 size-4"
              />
            )}
            <p className="text-sm underline font-medium">{tenantName}</p>
          </div>
        </div>
        <div className= "p-4">
            <div className="relative px-2 py-1 border bg-pink-400 w-fit">
                <p className="text-sm font-medium">
                    {formatCurrency(price)}
                </p>
            </div>

        </div>
      </div>
    </Link>
  );
};

export const ProductCardSkeleton = () => {
    return(
        <div className="w-full aspect-3/4 bg-neutral-200 rounded-lg animate-pulse"/>
    );
};
