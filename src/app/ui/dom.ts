/** Typed readers for DOM events, so templates stay free of casts. */
export const numberFrom = (e: Event): number => +(e.target as HTMLInputElement).value || 0;
export const textFrom = (e: Event): string => (e.target as HTMLInputElement).value;
export const checkedFrom = (e: Event): boolean => (e.target as HTMLInputElement).checked;
export const selectedFrom = (e: Event): string => (e.target as HTMLSelectElement).value;
