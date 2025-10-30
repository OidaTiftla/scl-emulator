import type { PlcDataBlockConfig } from "../types.js";
import { WordArea } from "./wordArea.js";

export class DbArea {
  private readonly blocks = new Map<number, WordArea>();

  constructor(configs: PlcDataBlockConfig[] = []) {
    for (const config of configs) {
      this.addBlock(config);
    }
  }

  addBlock(config: PlcDataBlockConfig): void {
    if (this.blocks.has(config.id)) {
      throw new RangeError(`Duplicate data block configuration for DB${config.id}`);
    }
    this.blocks.set(config.id, new WordArea(config.size, `DB${config.id}`));
  }

  getBlock(dbNumber: number): WordArea | undefined {
    return this.blocks.get(dbNumber);
  }

  blockIds(): number[] {
    return [...this.blocks.keys()].sort((a, b) => a - b);
  }

  snapshot(): Record<number, number[]> {
    const result: Record<number, number[]> = {};
    for (const [blockId, area] of this.blocks.entries()) {
      result[blockId] = area.snapshot();
    }
    return result;
  }
}
