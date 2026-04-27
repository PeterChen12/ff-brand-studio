import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-style class merger — combine clsx + tailwind-merge */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
