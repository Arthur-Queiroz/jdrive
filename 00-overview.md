# JDrive — Overview

## Purpose

JDrive is a lightweight personal file-transfer web application designed to move files quickly between the owner's devices without relying on third-party storage providers such as Google Drive or OneDrive.

The application stores files directly on the disk of the existing Hostinger KVM2 VPS and uses the existing PostgreSQL instance only for metadata and authentication data.

## Primary Use Case

1. Open JDrive on one device.
2. Sign in.
3. Upload one or more files.
4. Open JDrive on another device.
5. Search, download, or delete the files.

Typical files include:
- Office documents
- ZIP archives
- PDFs
- Images
- Text files
- Source code archives
- Other generic binary files

The backend does not need to understand or process each file format. Files are treated as byte streams and stored on disk.

## Product Principles

- Personal-use first.
- Minimal infrastructure.
- Low RAM and CPU consumption.
- Good mobile responsiveness.
- Fast upload workflow.
- Clear upload progress feedback.
- Simple deployment on the existing VPS infrastructure.
- No unnecessary enterprise features.
- Keep the MVP intentionally small.

## MVP Summary

The MVP includes:

- Login with one or more database-backed users.
- Entire application protected behind authentication.
- File upload through file picker.
- Drag-and-drop upload.
- Multiple file upload.
- Detailed progress per uploaded file.
- Search by file name.
- Native browser downloads.
- File deletion.
- Storage usage indicator.
- SHA-256 checksum generation.
- PostgreSQL metadata.
- Filesystem-based binary storage.
- Configurable storage and upload limits.
