"use client";


import {Category} from "@/payload-types";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils";
import {useRef,useState} from "react"
import { useDropdpownPosition } from "./use-dropdown-position";
import { SubCategoryMenu } from "./subcategory-menu";


interface Props{
    category: Category;
    isActive?: boolean;
    isNavigationHoevered?: boolean;
};

export const CategoryDropdown=({
    category,
    isActive,
    isNavigationHovered
}:Props) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const {getDropdownPosition} = useDropdpownPosition(dropdownRef)

    const onMouseEnter = () =>{
        if (category.subcategories) {
            setIsOpen(true);
        }
    };

const onMouseLeave = () => setIsOpen(false);

const dropdownPosition = getDropdownPosition();




    return(
        <div className="relative" ref= {dropdownRef} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            <div className="relative">
                <Button 
                variant="elevated"
                className={cn(
                    "h-11 px-4 bg-transparent border-transparent rounded-full hover:bg-white hover:border-primary text-black",
                    isActive && !isNavigationHovered && "bg-white border-primary"
                )}>
                    {category.name}
                </Button>  
                {category.subcategories && category.subcategories.length > 0 && (
                    <div
                    className={cn(
                        "opacity-0 absolute -bottom-3 w-0 h-0 border-l-10 border-r-10 border-b-10 border-l-transparent border-r-transparent border-b-black left-1/2 -translate-x-1/2",
                        isOpen && "opacity-100"
                    )}
                    />
                )}
            </div>
            <SubCategoryMenu 
                category={category}
                isOpen={isOpen}
                position={dropdownPosition}
            />
                
            
        </div>
    );
};

