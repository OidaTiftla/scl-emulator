export class BitArea {
  protected readonly buffer: Uint8Array;
  protected readonly view: DataView;
  private readonly label: string;

  constructor(size: number, label: string) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`${label}: size must be a non-negative integer`);
    }
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
    this.label = label;
  }

  get byteLength(): number {
    return this.buffer.length;
  }

  readBit(byteOffset: number, bitOffset: number): boolean {
    this.assertBitRange(byteOffset, bitOffset);
    const mask = 1 << bitOffset;
    return (this.buffer[byteOffset] & mask) === mask;
  }

  writeBit(byteOffset: number, bitOffset: number, value: boolean): void {
    this.assertBitRange(byteOffset, bitOffset);
    const mask = 1 << bitOffset;
    if (value) {
      this.buffer[byteOffset] |= mask;
    } else {
      this.buffer[byteOffset] &= ~mask;
    }
  }

  readUInt8(byteOffset: number): number {
    this.assertRange(byteOffset, 1);
    return this.buffer[byteOffset];
  }

  writeUInt8(byteOffset: number, value: number): void {
    this.assertRange(byteOffset, 1);
    this.buffer[byteOffset] = value & 0xff;
  }

  readBytes(byteOffset: number, length: number): Uint8Array {
    this.assertRange(byteOffset, length);
    return this.buffer.slice(byteOffset, byteOffset + length);
  }

  writeBytes(byteOffset: number, source: Uint8Array): void {
    this.assertRange(byteOffset, source.length);
    this.buffer.set(source, byteOffset);
  }

  snapshot(): number[] {
    return Array.from(this.buffer);
  }

  protected assertRange(byteOffset: number, length: number): void {
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      throw new RangeError(`${this.label}: byte offset must be a non-negative integer`);
    }
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`${this.label}: length must be a non-negative integer`);
    }
    if (byteOffset + length > this.buffer.length) {
      throw new RangeError(
        `${this.label}: access of ${length} byte(s) at offset ${byteOffset} exceeds size ${this.buffer.length}`
      );
    }
  }

  protected assertBitRange(byteOffset: number, bitOffset: number): void {
    if (!Number.isInteger(bitOffset) || bitOffset < 0 || bitOffset > 7) {
      throw new RangeError(`${this.label}: bit offset must be between 0 and 7`);
    }
    this.assertRange(byteOffset, 1);
  }
}
