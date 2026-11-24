import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logOut, testConnection } from '../lib/firebase.ts';
import { FirestorePortfolioSync } from '../data/portfolio/firestorePortfolioSync.ts';
import { PortfolioStore } from '../data/portfolio/portfolioStore.ts';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  isFirebaseReady: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
  isFirebaseReady: false,
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);

  useEffect(() => {
    ErrorReportingService.installGlobalListeners();

    // Test connectivity per skill mandate
    testConnection().then((connected) => {
      setIsFirebaseReady(connected);
    });

    let unsubscribeBets: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubscribeBets) {
        unsubscribeBets();
        unsubscribeBets = null;
      }

      setUser(currentUser);
      setLoading(false);

      // If user logs in, ensure their user profile document exists in Firestore without overwriting createdAt
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const nowIso = new Date().toISOString();
          const snap = await getDoc(userRef);

          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: (currentUser.email || 'user@pitchintel.internal').slice(0, 256),
              displayName: (currentUser.displayName || 'Football Analyst').slice(0, 100),
              photoURL: (currentUser.photoURL || '').slice(0, 500),
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          } else {
            const existingData = snap.data();
            await updateDoc(userRef, {
              email: (currentUser.email || existingData?.email || 'user@pitchintel.internal').slice(0, 256),
              displayName: (currentUser.displayName || existingData?.displayName || 'Football Analyst').slice(0, 100),
              photoURL: (currentUser.photoURL || existingData?.photoURL || '').slice(0, 500),
              updatedAt: nowIso,
            });
          }
        } catch (err) {
          // If permission error or offline, handle gracefully
          console.warn('Profile sync notice:', err);
        }

        unsubscribeBets = FirestorePortfolioSync.subscribeToUserBets(currentUser.uid, (bets) => {
          PortfolioStore.mergeCloudBets(bets);
        });

        ErrorReportingService.flushPendingReports().catch(() => {});
      }
    });

    return () => {
      if (unsubscribeBets) {
        unsubscribeBets();
      }
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Failed to sign in with Google:', error);
      throw error;
    }
  };

  const handleSignOut = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error('Failed to sign out:', error);
      throw error;
    }
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn: handleSignIn,
        signOut: handleSignOut,
        getIdToken,
        isFirebaseReady,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
