# User Flows

## Login Flow

1. User opens JDrive.
2. Application checks authentication state.
3. If unauthenticated, user remains on `/login`.
4. User enters username and password.
5. Backend verifies credentials.
6. On success:
   - Session is created.
   - Secure session cookie is returned.
   - User is redirected to the main application.
7. On failure:
   - Error feedback is shown.
   - User remains on login screen.

## Upload Flow

1. User opens the authenticated home screen.
2. User:
   - Selects files using the file picker, or
   - Drags files into the drop zone.
3. Files enter a local upload queue.
4. Each item displays one of:
   - queued
   - uploading
   - completed
   - failed
5. During upload:
   - Progress percentage is shown.
   - Uploaded bytes and total bytes may be shown.
6. Backend validates:
   - Authentication
   - Per-file size limit
   - Remaining total storage
7. Backend writes the incoming file to a temporary location.
8. SHA-256 is calculated while streaming where practical.
9. On successful completion:
   - File receives its final UUID storage key.
   - Temporary file is moved into permanent storage.
   - Metadata is persisted in PostgreSQL.
10. UI refreshes the file list and storage usage.

## Download Flow

1. User selects Download.
2. Browser requests the authenticated download endpoint.
3. Backend validates the session.
4. Backend resolves the file metadata and storage key.
5. Backend streams the file.
6. Browser manages download progress and saving.

## Delete Flow

1. User selects Delete.
2. UI asks for confirmation.
3. User confirms.
4. Backend removes the stored file.
5. Backend removes the database record.
6. UI removes the item from the list.
7. Storage usage is refreshed.

## Search Flow

1. User enters text in the search field.
2. Frontend queries the files endpoint using the search term.
3. Backend performs a case-insensitive partial match on `original_name`.
4. Matching files are returned newest-first.

## Unauthenticated Access Flow

For any protected route:

1. Request is received.
2. Session is checked.
3. If no valid session exists:
   - API request receives an authentication error.
   - Frontend route redirects to `/login`.
