import { BitArea } from "./bitArea.js";

const LITTLE_ENDIAN = true; // Siemens byte order: low-address byte is least significant

export class WordArea extends BitArea {
  readInt8(byteOffset: number): number {
    return (this.readUInt8(byteOffset) << 24) >> 24;
  }

  writeInt8(byteOffset: number, value: number): void {
    this.writeUInt8(byteOffset, value & 0xff);
  }

  readUInt16(byteOffset: number): number {
    this.assertAlignment(byteOffset, 2);
    return this.view.getUint16(byteOffset, LITTLE_ENDIAN);
  }

  writeUInt16(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 2);
    this.view.setUint16(byteOffset, value & 0xffff, LITTLE_ENDIAN);
  }

  readInt16(byteOffset: number): number {
    this.assertAlignment(byteOffset, 2);
    return this.view.getInt16(byteOffset, LITTLE_ENDIAN);
  }

  writeInt16(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 2);
    this.view.setInt16(byteOffset, value, LITTLE_ENDIAN);
  }

  readUInt32(byteOffset: number): number {
    this.assertAlignment(byteOffset, 4);
    return this.view.getUint32(byteOffset, LITTLE_ENDIAN);
  }

  writeUInt32(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 4);
    this.view.setUint32(byteOffset, value >>> 0, LITTLE_ENDIAN);
  }

  readInt32(byteOffset: number): number {
    this.assertAlignment(byteOffset, 4);
    return this.view.getInt32(byteOffset, LITTLE_ENDIAN);
  }

  writeInt32(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 4);
    this.view.setInt32(byteOffset, value | 0, LITTLE_ENDIAN);
  }

  readBigInt64(byteOffset: number): bigint {
    this.assertAlignment(byteOffset, 8);
    return this.view.getBigInt64(byteOffset, LITTLE_ENDIAN);
  }

  writeBigInt64(byteOffset: number, value: bigint): void {
    this.assertAlignment(byteOffset, 8);
    this.view.setBigInt64(byteOffset, value, LITTLE_ENDIAN);
  }

  readFloat32(byteOffset: number): number {
    this.assertAlignment(byteOffset, 4);
    return this.view.getFloat32(byteOffset, LITTLE_ENDIAN);
  }

  writeFloat32(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 4);
    this.view.setFloat32(byteOffset, value, LITTLE_ENDIAN);
  }

  readFloat64(byteOffset: number): number {
    this.assertAlignment(byteOffset, 8);
    return this.view.getFloat64(byteOffset, LITTLE_ENDIAN);
  }

  writeFloat64(byteOffset: number, value: number): void {
    this.assertAlignment(byteOffset, 8);
    this.view.setFloat64(byteOffset, value, LITTLE_ENDIAN);
  }

  private assertAlignment(byteOffset: number, alignment: number): void {
    if (byteOffset % alignment !== 0) {
      throw new RangeError(
        `Offset ${byteOffset} must be aligned to ${alignment} byte(s)`
      );
    }
    this.assertRange(byteOffset, alignment);
  }
}
