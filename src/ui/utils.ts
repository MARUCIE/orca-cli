/** Truncate a label for display, appending '...' if exceeded */
export function truncateLabel(label: string, maxLen: number = 60): string {
  return label.length > maxLen ? label.slice(0, maxLen - 3) + '...' : label
}
