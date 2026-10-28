import { LOCAL_ASSETS, LOCAL_MIME_TYPES } from './LocalAssetManifest';

// This reserved origin is served from the signed package, never from the network.
export const LOCAL_ORIGIN: string = 'https://leaf-reader.invalid';
export const LOCAL_READER_URL: string = LOCAL_ORIGIN + '/reader/index.html';

export function isLocalReaderUrl(url: string): boolean {
  return url.startsWith(LOCAL_ORIGIN + '/reader/');
}

export function localResourceResponse(url: string): WebResourceResponse | null {
  if (!url.startsWith(LOCAL_ORIGIN + '/')) return null;
  const path = url.substring(LOCAL_ORIGIN.length).split('?')[0].split('#')[0];
  const rawfile = LOCAL_ASSETS.get(path);
  const response = new WebResourceResponse();
  if (rawfile) {
    response.setResponseData($rawfile(rawfile));
    response.setResponseMimeType(LOCAL_MIME_TYPES.get(path) || 'application/octet-stream');
    response.setResponseCode(200);
    response.setReasonMessage('OK');
  } else {
    // Unknown local URLs must not fall through to DNS or a network download.
    response.setResponseData('Local resource not found');
    response.setResponseMimeType('text/plain');
    response.setResponseCode(404);
    response.setReasonMessage('Not Found');
  }
  response.setResponseEncoding('utf-8');
  response.setResponseHeader([{ headerKey: 'X-Content-Type-Options', headerValue: 'nosniff' }]);
  response.setResponseIsReady(true);
  return response;
}
