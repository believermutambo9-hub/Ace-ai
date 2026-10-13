// Paper Trading & Bankroll Portfolio Store
export interface BetSlipItem {
  id: string; // unique item id
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTime: string;
  marketType: string;
  selection: string;
  selectionLabel: string;
  modelProbability: number;
  bookmakerOdds: number;
  edgePercent: number;
  recommendedKellyPercent: number;
  stake: number;
}

export interface TrackedBet {
  id: string;
  placedAt: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTime: string;
  marketType: string;
  selection: string;
  selectionLabel: string;
  odds: number;
  stake: number;
  potentialPayout: number;
  modelProbability: number;
  edgePercent: number;
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  settledAt?: string;
  profit?: number; // net profit: stake * (odds - 1) if WON, -stake if LOST, 0 if VOID
}

export interface PortfolioState {
  bankroll: number;
  initialBankroll: number;
  slip: BetSlipItem[];
  trackedBets: TrackedBet[];
}

const STORAGE_KEY = 'kickprophet_portfolio_v1';
const LISTEN_EVENT = 'kickprophet_portfolio_update';

function getDefaultState(): PortfolioState {
  return {
    bankroll: 1000.0,
    initialBankroll: 1000.0,
    slip: [],
    trackedBets: [
      {
        id: 'sample-bet-1',
        placedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        matchId: 101,
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        competition: 'Premier League',
        kickoffTime: new Date(Date.now() - 3600000 * 2).toISOString(),
        marketType: '1X2',
        selection: 'HOME',
        selectionLabel: 'Arsenal to Win',
        odds: 1.85,
        stake: 50.0,
        potentialPayout: 92.5,
        modelProbability: 0.62,
        edgePercent: 14.7,
        status: 'WON',
        settledAt: new Date(Date.now() - 3600000).toISOString(),
        profit: 42.5,
      },
      {
        id: 'sample-bet-2',
        placedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        matchId: 102,
        homeTeam: 'Real Madrid',
        awayTeam: 'Barcelona',
        competition: 'La Liga',
        kickoffTime: new Date(Date.now() - 3600000 * 20).toISOString(),
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        selectionLabel: 'Over 2.5 Goals',
        odds: 1.72,
        stake: 40.0,
        potentialPayout: 68.8,
        modelProbability: 0.65,
        edgePercent: 11.8,
        status: 'WON',
        settledAt: new Date(Date.now() - 3600000 * 18).toISOString(),
        profit: 28.8,
      },
    ],
  };
}

export class PortfolioStore {
  public static getState(): PortfolioState {
    if (typeof window === 'undefined') return getDefaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const def = getDefaultState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(def));
        return def;
      }
      return JSON.parse(raw);
    } catch {
      return getDefaultState();
    }
  }

  private static saveState(state: PortfolioState): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent(LISTEN_EVENT, { detail: state }));
    } catch (e) {
      console.error('Failed to save portfolio state', e);
    }
  }

  public static setBankroll(amount: number): void {
    const state = this.getState();
    state.bankroll = Math.max(10, amount);
    this.saveState(state);
  }

  public static resetPortfolio(initialAmount: number = 1000): void {
    const state: PortfolioState = {
      bankroll: initialAmount,
      initialBankroll: initialAmount,
      slip: [],
      trackedBets: [],
    };
    this.saveState(state);
  }

  public static addToSlip(item: Omit<BetSlipItem, 'id' | 'stake'>): boolean {
    const state = this.getState();
    const exists = state.slip.some(s => s.matchId === item.matchId && s.selection === item.selection);
    if (exists) return false;

    // Default stake based on Half Kelly or $25
    const kellyDollars = Math.round(state.bankroll * (item.recommendedKellyPercent / 100) * 10) / 10;
    const initialStake = Math.max(10, Math.min(100, kellyDollars || 25));

    state.slip.push({
      ...item,
      id: `${item.matchId}-${item.selection}-${Date.now()}`,
      stake: initialStake,
    });
    this.saveState(state);
    return true;
  }

  public static updateSlipStake(id: string, stake: number): void {
    const state = this.getState();
    const found = state.slip.find(s => s.id === id);
    if (found) {
      found.stake = Math.max(1, stake);
      this.saveState(state);
    }
  }

  public static removeFromSlip(id: string): void {
    const state = this.getState();
    state.slip = state.slip.filter(s => s.id !== id);
    this.saveState(state);
  }

  public static clearSlip(): void {
    const state = this.getState();
    state.slip = [];
    this.saveState(state);
  }

  public static placeAllSlipBets(): number {
    const state = this.getState();
    if (state.slip.length === 0) return 0;

    let placedCount = 0;
    for (const item of state.slip) {
      if (state.bankroll < item.stake) continue;

      state.bankroll -= item.stake;
      state.trackedBets.unshift({
        id: `bet-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        placedAt: new Date().toISOString(),
        matchId: item.matchId,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        competition: item.competition,
        kickoffTime: item.kickoffTime,
        marketType: item.marketType,
        selection: item.selection,
        selectionLabel: item.selectionLabel,
        odds: item.bookmakerOdds,
        stake: item.stake,
        potentialPayout: Math.round(item.stake * item.bookmakerOdds * 100) / 100,
        modelProbability: item.modelProbability,
        edgePercent: item.edgePercent,
        status: 'OPEN',
      });
      placedCount++;
    }

    state.slip = [];
    this.saveState(state);
    return placedCount;
  }

  public static settleBet(betId: string, outcome: 'WON' | 'LOST' | 'VOID'): void {
    const state = this.getState();
    const bet = state.trackedBets.find(b => b.id === betId);
    if (!bet || bet.status !== 'OPEN') return;

    bet.status = outcome;
    bet.settledAt = new Date().toISOString();

    if (outcome === 'WON') {
      const payout = bet.stake * bet.odds;
      bet.profit = Math.round((payout - bet.stake) * 100) / 100;
      state.bankroll += payout;
    } else if (outcome === 'LOST') {
      bet.profit = -bet.stake;
    } else if (outcome === 'VOID') {
      bet.profit = 0;
      state.bankroll += bet.stake; // refund stake
    }

    state.bankroll = Math.round(state.bankroll * 100) / 100;
    this.saveState(state);
  }

  public static deleteTrackedBet(betId: string): void {
    const state = this.getState();
    state.trackedBets = state.trackedBets.filter(b => b.id !== betId);
    this.saveState(state);
  }

  public static getPortfolioMetrics(state: PortfolioState) {
    const settled = state.trackedBets.filter(b => b.status !== 'OPEN');
    const open = state.trackedBets.filter(b => b.status === 'OPEN');
    const won = settled.filter(b => b.status === 'WON');
    const lost = settled.filter(b => b.status === 'LOST');

    const totalStakedSettled = settled.reduce((acc, b) => acc + b.stake, 0);
    const totalProfit = settled.reduce((acc, b) => acc + (b.profit || 0), 0);
    const openExposure = open.reduce((acc, b) => acc + b.stake, 0);

    const winRate = settled.length > 0 ? (won.length / (won.length + lost.length || 1)) * 100 : 0;
    const roi = totalStakedSettled > 0 ? (totalProfit / totalStakedSettled) * 100 : 0;

    return {
      currentBankroll: state.bankroll,
      totalNetProfit: Math.round(totalProfit * 100) / 100,
      totalStaked: Math.round(totalStakedSettled * 100) / 100,
      openExposure: Math.round(openExposure * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      roi: Math.round(roi * 10) / 10,
      totalBetsCount: state.trackedBets.length,
      openBetsCount: open.length,
      settledBetsCount: settled.length,
      wonCount: won.length,
      lostCount: lost.length,
    };
  }

  public static subscribe(callback: (state: PortfolioState) => void): () => void {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<PortfolioState>;
      callback(customEvent.detail || PortfolioStore.getState());
    };
    window.addEventListener(LISTEN_EVENT, handler);
    return () => window.removeEventListener(LISTEN_EVENT, handler);
  }
}
