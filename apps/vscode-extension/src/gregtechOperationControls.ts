/** Source-verified GTCEu 1.21 controls, also published as an MCP resource. */
export interface GregtechOperationControl {
  readonly op: string;
  readonly label: string;
  readonly group: string;
  readonly fields: readonly { key: string; label: string; type: string; required: boolean }[];
  readonly example: Readonly<Record<string, unknown>>;
}
export const gregtechOperationControls: readonly GregtechOperationControl[] = [
  {
    op: 'itemInput',
    label: 'Item input',
    group: 'IO',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'count',
        label: 'Items',
        type: 'number',
        required: false,
      },
      {
        key: 'chance',
        label: 'Chance 0–1',
        type: 'number',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'itemInput',
      item: 'minecraft:iron_ingot',
      count: 1,
    },
  },
  {
    op: 'itemInputRanged',
    label: 'Ranged item input',
    group: 'IO',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'min',
        label: 'Minimum',
        type: 'number',
        required: true,
      },
      {
        key: 'max',
        label: 'Maximum',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'itemInputRanged',
      item: 'minecraft:iron_ingot',
      min: 1,
      max: 3,
    },
  },
  {
    op: 'itemOutput',
    label: 'Item output',
    group: 'IO',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'count',
        label: 'Items',
        type: 'number',
        required: false,
      },
      {
        key: 'chance',
        label: 'Chance 0–1',
        type: 'number',
        required: false,
      },
      {
        key: 'fraction',
        label: 'Exact chance, e.g. 1/3',
        type: 'text',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'itemOutput',
      item: 'minecraft:iron_ingot',
      count: 1,
    },
  },
  {
    op: 'itemOutputRanged',
    label: 'Ranged item output',
    group: 'IO',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'min',
        label: 'Minimum',
        type: 'number',
        required: true,
      },
      {
        key: 'max',
        label: 'Maximum',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'itemOutputRanged',
      item: 'minecraft:iron_ingot',
      min: 1,
      max: 3,
    },
  },
  {
    op: 'fluidInput',
    label: 'Fluid input',
    group: 'IO',
    fields: [
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'amount',
        label: 'mB',
        type: 'number',
        required: true,
      },
      {
        key: 'chance',
        label: 'Chance 0–1',
        type: 'number',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'fluidInput',
      fluid: 'minecraft:water',
      amount: 1000,
    },
  },
  {
    op: 'fluidInputRanged',
    label: 'Ranged fluid input',
    group: 'IO',
    fields: [
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'min',
        label: 'Minimum',
        type: 'number',
        required: true,
      },
      {
        key: 'max',
        label: 'Maximum',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'fluidInputRanged',
      fluid: 'minecraft:water',
      min: 1,
      max: 3,
    },
  },
  {
    op: 'fluidOutput',
    label: 'Fluid output',
    group: 'IO',
    fields: [
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'amount',
        label: 'mB',
        type: 'number',
        required: true,
      },
      {
        key: 'chance',
        label: 'Chance 0–1',
        type: 'number',
        required: false,
      },
      {
        key: 'fraction',
        label: 'Exact chance, e.g. 1/3',
        type: 'text',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'fluidOutput',
      fluid: 'minecraft:water',
      amount: 1000,
    },
  },
  {
    op: 'fluidOutputRanged',
    label: 'Ranged fluid output',
    group: 'IO',
    fields: [
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'min',
        label: 'Minimum',
        type: 'number',
        required: true,
      },
      {
        key: 'max',
        label: 'Maximum',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'fluidOutputRanged',
      fluid: 'minecraft:water',
      min: 1,
      max: 3,
    },
  },
  {
    op: 'itemInputAny',
    label: 'Alternative items',
    group: 'IO',
    fields: [
      {
        key: 'ids',
        label: 'IDs / #tags, one per line',
        type: 'lines',
        required: true,
      },
      {
        key: 'count',
        label: 'Items',
        type: 'number',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'itemInputAny',
      ids: ['minecraft:iron_ingot', '#c:ingots/copper'],
      count: 1,
    },
  },
  {
    op: 'blockInput',
    label: 'Block state input',
    group: 'IO',
    fields: [
      {
        key: 'state',
        label: 'Block state',
        type: 'text',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'blockInput',
      state: 'minecraft:stone',
    },
  },
  {
    op: 'blockOutput',
    label: 'Block state output',
    group: 'IO',
    fields: [
      {
        key: 'state',
        label: 'Block state',
        type: 'text',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'blockOutput',
      state: 'minecraft:stone',
    },
  },
  {
    op: 'EUt',
    label: 'EUt',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'EU/t',
        type: 'number',
        required: true,
      },
      {
        key: 'amount',
        label: 'Amperage',
        type: 'number',
        required: false,
      },
    ],
    example: {
      op: 'EUt',
      value: 32,
      amount: 1,
    },
  },
  {
    op: 'inputEU',
    label: 'inputEU',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'EU voltage',
        type: 'number',
        required: true,
      },
      {
        key: 'amount',
        label: 'Amperage',
        type: 'number',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'inputEU',
      value: 32,
      amount: 1,
    },
  },
  {
    op: 'outputEU',
    label: 'outputEU',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'EU voltage',
        type: 'number',
        required: true,
      },
      {
        key: 'amount',
        label: 'Amperage',
        type: 'number',
        required: false,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'outputEU',
      value: 32,
      amount: 1,
    },
  },
  {
    op: 'CWUt',
    label: 'CWUt',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'CWU/t',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'CWUt',
      value: 16,
    },
  },
  {
    op: 'inputCWU',
    label: 'inputCWU',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'CWU',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'inputCWU',
      value: 16,
    },
  },
  {
    op: 'outputCWU',
    label: 'outputCWU',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'CWU',
        type: 'number',
        required: true,
      },
      {
        key: 'tick',
        label: 'Per tick',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'outputCWU',
      value: 16,
    },
  },
  {
    op: 'totalCWU',
    label: 'totalCWU',
    group: 'Energy',
    fields: [
      {
        key: 'value',
        label: 'Total CWU',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'totalCWU',
      value: 16,
    },
  },
  {
    op: 'dimension',
    label: 'dimension',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'dimension',
      id: 'minecraft:overworld',
    },
  },
  {
    op: 'biome',
    label: 'biome',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'biome',
      id: 'minecraft:plains',
    },
  },
  {
    op: 'biomeTag',
    label: 'biomeTag',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'biomeTag',
      id: 'minecraft:is_ocean',
    },
  },
  {
    op: 'environmentalHazard',
    label: 'environmentalHazard',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'environmentalHazard',
      id: 'gtceu:asbestosis',
    },
  },
  {
    op: 'adjacentFluids',
    label: 'adjacentFluids',
    group: 'Conditions',
    fields: [
      {
        key: 'ids',
        label: 'IDs / #tags, one per line',
        type: 'lines',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'adjacentFluids',
      ids: ['minecraft:water'],
    },
  },
  {
    op: 'adjacentFluidTag',
    label: 'adjacentFluidTag',
    group: 'Conditions',
    fields: [
      {
        key: 'ids',
        label: 'IDs / #tags, one per line',
        type: 'lines',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'adjacentFluidTag',
      ids: ['minecraft:water'],
    },
  },
  {
    op: 'adjacentBlocks',
    label: 'adjacentBlocks',
    group: 'Conditions',
    fields: [
      {
        key: 'ids',
        label: 'IDs / #tags, one per line',
        type: 'lines',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'adjacentBlocks',
      ids: ['minecraft:stone'],
    },
  },
  {
    op: 'adjacentBlockTag',
    label: 'adjacentBlockTag',
    group: 'Conditions',
    fields: [
      {
        key: 'ids',
        label: 'IDs / #tags, one per line',
        type: 'lines',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'adjacentBlockTag',
      ids: ['minecraft:stone'],
    },
  },
  {
    op: 'rain',
    label: 'Rain',
    group: 'Conditions',
    fields: [
      {
        key: 'value',
        label: 'Rain 0–1',
        type: 'number',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'rain',
      value: 0.5,
    },
  },
  {
    op: 'thunder',
    label: 'Thunder',
    group: 'Conditions',
    fields: [
      {
        key: 'value',
        label: 'Thunder 0–1',
        type: 'number',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'thunder',
      value: 0.5,
    },
  },
  {
    op: 'posY',
    label: 'Height range',
    group: 'Conditions',
    fields: [
      {
        key: 'min',
        label: 'Minimum',
        type: 'number',
        required: true,
      },
      {
        key: 'max',
        label: 'Maximum',
        type: 'number',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'posY',
      min: 0,
      max: 128,
    },
  },
  {
    op: 'daytime',
    label: 'Day or night',
    group: 'Conditions',
    fields: [
      {
        key: 'value',
        label: 'Require night',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'daytime',
      value: false,
    },
  },
  {
    op: 'nighttime',
    label: 'Night',
    group: 'Conditions',
    fields: [],
    example: {
      op: 'nighttime',
    },
  },
  {
    op: 'steamVent',
    label: 'Steam vent',
    group: 'Conditions',
    fields: [
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'steamVent',
    },
  },
  {
    op: 'heraclesQuest',
    label: 'heraclesQuest',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'heraclesQuest',
      id: 'quest_id',
    },
  },
  {
    op: 'ftbQuest',
    label: 'ftbQuest',
    group: 'Conditions',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'reverse',
        label: 'Reverse condition',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'ftbQuest',
      id: '0000000000000001',
    },
  },
  {
    op: 'researchWithoutRecipe',
    label: 'Existing research',
    group: 'Research',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'dataItem',
        label: 'Data item',
        type: 'text',
        required: false,
      },
    ],
    example: {
      op: 'researchWithoutRecipe',
      id: 'kubevs:research',
    },
  },
  {
    op: 'scannerResearch',
    label: 'Scanner research',
    group: 'Research',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: false,
      },
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: false,
      },
      {
        key: 'amount',
        label: 'mB',
        type: 'number',
        required: false,
      },
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: false,
      },
      {
        key: 'dataItem',
        label: 'Data item',
        type: 'text',
        required: false,
      },
      {
        key: 'duration',
        label: 'Ticks',
        type: 'number',
        required: false,
      },
      {
        key: 'eut',
        label: 'EU/t',
        type: 'number',
        required: false,
      },
      {
        key: 'amperage',
        label: 'Amperage',
        type: 'number',
        required: false,
      },
    ],
    example: {
      op: 'scannerResearch',
      item: 'minecraft:diamond',
      duration: 1200,
      eut: 512,
    },
  },
  {
    op: 'stationResearch',
    label: 'Station research',
    group: 'Research',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: false,
      },
      {
        key: 'fluid',
        label: 'Fluid ID / #tag',
        type: 'text',
        required: false,
      },
      {
        key: 'amount',
        label: 'mB',
        type: 'number',
        required: false,
      },
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: false,
      },
      {
        key: 'dataItem',
        label: 'Data item',
        type: 'text',
        required: false,
      },
      {
        key: 'cwu',
        label: 'CWU/t',
        type: 'number',
        required: true,
      },
      {
        key: 'totalCwu',
        label: 'Total CWU',
        type: 'number',
        required: true,
      },
      {
        key: 'eut',
        label: 'EU/t',
        type: 'number',
        required: false,
      },
      {
        key: 'amperage',
        label: 'Amperage',
        type: 'number',
        required: false,
      },
    ],
    example: {
      op: 'stationResearch',
      item: 'minecraft:diamond',
      cwu: 16,
      totalCwu: 64000,
    },
  },
  {
    op: 'addDataString',
    label: 'Data string',
    group: 'Data',
    fields: [
      {
        key: 'key',
        label: 'Data key',
        type: 'text',
        required: true,
      },
      {
        key: 'value',
        label: 'Data string',
        type: 'text',
        required: true,
      },
    ],
    example: {
      op: 'addDataString',
      key: 'custom',
      value: 'example',
    },
  },
  {
    op: 'addDataNumber',
    label: 'Data number',
    group: 'Data',
    fields: [
      {
        key: 'key',
        label: 'Data key',
        type: 'text',
        required: true,
      },
      {
        key: 'value',
        label: 'Data number',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'addDataNumber',
      key: 'custom',
      value: 1,
    },
  },
  {
    op: 'addDataBool',
    label: 'Data bool',
    group: 'Data',
    fields: [
      {
        key: 'key',
        label: 'Data key',
        type: 'text',
        required: true,
      },
      {
        key: 'value',
        label: 'Data bool',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'addDataBool',
      key: 'custom',
      value: true,
    },
  },
  {
    op: 'addDataSnbt',
    label: 'Data snbt',
    group: 'Data',
    fields: [
      {
        key: 'key',
        label: 'Data key',
        type: 'text',
        required: true,
      },
      {
        key: 'snbt',
        label: 'Compound SNBT',
        type: 'text',
        required: true,
      },
    ],
    example: {
      op: 'addDataSnbt',
      key: 'custom',
      snbt: '{value:1}',
    },
  },
  {
    op: 'explosivesAmount',
    label: 'explosivesAmount',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'explosivesAmount',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'explosivesAmount',
      value: 8,
    },
  },
  {
    op: 'solderMultiplier',
    label: 'solderMultiplier',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'solderMultiplier',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'solderMultiplier',
      value: 2,
    },
  },
  {
    op: 'fusionStartEU',
    label: 'fusionStartEU',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'Startup EU',
        type: 'number',
        required: true,
      },
    ],
    example: {
      op: 'fusionStartEU',
      value: 100000000,
    },
  },
  {
    op: 'explosivesType',
    label: 'Explosive item',
    group: 'Data',
    fields: [
      {
        key: 'item',
        label: 'Item ID / #tag',
        type: 'text',
        required: true,
      },
      {
        key: 'count',
        label: 'Items',
        type: 'number',
        required: false,
      },
    ],
    example: {
      op: 'explosivesType',
      item: 'minecraft:tnt',
      count: 8,
    },
  },
  {
    op: 'disableDistilleryRecipes',
    label: 'disableDistilleryRecipes',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'disableDistilleryRecipes',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'disableDistilleryRecipes',
      value: true,
    },
  },
  {
    op: 'researchScan',
    label: 'researchScan',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'researchScan',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'researchScan',
      value: true,
    },
  },
  {
    op: 'durationIsTotalCWU',
    label: 'durationIsTotalCWU',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'durationIsTotalCWU',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'durationIsTotalCWU',
      value: true,
    },
  },
  {
    op: 'hideDuration',
    label: 'hideDuration',
    group: 'Data',
    fields: [
      {
        key: 'value',
        label: 'hideDuration',
        type: 'boolean',
        required: true,
      },
    ],
    example: {
      op: 'hideDuration',
      value: true,
    },
  },
  {
    op: 'category',
    label: 'Recipe category',
    group: 'Metadata',
    fields: [
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
    ],
    example: {
      op: 'category',
      id: 'gtceu:assembler',
    },
  },
  {
    op: 'chanceLogic',
    label: 'Chance logic',
    group: 'Metadata',
    fields: [
      {
        key: 'kind',
        label: 'IO group',
        type: 'text',
        required: true,
      },
      {
        key: 'id',
        label: 'ID',
        type: 'text',
        required: true,
      },
      {
        key: 'key',
        label: 'Data key',
        type: 'text',
        required: false,
      },
    ],
    example: {
      op: 'chanceLogic',
      kind: 'itemOutput',
      id: 'gtceu:or',
    },
  },
  {
    op: 'addMaterialInfo',
    label: 'Material recycling info',
    group: 'Metadata',
    fields: [
      {
        key: 'value',
        label: 'Material recycling info',
        type: 'boolean',
        required: true,
      },
      {
        key: 'fluidMaterialInfo',
        label: 'Fluid recycling',
        type: 'boolean',
        required: false,
      },
    ],
    example: {
      op: 'addMaterialInfo',
      value: true,
    },
  },
  {
    op: 'removePreviousMaterialInfo',
    label: 'Remove recycling info',
    group: 'Metadata',
    fields: [],
    example: {
      op: 'removePreviousMaterialInfo',
    },
  },
  {
    op: 'startupEnergy',
    label: 'Startup energy condition',
    group: 'Conditions',
    fields: [
      { key: 'value', label: 'Startup EU', type: 'number', required: true },
      { key: 'reverse', label: 'Reverse condition', type: 'boolean', required: false },
    ],
    example: { op: 'startupEnergy', value: 1000000 },
  },
  {
    op: 'cleanroomCondition',
    label: 'Cleanroom condition',
    group: 'Conditions',
    fields: [
      { key: 'id', label: 'cleanroom / sterile_cleanroom', type: 'text', required: true },
      { key: 'reverse', label: 'Reverse condition', type: 'boolean', required: false },
    ],
    example: { op: 'cleanroomCondition', id: 'cleanroom' },
  },
];
