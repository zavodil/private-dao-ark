import React, { useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { actionCreators } from '@near-js/transactions';

interface JoinDAOProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  isMember: boolean;
  hasPubkey: boolean;
  membershipMode: string;
  onSuccess: () => void;
}

export const JoinDAO: React.FC<JoinDAOProps> = ({
  selector,
  accountId,
  contractId,
  isMember,
  hasPubkey,
  membershipMode,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!selector) return;

    setLoading(true);
    setError(null);

    try {
      const wallet = await selector.wallet();

      // Join DAO (public mode) - costs 0.012 NEAR (storage + OutLayer)
      const action = actionCreators.functionCall(
        'join_dao',
        {},
        BigInt('200000000000000'), // 200 TGas
        BigInt('12000000000000000000000') // 0.012 NEAR
      );

      await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      // Refresh data after transaction completes
      // OutLayer execution takes longer, so wait more
      setTimeout(() => {
        onSuccess();
        setLoading(false);
      }, 5000);
    } catch (err: any) {
      console.error('Failed to join DAO:', err);
      setError(err.message || 'Failed to join DAO');
      setLoading(false);
    }
  };

  const handleCompleteJoin = async () => {
    if (!selector) return;

    setLoading(true);
    setError(null);

    try {
      const wallet = await selector.wallet();

      // Complete join (private mode) - costs 0.01 NEAR (OutLayer only)
      const action = actionCreators.functionCall(
        'complete_join',
        {},
        BigInt('200000000000000'), // 200 TGas
        BigInt('10000000000000000000000') // 0.01 NEAR
      );

      await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      // Refresh data after transaction completes
      // OutLayer execution takes longer, so wait more
      setTimeout(() => {
        onSuccess();
        setLoading(false);
      }, 5000);
    } catch (err: any) {
      console.error('Failed to complete join:', err);
      setError(err.message || 'Failed to complete join');
      setLoading(false);
    }
  };

  if (isMember && hasPubkey) {
    return (
      <div className="join-dao-complete">
        <h2>✅ You're a Member!</h2>
        <p>You have successfully joined the DAO and your encryption key is ready.</p>
        <p>You can now create proposals and vote anonymously.</p>
      </div>
    );
  }

  if (isMember && !hasPubkey) {
    return (
      <div className="join-dao-pending">
        <h2>⏳ Generating Your Encryption Key...</h2>
        <p>Your membership is confirmed. OutLayer is generating your encryption key.</p>
        <p>This may take a minute. Please refresh the page.</p>
        <button onClick={onSuccess} className="btn-secondary">
          Refresh Status
        </button>
      </div>
    );
  }

  return (
    <div className="join-dao">
      <h2>Join {membershipMode} DAO</h2>

      {membershipMode === 'Public' ? (
        <>
          <p>Anyone can join this DAO!</p>
          <p><strong>Cost:</strong> ~0.012 NEAR (storage deposit + key generation)</p>
          <p><strong>Process:</strong></p>
          <ol>
            <li>Pay storage deposit (0.002 NEAR)</li>
            <li>OutLayer generates your unique encryption key (0.01 NEAR)</li>
            <li>You can start voting with encrypted ballots</li>
          </ol>

          <button
            onClick={handleJoin}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Joining...' : 'Join DAO (0.012 NEAR)'}
          </button>
        </>
      ) : (
        <>
          <p>This is a private DAO. Members must be invited by the owner.</p>
          {isMember ? (
            <>
              <p className="success">✓ You have been invited!</p>
              <p><strong>Cost:</strong> ~0.01 NEAR (key generation)</p>
              <button
                onClick={handleCompleteJoin}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Generating Key...' : 'Complete Join (0.01 NEAR)'}
              </button>
            </>
          ) : (
            <p className="warning">You need to be invited by the DAO owner first.</p>
          )}
        </>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="info-box">
        <h3>🔐 Privacy Features</h3>
        <ul>
          <li>Your encryption key is derived in a TEE (Trusted Execution Environment)</li>
          <li>Only you can encrypt votes with your key</li>
          <li>Individual votes are never revealed - only tallies</li>
          <li>You can send dummy votes for plausible deniability</li>
        </ul>
      </div>
    </div>
  );
};
