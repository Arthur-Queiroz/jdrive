# File Storage Specification

## Storage Model

File contents must be stored on the VPS filesystem.

Recommended persistent directories:

```text
/opt/jdrive/data/files
/opt/jdrive/data/tmp
```

Containers may mount these into paths such as:

```text
/app/data/files
/app/data/tmp
```

## Storage Key

Every stored file receives a UUID.

Example:

```text
original_name = proposal.docx
storage_key   = 8eeaaf47-70f8-4bf4-b82d-5fd5f93ea559
```

The physical filename may be the UUID itself.

The original extension does not need to be part of the physical filename.

## Path Safety

The backend must never build filesystem paths from the original file name.

Only validated UUID-based internal storage keys may be used to resolve permanent file paths.

## Temporary Uploads

Uploads should first be written into the temporary directory.

Example flow:

```text
incoming stream
  -> temporary file
  -> validation completed
  -> checksum completed
  -> atomic move/rename
  -> database record
```

On failure:

- Temporary file must be removed.
- No successful database record should remain.

## Limits

Defaults:

```env
MAX_FILE_SIZE_MB=1024
MAX_STORAGE_GB=10
```

Storage checks must occur before accepting a file when possible.

The system must reject uploads that would exceed the configured total capacity.

## Checksum

- Use SHA-256.
- Store the lowercase hexadecimal digest.
- Checksum may be calculated while streaming the upload.

Checksum does not imply automatic deduplication in MVP.

## Persistence

File storage must survive:

- Container recreation
- Application restart
- VPS service restart

The storage directory must therefore exist outside ephemeral container layers.
