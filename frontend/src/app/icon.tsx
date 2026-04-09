import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F4F1EA',
          color: '#2F6B4F',
          fontSize: 22,
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        N
      </div>
    ),
    size,
  );
}
