// Creates safe Bonyan errors at the pey.filesystem plugin boundary.

export const SERVICE_NAME = 'pey.filesystem.service';

/**
 * Builds a structured Bonyan error owned by this plugin.
 * @param {string} code Stable error code.
 * @param {string} message Log-safe message.
 * @param {object} [detail] Extra machine-readable detail.
 * @param {'startup'|'operational'|'critical'} [type] Error category.
 * @returns {Error} Structured error.
 */
export function createFilesystemError(code, message, detail = {}, type = 'operational') {
  return Object.assign(new Error(message), {
    code,
    source: SERVICE_NAME,
    type,
    timestamp: new Date().toISOString(),
    detail,
  });
}
