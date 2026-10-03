import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';

export async function drawLiveSharingQr(canvas, value) {
  await QRCode.toCanvas(canvas, value, {
    errorCorrectionLevel: 'M',
    margin: 3,
    width: 560,
    color: { dark: '#111827', light: '#ffffff' }
  });
}

export function createLiveSharingScanner(video, onDecode, onError) {
  const scanner = new QrScanner(video, result => onDecode(result.data), {
    preferredCamera: 'environment',
    maxScansPerSecond: 8,
    highlightScanRegion: true,
    returnDetailedScanResult: true,
    onDecodeError: onError
  });
  return {
    start: () => scanner.start(),
    stop: async () => { await scanner.stop(); scanner.destroy(); }
  };
}

export async function readLiveSharingQrImage(file) {
  const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
  return result.data;
}
