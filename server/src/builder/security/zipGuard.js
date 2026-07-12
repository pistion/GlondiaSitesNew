/**
 * zipGuard.js — hostile-archive defense for customer ZIP uploads.
 *
 * Every check runs on entry METADATA before a single byte of entry data is
 * decompressed, and actual decompressed sizes are re-verified during
 * extraction (headers lie). Configurable limits, fail-closed.
 */

export function zipLimits() {
  return {
    maxCompressedBytes: Number(process.env.ZIP_MAX_COMPRESSED_BYTES || 100 * 1024 * 1024),
    maxExtractedBytes: Number(process.env.ZIP_MAX_EXTRACTED_BYTES || 300 * 1024 * 1024),
    maxCompressionRatio: Number(process.env.ZIP_MAX_COMPRESSION_RATIO || 120),
    maxFiles: Number(process.env.ZIP_MAX_FILES || 4000),
    maxEntryBytes: Number(process.env.ZIP_MAX_ENTRY_BYTES || 25 * 1024 * 1024),
    maxPathDepth: Number(process.env.ZIP_MAX_PATH_DEPTH || 16),
    maxPathLength: Number(process.env.ZIP_MAX_PATH_LENGTH || 256),
    maxNestedArchives: Number(process.env.ZIP_MAX_NESTED_ARCHIVES || 3),
  };
}

export function zipError(code, message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.stage = 'zip_validation';
  err.expose = true;
  return err;
}

const NESTED_ARCHIVE_RE = /\.(zip|tar|tgz|gz|bz2|xz|rar|7z|jar|war)$/i;

// High-confidence secret files are blocked by NAME even when the deploy
// pipeline would otherwise ignore them (so they can never be published), and
// regardless of content. Example/sample env files are allowed.
const SECRET_FILENAME_RE = [
  /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.git-credentials$/i,
];

export function isSecretFilename(name) {
  return SECRET_FILENAME_RE.some((re) => re.test(String(name || '')));
}

// Unix file types live in the high 16 bits of the ZIP external attributes.
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export function unixModeOf(entry) {
  const attr = Number(entry?.header?.attr ?? entry?.attr ?? 0);
  return (attr >>> 16) & 0xffff;
}

export function isSymlinkEntry(entry) {
  return (unixModeOf(entry) & S_IFMT) === S_IFLNK;
}

export function isSpecialFileEntry(entry) {
  const mode = unixModeOf(entry);
  const type = mode & S_IFMT;
  // Anything that is neither a regular file, a directory, nor "no unix info"
  // (Windows-created archives) is a device/pipe/socket/etc.
  return mode !== 0 && type !== S_IFREG && type !== S_IFDIR && type !== S_IFLNK;
}

export function isEncryptedEntry(entry) {
  return (Number(entry?.header?.flags ?? 0) & 0x1) === 0x1;
}

/**
 * Validate one entry's metadata. `relativeName` is the cleaned in-archive
 * path the extractor will use. Throws on any violation.
 */
export function assertEntrySafe(entry, relativeName, limits, state) {
  const name = String(relativeName || '');

  if (isEncryptedEntry(entry)) {
    throw zipError('ZIP_ENCRYPTED_ENTRY', 'Encrypted ZIP entries are not supported.');
  }
  if (isSymlinkEntry(entry)) {
    throw zipError('ZIP_SYMLINK_REJECTED', `ZIP contains a symlink: ${name}`);
  }
  if (isSpecialFileEntry(entry)) {
    throw zipError('ZIP_SPECIAL_FILE_REJECTED', `ZIP contains a device/pipe/special file: ${name}`);
  }
  if (name.includes('\0')) {
    throw zipError('ZIP_PATH_NOT_ALLOWED', 'ZIP entry path contains a null byte.');
  }
  if (/^([a-zA-Z]:|\\\\|\/)/.test(String(entry?.entryName || ''))) {
    throw zipError('ZIP_PATH_NOT_ALLOWED', `ZIP entry uses an absolute path: ${entry.entryName}`);
  }
  if (name.length > limits.maxPathLength) {
    throw zipError('ZIP_PATH_TOO_LONG', `ZIP entry path exceeds ${limits.maxPathLength} characters.`);
  }
  const segments = name.split('/').filter(Boolean);
  if (segments.length > limits.maxPathDepth) {
    throw zipError('ZIP_PATH_TOO_DEEP', `ZIP entry path exceeds ${limits.maxPathDepth} directories.`);
  }
  if (segments.some((part) => part === '..')) {
    throw zipError('ZIP_PATH_NOT_ALLOWED', `ZIP entry path is not allowed: ${name}`);
  }
  if (isSecretFilename(name)) {
    // Do not echo the path in detail beyond its basename — it is a credential file.
    throw zipError('ZIP_SECRETS_DETECTED', `The ZIP contains a credential file (${name.split('/').pop()}). Remove it and upload again.`);
  }

  // Duplicate paths and case-collisions (a.CSS overwriting a.css on
  // case-insensitive filesystems) are rejected outright.
  const lower = name.toLowerCase();
  if (state.seenPaths.has(lower)) {
    throw zipError('ZIP_DUPLICATE_PATH', `ZIP contains duplicate or case-colliding path: ${name}`);
  }
  state.seenPaths.add(lower);

  if (NESTED_ARCHIVE_RE.test(name)) {
    state.nestedArchives += 1;
    if (state.nestedArchives > limits.maxNestedArchives) {
      throw zipError('ZIP_NESTED_ARCHIVES', `ZIP contains more than ${limits.maxNestedArchives} nested archives.`);
    }
  }

  const declaredSize = Number(entry?.header?.size ?? 0);
  const compressedSize = Number(entry?.header?.compressedSize ?? 0);
  if (declaredSize > limits.maxEntryBytes) {
    throw zipError('ZIP_ENTRY_TOO_LARGE', `ZIP entry is too large: ${name}. Max per file is ${limits.maxEntryBytes} bytes.`);
  }
  state.declaredBytes += declaredSize;
  if (state.declaredBytes > limits.maxExtractedBytes) {
    throw zipError('ZIP_TOO_LARGE_EXTRACTED', `ZIP would extract more than ${limits.maxExtractedBytes} bytes in total.`);
  }
  if (compressedSize > 0 && declaredSize / compressedSize > limits.maxCompressionRatio) {
    throw zipError('ZIP_COMPRESSION_RATIO', `ZIP entry ${name} exceeds the ${limits.maxCompressionRatio}:1 compression-ratio limit.`);
  }
}

/** Track ACTUAL decompressed bytes during extraction — headers can lie. */
export function assertActualBytes(state, limits, actualLength, name) {
  state.actualBytes += actualLength;
  if (actualLength > limits.maxEntryBytes) {
    throw zipError('ZIP_ENTRY_TOO_LARGE', `ZIP entry decompressed larger than declared: ${name}.`);
  }
  if (state.actualBytes > limits.maxExtractedBytes) {
    throw zipError('ZIP_TOO_LARGE_EXTRACTED', `ZIP extracted more than ${limits.maxExtractedBytes} bytes in total.`);
  }
}

export function newGuardState() {
  return { seenPaths: new Set(), nestedArchives: 0, declaredBytes: 0, actualBytes: 0 };
}

/** ZIP magic bytes: local file header or (rare, valid) empty archive. */
export function hasZipMagic(buffer) {
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false; // 'PK'
  const third = buffer[2];
  const fourth = buffer[3];
  return (third === 0x03 && fourth === 0x04) // local file header
    || (third === 0x05 && fourth === 0x06)   // empty central directory
    || (third === 0x07 && fourth === 0x08);  // spanned marker
}
