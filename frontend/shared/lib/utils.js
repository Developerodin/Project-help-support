import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui class joiner: clsx for conditionals, twMerge to settle conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
