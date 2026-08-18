export interface ImageReleasePin {
  version: string;
  url: string;
  archiveSha256: string;
  executableName: string;
  executableSha256: string;
}

export interface ImageReleaseManifest {
  format: 1;
  imageMagick: Record<string, ImageReleasePin>;
  oxipng: Record<string, ImageReleasePin>;
}

// These are release assets, not PATH guesses.  The executable hashes are for
// the named members extracted from the pinned archives and are checked again
// after installation.
export const PINNED_IMAGE_RELEASES: ImageReleaseManifest = {
  format: 1,
  imageMagick: {
    'win32-x64': {
      version: '7.1.2-29',
      url: 'https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-29/ImageMagick-7.1.2-29-portable-Q16-x64.7z',
      archiveSha256: '4715072c158c46bbdc3e6971817e92ed43fca7c93142cad142ee42c603baaac1',
      executableName: 'magick.exe',
      executableSha256: '7e93f2c502c888569e2cf27e049e39d204a8bbd36a958419af7fce5450776f41'
    }
  },
  oxipng: {
    'win32-x64': {
      version: '10.2.0',
      url: 'https://github.com/oxipng/oxipng/releases/download/v10.2.0/oxipng-10.2.0-x86_64-pc-windows-msvc.zip',
      archiveSha256: 'a5ad52c9c288dc99c2eae90dcad73dee64e39bf3f5aa5303c0fb55ac9c5f069b',
      executableName: 'oxipng.exe',
      executableSha256: '394fef4ccbc6ee5a50ba96fe75af3557c4365349eb80371ef9ccc76f903c2530'
    }
  }
};

export function releaseKey(platform: string, arch = process.arch): string {
  return `${platform}-${arch}`;
}

export function pinnedImageRelease(platform: string, arch = process.arch): ImageReleasePin | undefined {
  return PINNED_IMAGE_RELEASES.imageMagick[releaseKey(platform, arch)];
}

export function pinnedOxipngRelease(platform: string, arch = process.arch): ImageReleasePin | undefined {
  return PINNED_IMAGE_RELEASES.oxipng[releaseKey(platform, arch)];
}
