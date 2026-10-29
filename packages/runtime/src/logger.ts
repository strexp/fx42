export interface Logger {
  info: (o: unknown, m?: string) => void
  warn: (o: unknown, m?: string) => void
  error: (o: unknown, m?: string) => void
}
