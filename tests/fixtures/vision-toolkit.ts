import type { VisionToolkitActivation, VisionToolkitVerification } from '../../src/vision-toolkit';

export function visionToolkitFixture(): VisionToolkitVerification {
  return {
    valid: true,
    errors: [],
    profile: 'web',
    profileDir: '/fixture/profile',
    manifestPath: '/fixture/profile/package.json',
    packageDir: '/fixture/profile/node_modules/@anionex/dsh-vision-toolkit',
    packageVersion: '0.1.31',
    profileDependency: '0.1.31',
    bundleOccurrences: 1,
    runtimeCacheDir: '/fixture/cache/dsh-vision-toolkit',
    managedRuntimeReady: true,
    provider: {
      baseUrl: 'https://vision.anionex.me/v1',
      model: 'gemini-3.7-flash',
      credential: 'ANIONEX_FREE_VISION',
      dailyLimit: 300,
      imagesPerRequest: 5,
      maxImageBytes: 4 * 1024 * 1024,
      maxImagePixels: 20_000_000,
      maxOutputTokens: 4096
    }
  };
}

export function visionToolkitActivationFixture(): VisionToolkitActivation {
  return {
    valid: true,
    errors: [],
    settingsReady: true,
    attachmentAdmissionReady: true,
    tools: [
      'vision_glance',
      'vision_ground',
      'vision_detect',
      'vision_crop',
      'vision_trace',
      'vision_pixel_diff',
      'vision_long_screenshot_ocr',
      'vision_extract_foreground',
      'vision_dominant_colors',
      'vision_html_screenshot'
    ]
  };
}
