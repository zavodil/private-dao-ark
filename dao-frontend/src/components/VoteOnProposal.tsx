import React, { useEffect, useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { Proposal } from '../types';
import { encrypt } from 'eciesjs';
import { actionCreators } from '@near-js/transactions';

interface VoteOnProposalProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  network: string;
  onSuccess: () => void;
  viewMethod: (method: string, args?: any) => Promise<any>;
}

export const VoteOnProposal: React.FC<VoteOnProposalProps> = ({
  selector,
  accountId,
  contractId,
  network,
  onSuccess,
  viewMethod,
}) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
  const [vote, setVote] = useState<'yes' | 'no' | 'dummy' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveProposals();
    fetchUserPubkey();
  }, [selector, contractId, accountId]);

  const fetchActiveProposals = async () => {
    try {
      const all = await viewMethod('get_proposals', { from_index: 0, limit: 50 });
      const active = (all as Proposal[]).filter((p: Proposal) => p.status === 'Active');
      setProposals(active);
    } catch (error) {
      console.error('Failed to fetch proposals:', error);
    }
  };

  const fetchUserPubkey = async () => {
    if (!accountId) return;

    try {
      const pubkey = await viewMethod('get_user_pubkey', { account_id: accountId });
      setUserPubkey(pubkey as string);
    } catch (error) {
      console.error('Failed to fetch pubkey:', error);
    }
  };

  const encryptVote = (voteValue: string, pubkey: string): string => {
    // ✅ PRODUCTION-READY: Full ECIES encryption with secp256k1
    // Compatible with Rust backend (ecies crate)
    //
    // pubkey format: 33-byte hex string (compressed secp256k1 public key)
    // Returns: hex-encoded ciphertext (ephemeral key + nonce included inside)

    try {
      // Encode vote text to bytes
      const encoder = new TextEncoder();
      const plaintext = encoder.encode(voteValue);

      // Encrypt with ECIES (secp256k1 + AES-256-GCM)
      const ciphertext = encrypt(pubkey, plaintext);

      // Convert to hex string for contract storage
      const encrypted = Buffer.from(ciphertext).toString('hex');

      console.log('✅ Vote encrypted with ECIES (secp256k1)');
      return encrypted;
    } catch (error) {
      console.error('❌ ECIES encryption failed:', error);
      throw new Error(`Failed to encrypt vote: ${error}`);
    }
  };

  const handleVote = async () => {
    if (!selector || !selectedProposal || !vote || !userPubkey) return;

    setLoading(true);
    setError(null);

    try {
      // For dummy vote, generate random noise (NOT "yes" or "no")
      // This confuses observers by hiding whether you actually voted
      // The backend will decrypt it and ignore it (not "yes" or "no" = dummy)
      const voteToEncrypt = vote === 'dummy'
        ? 'dummy_' + Math.random().toString(36).substring(7)  // Random string like "dummy_x7k2p"
        : vote;

      // Encrypt vote with ECIES
      const encrypted = encryptVote(voteToEncrypt, userPubkey);

      const wallet = await selector.wallet();

      const action = actionCreators.functionCall(
        'cast_vote',
        {
          proposal_id: selectedProposal,
          encrypted_vote: encrypted,
        },
        BigInt('200000000000000'), // 200 TGas
        BigInt('2000000000000000000000') // 0.002 NEAR
      );

      await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      setTimeout(() => {
        setVote('');
        setSelectedProposal(null);
        onSuccess();
        setLoading(false);
      }, 2000);
    } catch (err: any) {
      console.error('Failed to vote:', err);
      setError(err.message || 'Failed to cast vote');
      setLoading(false);
    }
  };


  if (proposals.length === 0) {
    return (
      <div className="no-active-proposals">
        <h2>No Active Proposals</h2>
        <p>There are no proposals open for voting at the moment.</p>
      </div>
    );
  }

  return (
    <div className="vote-on-proposal">
      <h2>Cast Your Vote</h2>

      <div className="info-box">
        <strong>🔒 Secure Voting:</strong> Your vote is encrypted with ECIES (secp256k1 + AES-256-GCM) before submission. Only the TEE can decrypt votes during tallying.
      </div>

      <div className="proposal-select">
        <label>Select Proposal:</label>
        <select
          value={selectedProposal || ''}
          onChange={(e) => setSelectedProposal(Number(e.target.value))}
        >
          <option value="">-- Choose a proposal --</option>
          {proposals.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id}: {p.title}
            </option>
          ))}
        </select>
      </div>

      {selectedProposal && (
        <div className="proposal-details">
          {(() => {
            const proposal = proposals.find((p) => p.id === selectedProposal);
            if (!proposal) return null;

            const isPastDeadline = Date.now() * 1_000_000 > proposal.deadline;

            return (
              <>
                <h3>{proposal.title}</h3>
                <p>{proposal.description}</p>
                <p>
                  <strong>Deadline:</strong>{' '}
                  {new Date(proposal.deadline / 1_000_000).toLocaleString()}
                  {isPastDeadline && <span className="expired"> (EXPIRED - No new votes allowed)</span>}
                </p>

                {/* Voting form - only if deadline not passed */}
                {!isPastDeadline && (
                  <div className="vote-form">
                    <div className="vote-buttons">
                      <button
                        className={`vote-btn yes ${vote === 'yes' ? 'selected' : ''}`}
                        onClick={() => setVote('yes')}
                      >
                        👍 YES
                      </button>
                      <button
                        className={`vote-btn no ${vote === 'no' ? 'selected' : ''}`}
                        onClick={() => setVote('no')}
                      >
                        👎 NO
                      </button>
                      <button
                        className={`vote-btn dummy ${vote === 'dummy' ? 'selected' : ''}`}
                        onClick={() => setVote('dummy')}
                        title="Send encrypted noise to confuse observers. Not counted in tally."
                      >
                        🎭 DUMMY
                      </button>
                    </div>

                    {vote === 'dummy' && (
                      <div className="dummy-info">
                        <strong>🎭 Dummy Vote:</strong> Sends encrypted noise (not "yes"/"no") that looks like a real vote to observers. TEE will only count "yes"/"no" votes during tallying, ignoring dummy votes. Use this to hide whether you actually voted.
                      </div>
                    )}

                    {vote && (
                      <button
                        onClick={handleVote}
                        disabled={loading}
                        className="btn-primary"
                      >
                        {loading ? 'Casting Vote...' : vote === 'dummy'
                          ? 'Cast Dummy Vote (0.002 NEAR)'
                          : `Cast ${vote.toUpperCase()} Vote (0.002 NEAR)`}
                      </button>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="info-box">
        <h3>🔐 Privacy Notice</h3>
        <p>
          Your vote is encrypted with your unique key before being submitted to the blockchain.
          Only the TEE (Trusted Execution Environment) can decrypt and count votes.
        </p>
        <p>
          <strong>YES/NO votes:</strong> TEE will only count "yes" and "no" votes during tallying.
        </p>
        <p>
          <strong>Dummy votes:</strong> Send encrypted noise (not "yes"/"no") that looks like a regular transaction to observers, but won't be counted. Use this to hide whether you actually voted.
        </p>
        <p>
          <strong>Finalization:</strong> Go to the "Proposals" tab to finalize and count votes.
        </p>
      </div>
    </div>
  );
};
