import type { RelationType, Segment } from '../types';

export const SEGMENT_COLORS: Record<Segment, string> = {
  chip_designer: '#F5A623',
  foundry: '#4FC3F7',
  equipment: '#AB47BC',
  ip: '#26A69A',
  eda: '#EC407A',
  cloud: '#66BB6A',
  ai_lab: '#FF7043',
  memory: '#42A5F5',
  hyperscaler: '#00E676',
  oem: '#FFEE58',
  investor: '#B0BEC5',
  startup: '#FF8A65',
  space: '#E0E0FF',
  energy_gas: '#FF9E40',
  energy_turbines: '#D4E157',
  energy_renewables: '#FFE57F',
  energy_wind: '#80DEEA',
  energy_nuclear: '#B388FF',
  energy_geothermal: '#FF6E6E',
  energy_biofuel: '#9CCC65',
  energy_utility: '#4DD0E1',
  energy_grid: '#90A4AE',
};

export const ENERGY_SEGMENTS: Segment[] = [
  'energy_utility',
  'energy_nuclear',
  'energy_gas',
  'energy_turbines',
  'energy_renewables',
  'energy_wind',
  'energy_geothermal',
  'energy_biofuel',
  'energy_grid',
];

export const isEnergySegment = (s: Segment) => s.startsWith('energy_');

export const SEGMENT_LABELS: Record<Segment, string> = {
  chip_designer: 'Chip Designer',
  foundry: 'Foundry',
  equipment: 'Equipment',
  ip: 'Chip IP',
  eda: 'EDA',
  cloud: 'Cloud',
  ai_lab: 'AI Lab',
  memory: 'Memory',
  hyperscaler: 'Hyperscaler',
  oem: 'OEM / Device',
  investor: 'Investor',
  startup: 'AI Startup',
  space: 'Space / Satellite & AI Compute',
  energy_gas: 'Natural Gas & Midstream',
  energy_turbines: 'Gas Turbines & Power Equipment',
  energy_renewables: 'Solar & Renewables',
  energy_wind: 'Wind / Turbines',
  energy_nuclear: 'Nuclear (Operators, SMRs, Fuel)',
  energy_geothermal: 'Geothermal',
  energy_biofuel: 'Biofuels / RNG',
  energy_utility: 'Utilities & IPPs',
  energy_grid: 'Grid & Electrical Equipment',
};

export const RELATION_COLORS: Record<RelationType, string> = {
  investment: '#FFD54F',
  partnership: '#81C784',
  supplier: '#64B5F6',
  customer: '#4DB6AC',
  ownership: '#FF8A65',
  cloud_capacity: '#CE93D8',
  foundry: '#4FC3F7',
  licensing: '#A5D6A7',
  competitor: '#EF5350',
  power_supply: '#FFAB40',
};

export const RELATION_LABELS: Record<RelationType, string> = {
  investment: 'Investment',
  partnership: 'Partnership',
  supplier: 'Supplier',
  customer: 'Customer',
  ownership: 'Ownership',
  cloud_capacity: 'Cloud Capacity',
  foundry: 'Foundry',
  licensing: 'Licensing',
  competitor: 'Competitor',
  power_supply: 'Power / Fuel Supply',
};

export const RELATION_DASH: Record<RelationType, string> = {
  investment: '6,3',
  partnership: '2,2',
  supplier: '',
  customer: '',
  ownership: '8,4',
  cloud_capacity: '4,2',
  foundry: '',
  licensing: '1,3',
  competitor: '10,4',
  power_supply: '3,3',
};
