declare module 'gifenc' {
  export type RGBColor = [red: number, green: number, blue: number];
  export type RGBAColor = [
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ];
  export type GIFColor = RGBColor | RGBAColor;
  export type GIFPixelData = Uint8Array | Uint8ClampedArray;

  export interface GIFEncoderOptions {
    initialCapacity?: number;
    auto?: boolean;
  }

  export interface GIFFrameOptions {
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    palette?: GIFColor[];
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    finish(): void;
    bytes(): Uint8Array;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GIFFrameOptions,
    ): void;
  }

  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
    oneBitAlpha?: boolean | number;
    useSqrt?: boolean;
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance;
  export function quantize(
    rgba: GIFPixelData,
    maxColors: number,
    options?: QuantizeOptions,
  ): GIFColor[];
  export function applyPalette(
    rgba: GIFPixelData,
    palette: GIFColor[],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}
