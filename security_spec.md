# Security Specification: PitchIntel Firebase Architecture

## 1. Data Invariants
1. **User Isolation**: A user can only access, create, update, or delete their own data under `/users/{userId}` and its subcollections (`/users/{userId}/bets/{betId}`, `/users/{userId}/favourites/{favouriteId}`).
2. **Identity Integrity**: For any write operation, `request.auth.uid` must match `{userId}` and any `userId`/`uid` field in the payload.
3. **No Impersonation**: Anonymous and unauthenticated requests are strictly rejected for user records.
4. **Verified Users**: Non-verified email users cannot perform destructive mutations.
5. **No Blanket Reads**: Global listing of users or unconstrained querying across users is strictly forbidden.
6. **Immutable Fields**: `uid`, `userId`, `createdAt`, `placedAt` cannot be modified after document creation.
7. **Strict Field Validation**: Every field must conform to defined maximum lengths, enum values, and expected data types.
8. **Error Monitoring Isolation**: Authenticated verified users may create `error_reports` entries only under their own `userId` with initial `status: 'OPEN'`; reading (`get`/`list`) is strictly scoped to the report owner or verified admin (`believermutambo9@gmail.com`), and status transitions/deletions are restricted to verified admins.

## 2. The Dirty Dozen Payloads (Adversarial Vectors)
1. **Unauthenticated User Profile Write**: Unauthenticated client attempts to create `/users/target-uid`. (Expected: REJECT)
2. **Cross-User Profile Spoofing**: Authenticated User A (`uid_attacker`) attempts to write to `/users/uid_victim`. (Expected: REJECT)
3. **Ghost Field Injection**: User attempts to update profile with `{ role: 'admin', isSuperuser: true }`. (Expected: REJECT)
4. **Denial-of-Wallet (Oversized Payload)**: Attacker attempts to inject a 2MB string into `displayName`, `selection`, or `errorMessage`. (Expected: REJECT)
5. **Invalid Document ID Poisoning**: Attacker passes a 500-character malicious document ID containing path traversal symbols. (Expected: REJECT)
6. **Cross-User Bet Creation**: User A writes to `/users/uid_attacker/bets/bet_1` with payload containing `userId: "uid_victim"`. (Expected: REJECT)
7. **Tampering with Bet Resolution State**: User attempts to mutate a settled bet (`status: WON`, modifying profit retroactively). (Expected: REJECT)
8. **Invalid Enum Type Injection**: User creates a bet with `marketType: "CORRUPT_MARKET"` or error report with `method: "EXEC"`. (Expected: REJECT)
9. **Negative Stake Manipulation**: User attempts to create a bet with a negative stake (`stake: -500`). (Expected: REJECT)
10. **Global Blanket Collection Read**: User queries `collection(db, 'users')` or `collection(db, 'error_reports')` without filtering by their own UID (when non-admin). (Expected: REJECT)
11. **Subcollection Orphaned Path Escapes**: Client attempts to read sibling user subcollections `/users/uid_victim/bets`. (Expected: REJECT)
12. **Error Report Privilege Escalation**: Non-admin user attempts to create an `error_reports` doc pre-marked `status: 'RESOLVED'`, spoof another `userId`, or update an existing report's status. (Expected: REJECT)

