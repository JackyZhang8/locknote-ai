export function t(chinese: string, english: string): string {
  return typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? english : chinese
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
