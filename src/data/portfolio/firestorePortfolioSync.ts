import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase.ts';
import type { TrackedBet } from './portfolioStore.ts';

const ALLOWED_FIRESTORE_MARKETS = new Set([
  'MATCH_WINNER_HOME',
  'MATCH_WINNER_DRAW',
  'MATCH_WINNER_AWAY',
  'OVER_25',
  'UNDER_25',
  'BTTS_YES',
  'BTTS_NO',
]);

export function normalizeFirestoreMarketType(marketType: string, selection: string): string | null {
  if (ALLOWED_FIRESTORE_MARKETS.has(marketType)) return marketType;
  const sel = (selection || '').toUpperCase();
  if (marketType === '1X2') {
    if (sel.includes('HOME')) return 'MATCH_WINNER_HOME';
    if (sel.includes('DRAW')) return 'MATCH_WINNER_DRAW';
    if (sel.includes('AWAY')) return 'MATCH_WINNER_AWAY';
  }
  if (marketType === 'TOTAL_GOALS_2_5') {
    if (sel.includes('OVER')) return 'OVER_25';
    if (sel.includes('UNDER')) return 'UNDER_25';
  }
  if (marketType === 'BTTS') {
    if (sel.includes('YES')) return 'BTTS_YES';
    if (sel.includes('NO')) return 'BTTS_NO';
  }
  return null;
}

/**
 * Synchronize local portfolio bets to and from Firestore for authenticated users.
 */
export class FirestorePortfolioSync {
  /**
   * Sync a newly placed bet to Firestore
   */
  public static async syncBetToFirestore(bet: TrackedBet): Promise<void> {
    const user = auth.currentUser;
    if (!user) return; // Unauthenticated users use localStorage only

    const canonicalMarket = normalizeFirestoreMarketType(bet.marketType, bet.selection);
    if (!canonicalMarket) return; // Markets outside Firestore rule enum stay in localStorage

    const betPath = `users/${user.uid}/bets/${bet.id}`;
    try {
      const betRef = doc(db, 'users', user.uid, 'bets', bet.id);
      const boundedOdds = Math.min(1000, Math.max(1.01, Number(bet.odds) || 1.01));
      const boundedStake = Math.min(1000000, Math.max(0.01, Number(bet.stake) || 10));
      const boundedProb = Math.min(1, Math.max(0, Number(bet.modelProbability ?? 0.5)));

      await setDoc(betRef, {
        id: bet.id.slice(0, 64),
        userId: user.uid,
        matchId: String(bet.matchId).slice(0, 64),
        homeTeam: (bet.homeTeam || 'Home').slice(0, 128),
        awayTeam: (bet.awayTeam || 'Away').slice(0, 128),
        competition: (bet.competition || 'League').slice(0, 128),
        marketType: canonicalMarket,
        selection: (bet.selectionLabel || bet.selection || canonicalMarket).slice(0, 64),
        odds: boundedOdds,
        stake: boundedStake,
        modelProbability: boundedProb,
        status: bet.status,
        profit: Number(bet.profit || 0),
        placedAt: bet.placedAt.slice(0, 64),
        ...(bet.settledAt ? { settledAt: bet.settledAt.slice(0, 64) } : {}),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, betPath);
    }
  }

  /**
   * Update bet resolution state in Firestore
   */
  public static async updateSettledBetInFirestore(
    betId: string,
    outcome: 'WON' | 'LOST' | 'VOID',
    profit: number,
    settledAt: string
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    const betPath = `users/${user.uid}/bets/${betId}`;
    try {
      const betRef = doc(db, 'users', user.uid, 'bets', betId);
      await updateDoc(betRef, {
        status: outcome,
        profit: Number(profit),
        settledAt: settledAt.slice(0, 64),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, betPath);
    }
  }

  /**
   * Delete a settled bet from Firestore
   */
  public static async deleteBetFromFirestore(betId: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    const betPath = `users/${user.uid}/bets/${betId}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'bets', betId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, betPath);
    }
  }

  /**
   * Listen to real-time bets from Firestore for authenticated user
   */
  public static subscribeToUserBets(userId: string, onBetsUpdated: (bets: TrackedBet[]) => void) {
    const betsPath = `users/${userId}/bets`;
    return onSnapshot(
      collection(db, 'users', userId, 'bets'),
      (snapshot) => {
        const firestoreBets: TrackedBet[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          firestoreBets.push({
            id: data.id || d.id,
            placedAt: data.placedAt || new Date().toISOString(),
            matchId: Number(data.matchId) || 0,
            homeTeam: data.homeTeam || '',
            awayTeam: data.awayTeam || '',
            competition: data.competition || '',
            kickoffTime: data.placedAt || '',
            marketType: data.marketType || 'MATCH_WINNER_HOME',
            selection: data.selection || '',
            selectionLabel: data.selection || '',
            odds: Number(data.odds) || 1.0,
            stake: Number(data.stake) || 10,
            potentialPayout: Number(data.stake * data.odds) || 10,
            modelProbability: Number(data.modelProbability) || 0.5,
            edgePercent: 0,
            status: data.status || 'OPEN',
            settledAt: data.settledAt,
            profit: data.profit !== undefined ? Number(data.profit) : undefined,
          });
        });
        onBetsUpdated(firestoreBets);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, betsPath);
        } catch {
          // Structured error already logged by handleFirestoreError; avoid uncaught snapshot listener crash
        }
      }
    );
  }
}
