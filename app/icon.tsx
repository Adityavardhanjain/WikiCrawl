import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111613', border: '4px solid #d8f27a', color: '#edf0e7', fontFamily: 'monospace', fontSize: 29, fontWeight: 700 }}>
      W
    </div>,
    size,
  );
}
