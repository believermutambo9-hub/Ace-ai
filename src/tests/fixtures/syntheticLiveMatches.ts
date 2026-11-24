/**
 * Synthetic Test Fixtures for Automated Testing and Unit Simulation.
 * Explicitly isolated from production data paths.
 * MARKED: [TEST_FIXTURE_ONLY]
 */

export interface TestLiveFixture {
  extId: string;
  compCode: string;
  homeName: string;
  homeId: number;
  awayName: string;
  awayId: number;
  minute: number;
  period: '1H' | 'HT' | '2H' | 'FT';
  homeScore: number;
  awayScore: number;
  venue: string;
  isSyntheticTestFixture: true;
}

export const SYNTHETIC_TEST_FIXTURES: TestLiveFixture[] = [
  {
    extId: 'test_fixture_pl_ars_mci',
    compCode: 'PL',
    homeName: 'Arsenal FC',
    homeId: 1,
    awayName: 'Manchester City FC',
    awayId: 3,
    minute: 68,
    period: '2H',
    homeScore: 2,
    awayScore: 1,
    venue: 'Emirates Stadium',
    isSyntheticTestFixture: true,
  },
  {
    extId: 'test_fixture_pd_bar_atm',
    compCode: 'PD',
    homeName: 'FC Barcelona',
    homeId: 12,
    awayName: 'Atlético de Madrid',
    awayId: 13,
    minute: 45,
    period: 'HT',
    homeScore: 1,
    awayScore: 1,
    venue: 'Estadi Olímpic Lluís Companys',
    isSyntheticTestFixture: true,
  },
];
