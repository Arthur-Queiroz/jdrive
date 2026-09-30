# Acceptance Criteria

## Authentication

- [ ] Opening the application without a valid session shows only the login screen.
- [ ] Invalid credentials do not grant access.
- [ ] Valid credentials create a session.
- [ ] Session lifetime defaults to 7 days.
- [ ] Logout invalidates access.
- [ ] Protected API endpoints reject unauthenticated requests.

## Upload

- [ ] User can select a file through the browser picker.
- [ ] User can drag and drop files.
- [ ] User can submit multiple files.
- [ ] Each file shows individual upload progress.
- [ ] A file larger than 1 GB is rejected by default.
- [ ] Upload is rejected if it would exceed the configured 10 GB total storage.
- [ ] Successful upload survives application/container restart.
- [ ] Stored file receives a UUID-based storage key.
- [ ] SHA-256 is generated and stored.
- [ ] Failed uploads do not leave valid file records.
- [ ] Temporary partial files are cleaned up.

## File List

- [ ] Files are displayed newest-first.
- [ ] Original name is displayed.
- [ ] Size is displayed.
- [ ] Upload date is displayed.
- [ ] Download action is available.
- [ ] Delete action is available.

## Search

- [ ] Search by partial original file name works.
- [ ] Search is case-insensitive.

## Download

- [ ] Authenticated user can download a file.
- [ ] Download uses the browser's native mechanism.
- [ ] Backend streams the file.
- [ ] Unauthenticated user cannot download a file.

## Delete

- [ ] Delete requires confirmation in the UI.
- [ ] Confirmed deletion removes the filesystem object.
- [ ] Confirmed deletion removes the database record.
- [ ] Storage usage updates after deletion.

## Storage Indicator

- [ ] UI displays bytes/GB used.
- [ ] UI displays the configured storage maximum.
- [ ] UI displays the usage percentage.

## Security

- [ ] Passwords use Argon2id hashes.
- [ ] Uploaded files are not directly publicly accessible.
- [ ] Original file names cannot control filesystem paths.
- [ ] Production uses HTTPS.
