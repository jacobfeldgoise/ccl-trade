import type { EccnTradeRecord } from '../types';

export const tradeDataByEccn: EccnTradeRecord[] = [
  {
    eccn: '3B001',
    description: 'Semiconductor manufacturing equipment and specially designed assemblies.',
    latestYear: 2023,
    exportValueUsd: 4820000000,
    importValueUsd: 615000000,
    notes: 'Strong demand from advanced logic and memory fabrication projects across Asia.',
    topDestinations: [
      { country: 'South Korea', exportValueUsd: 950000000, share: 0.2 },
      { country: 'Taiwan', exportValueUsd: 880000000, share: 0.18 },
      { country: 'Japan', exportValueUsd: 760000000, share: 0.16 },
    ],
  },
  {
    eccn: '4A994',
    description: 'Low-end computers, electronic assemblies, and specially designed components.',
    latestYear: 2023,
    exportValueUsd: 3260000000,
    importValueUsd: 1400000000,
    notes: 'Shipments remain elevated as contract manufacturers rebalance supply chains in North America.',
    topDestinations: [
      { country: 'Mexico', exportValueUsd: 870000000, share: 0.27 },
      { country: 'Canada', exportValueUsd: 620000000, share: 0.19 },
      { country: 'Singapore', exportValueUsd: 450000000, share: 0.14 },
    ],
  },
  {
    eccn: '5A992',
    description: 'Mass market encryption commodities meeting eligibility of License Exception ENC.',
    latestYear: 2023,
    exportValueUsd: 1720000000,
    importValueUsd: 480000000,
    notes: 'Cloud and networking hardware upgrades drove double-digit growth year over year.',
    topDestinations: [
      { country: 'Canada', exportValueUsd: 340000000, share: 0.2 },
      { country: 'Germany', exportValueUsd: 290000000, share: 0.17 },
      { country: 'Singapore', exportValueUsd: 220000000, share: 0.13 },
    ],
  },
  {
    eccn: '7A003',
    description: 'Inertial navigation equipment and systems incorporating accelerometers or gyros.',
    latestYear: 2023,
    exportValueUsd: 980000000,
    importValueUsd: 260000000,
    notes: 'Commercial aviation recovery supported exports while defense offsets remained stable.',
    topDestinations: [
      { country: 'Japan', exportValueUsd: 210000000, share: 0.21 },
      { country: 'United Kingdom', exportValueUsd: 180000000, share: 0.18 },
      { country: 'Israel', exportValueUsd: 120000000, share: 0.12 },
    ],
  },
  {
    eccn: '9A610',
    description: 'Military aircraft parts, components, and associated production equipment.',
    latestYear: 2023,
    exportValueUsd: 2150000000,
    importValueUsd: 390000000,
    notes: 'Foreign military sales programs to close allies continue to dominate the trade mix.',
    topDestinations: [
      { country: 'Canada', exportValueUsd: 420000000, share: 0.2 },
      { country: 'United Kingdom', exportValueUsd: 360000000, share: 0.17 },
      { country: 'Australia', exportValueUsd: 310000000, share: 0.14 },
    ],
  },
  {
    eccn: '1C351',
    description: 'Human and zoonotic pathogens, toxins, and certain genetic elements.',
    latestYear: 2023,
    exportValueUsd: 420000000,
    importValueUsd: 110000000,
    notes: 'Exports concentrated among trusted research partners with advanced biosafety facilities.',
    topDestinations: [
      { country: 'Germany', exportValueUsd: 95000000, share: 0.23 },
      { country: 'Japan', exportValueUsd: 82000000, share: 0.2 },
      { country: 'United Kingdom', exportValueUsd: 67000000, share: 0.16 },
    ],
  },
];
