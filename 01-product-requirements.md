# Product Requirements

## Functional Requirements

### Authentication

- The user must authenticate before accessing any application functionality.
- Unauthenticated users must only be able to access the login screen and login endpoint.
- Successful login creates an authenticated session.
- Session duration defaults to 7 days.
- Logout invalidates the active session.

### File Upload

The authenticated user must be able to:

- Select one or multiple files using the native file picker.
- Drag and drop files into the upload area.
- Upload generic file types without an extension allowlist.
- View upload progress individually for each file.
- View clear success and failure states.

Each upload must:

- Respect the configured maximum file size.
- Respect the configured total application storage limit.
- Generate a UUID-based internal storage key.
- Generate a SHA-256 checksum.
- Persist file metadata only after the file has been successfully stored.

### File Listing

The application must list stored files with at least:

- Original file name
- File size
- MIME type when available
- Upload date/time
- Download action
- Delete action

Default ordering:

- Most recently uploaded first.

### Search

- Search must support partial file-name matching.
- Search is case-insensitive.
- Search only needs to search the original file name in the MVP.

### Download

- Downloads are handled by the browser's native download mechanism.
- The backend streams the stored file rather than loading the entire file into memory.
- Files must not be directly exposed from a public static directory.

### Deletion

- The user can delete any stored file.
- A confirmation interaction must be presented before deletion.
- Deletion must remove both:
  - The filesystem object
  - The corresponding database record

### Storage Indicator

The UI must display:

- Current storage used
- Maximum configured storage
- Percentage used

Default maximum storage:

- 10 GB

## Default Configuration

```env
MAX_FILE_SIZE_MB=1024
MAX_STORAGE_GB=10
SESSION_TTL_DAYS=7
```

## Non-Functional Requirements

- Must work well on desktop and mobile browsers.
- Must remain lightweight on the KVM2 VPS.
- Uploading or downloading large files must not require buffering the full file in backend memory.
- Application state must survive container restarts.
- File storage must be persisted through mounted host storage.
