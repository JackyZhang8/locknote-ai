import type { PluginAPIError } from './types.js'
export function pluginError(code: string, message: string, status?: number): PluginAPIError {
 return Object.assign(new Error(message), { code, ...(status === undefined ? {} : { status }) })
}
export function responseError(status: number, body: { error?: string; code?: string }): PluginAPIError {
 return pluginError(body.code || ({ 400: 'INVALID_ARGUMENT', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'LIMIT_EXCEEDED', 429: 'RATE_LIMITED' } as Record<number, string>)[status] || 'HTTP_ERROR', body.error || 'Plugin request failed (' + status + ')', status)
}
