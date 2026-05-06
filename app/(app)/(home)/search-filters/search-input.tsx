import { Input } from "@base-ui/react";
import { SearchIcon } from "lucide-react";

interface Props {
  disabled?: Boolean;
}

export const SearchInput = ({ disabled }: Props) => {
  return (
    <div className="relative w-full max-w-md">
      
      <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-neutral-500 pointer-events-none" />
      <Input
        className="w-full 
                   bg-white dark:bg-neutral-900 
                   border border-neutral-300 dark:border-neutral-700 
                   focus:border-blue-500 focus:ring-2 focus:ring-blue-200 
                   rounded-xl 
                   py-3 pl-11 pr-4 
                   text-sm 
                   placeholder:text-neutral-400
                   disabled:bg-neutral-100 disabled:cursor-not-allowed"
        placeholder="Search products"
        disabled={disabled}
      />
    </div>
  );
};
