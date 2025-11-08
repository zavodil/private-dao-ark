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
  const [votingProposal, setVotingProposal] = useState<number | null>(null);
  const [vote, setVote] = useState<'yes' | 'no' | 'dummy' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [voteHash, setVoteHash] = useState<string | null>(null);
  const [userJoinedAt, setUserJoinedAt] = useState<number | null>(null);

  useEffect(() => {
    fetchActiveProposals();
    fetchUserPubkey();
    fetchUserJoinedAt();
  }, [selector, contractId, accountId]);

  const fetchUserJoinedAt = async () => {
    if (!accountId) return;

    try {
      const memberInfo = await viewMethod('get_member_info', { account_id: accountId });
      if (memberInfo && memberInfo.joined_at !== undefined) {
        setUserJoinedAt(memberInfo.joined_at);
      }
    } catch (error) {
      console.error('Failed to fetch member info:', error);
    }
  };

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
    try {
      const encoder = new TextEncoder();
      const plaintext = encoder.encode(voteValue);
      const ciphertext = encrypt(pubkey, plaintext);
      const encrypted = Buffer.from(ciphertext).toString('hex');
      console.log('✅ Vote encrypted with ECIES');
      return encrypted;
    } catch (error) {
      console.error('❌ ECIES encryption failed:', error);
      throw new Error(`Failed to encrypt vote: ${error}`);
    }
  };

  const handleVote = async (proposalId: number) => {
    if (!selector || !vote || !userPubkey) return;

    setLoading(true);
    setError(null);
    setShowSuccess(false);

    try {
      const voteToEncrypt = vote === 'dummy'
        ? 'dummy_' + Math.random().toString(36).substring(7)
        : vote;

      const encrypted = encryptVote(voteToEncrypt, userPubkey);

      const voteInfo = {
        proposal_id: proposalId,
        vote: vote,
        encrypted_vote: encrypted,
        saved_at: new Date().toISOString()
      };
      localStorage.setItem(`vote_${proposalId}_${accountId}`, JSON.stringify(voteInfo));

      const wallet = await selector.wallet();

      const action = actionCreators.functionCall(
        'cast_vote',
        {
          proposal_id: proposalId,
          encrypted_vote: encrypted,
        },
        BigInt('200000000000000'),
        BigInt('2000000000000000000000')
      );

      const result = await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      console.log('📦 Full transaction result:', result);

      // cast_vote now returns timestamp (u64)
      // Extract return value from transaction result
      let timestamp: string | null = null;
      try {
        // Try different possible locations for the result
        // @ts-ignore
        let successValue = null;

        // wallet-selector format
        if (result && typeof result === 'object') {
          // Try receipts_outcome array (common in NEAR)
          // @ts-ignore
          if (result.receipts_outcome && Array.isArray(result.receipts_outcome)) {
            // @ts-ignore
            for (const receipt of result.receipts_outcome) {
              // @ts-ignore
              if (receipt?.outcome?.status?.SuccessValue) {
                // @ts-ignore
                successValue = receipt.outcome.status.SuccessValue;
                console.log('✅ Found SuccessValue in receipts_outcome');
                break;
              }
            }
          }

          // Try transaction.outcome
          // @ts-ignore
          if (!successValue && result.transaction?.outcome?.status?.SuccessValue) {
            // @ts-ignore
            successValue = result.transaction.outcome.status.SuccessValue;
            console.log('✅ Found SuccessValue in transaction.outcome');
          }

          // Try direct status
          // @ts-ignore
          if (!successValue && result.status?.SuccessValue) {
            // @ts-ignore
            successValue = result.status.SuccessValue;
            console.log('✅ Found SuccessValue in status');
          }
        }

        if (successValue) {
          // SuccessValue is base64 encoded
          const decodedValue = atob(successValue);
          console.log('📝 Decoded value (raw string):', decodedValue);

          // Parse timestamp as string directly from JSON to preserve full u64 precision
          // Do NOT use JSON.parse() as it converts to Number and loses precision
          // Just extract the number string from JSON manually
          timestamp = decodedValue.trim();

          console.log('✅ Received timestamp from contract (as string):', timestamp);
        } else {
          console.warn('⚠️ Could not find SuccessValue in transaction result');
        }
      } catch (e) {
        console.error('❌ Failed to parse timestamp from result:', e);
      }

      // Compute vote hash if we got timestamp
      if (timestamp) {
        // Worker computes: SHA256(user_bytes + timestamp_le_bytes + encrypted_bytes)
        // We need to match this EXACTLY

        // Convert timestamp to u64 little-endian bytes (8 bytes)
        const timestampBuffer = new ArrayBuffer(8);
        const timestampView = new DataView(timestampBuffer);

        // Parse as BigInt to avoid precision loss with large u64
        const timestampBigInt = BigInt(timestamp);
        timestampView.setBigUint64(0, timestampBigInt, true); // true = little-endian

        // Combine: accountId + timestamp_le_bytes + encrypted
        const userBytes = new TextEncoder().encode(accountId);
        const timestampBytes = new Uint8Array(timestampBuffer);
        const encryptedBytes = new TextEncoder().encode(encrypted);

        // Concatenate all bytes
        const combined = new Uint8Array(userBytes.length + timestampBytes.length + encryptedBytes.length);
        combined.set(userBytes, 0);
        combined.set(timestampBytes, userBytes.length);
        combined.set(encryptedBytes, userBytes.length + timestampBytes.length);

        console.log('🔍 Hash input breakdown:');
        console.log('  - accountId:', accountId, '(', userBytes.length, 'bytes)');
        console.log('  - timestamp:', timestamp, '→ BigInt:', timestampBigInt.toString());
        console.log('  - timestamp bytes (LE):', Array.from(timestampBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        console.log('  - encrypted length:', encryptedBytes.length, 'bytes');

        const hashBytes = await crypto.subtle.digest('SHA-256', combined);
        const hashArray = Array.from(new Uint8Array(hashBytes));
        const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        setVoteHash(computedHash);
        console.log('✅ Vote hash computed:', computedHash);
      } else {
        console.warn('⚠️ No timestamp received, cannot compute vote hash');
      }

      setShowSuccess(true);
      setVote('');
      setVotingProposal(null);

      setTimeout(() => {
        onSuccess();
        setLoading(false);
      }, 3000);
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

      {proposals.map((proposal) => {
        const isPastDeadline = proposal.deadline ? Date.now() * 1_000_000 > proposal.deadline : false;
        const isVoting = votingProposal === proposal.id;

        // Check if user joined AFTER proposal was created (can't vote)
        // joined_at = 0 means migrated user (can vote on everything)
        const joinedAfterProposal = userJoinedAt !== null && userJoinedAt > 0 && userJoinedAt >= proposal.created_at;
        const canVote = !isPastDeadline && !joinedAfterProposal;

        return (
          <div
            key={proposal.id}
            style={{
              marginTop: '20px',
              padding: '20px',
              border: isVoting ? '2px solid #2196f3' : '1px solid #ddd',
              borderRadius: '8px',
              backgroundColor: isVoting ? '#f0f7ff' : 'white'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>#{proposal.id}: {proposal.title}</h3>
              {isPastDeadline && <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>⏰ EXPIRED</span>}
            </div>

            <p style={{ marginTop: '10px', color: '#666' }}>{proposal.description}</p>

            <div style={{ fontSize: '0.9em', color: '#666', marginTop: '8px' }}>
              <strong>Deadline:</strong>{' '}
              {proposal.deadline
                ? new Date(proposal.deadline / 1_000_000).toLocaleString()
                : 'No deadline'}
            </div>

            {joinedAfterProposal && (
              <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff3e0', border: '1px solid #ff9800', borderRadius: '4px' }}>
                ⚠️ You joined after this proposal was created. You cannot vote on it.
              </div>
            )}

            {canVote && !isVoting && (
              <button
                onClick={() => {
                  setVotingProposal(proposal.id);
                  setVote('');
                  setVoteHash(null);
                  setShowSuccess(false);
                }}
                className="btn-secondary"
                style={{ marginTop: '15px', width: '100%' }}
              >
                🗳️ Vote on this proposal
              </button>
            )}

            {isVoting && (
              <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                <div className="vote-buttons" style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                  <button
                    className={`vote-btn yes ${vote === 'yes' ? 'selected' : ''}`}
                    onClick={() => setVote('yes')}
                    style={{
                      flex: 1,
                      padding: '12px',
                      border: vote === 'yes' ? '2px solid #4caf50' : '1px solid #ddd',
                      backgroundColor: vote === 'yes' ? '#e8f5e9' : 'white',
                      color: '#333',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '1em'
                    }}
                  >
                    👍 YES
                  </button>
                  <button
                    className={`vote-btn no ${vote === 'no' ? 'selected' : ''}`}
                    onClick={() => setVote('no')}
                    style={{
                      flex: 1,
                      padding: '12px',
                      border: vote === 'no' ? '2px solid #f44336' : '1px solid #ddd',
                      backgroundColor: vote === 'no' ? '#ffebee' : 'white',
                      color: '#333',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '1em'
                    }}
                  >
                    👎 NO
                  </button>
                  <button
                    className={`vote-btn dummy ${vote === 'dummy' ? 'selected' : ''}`}
                    onClick={() => setVote('dummy')}
                    title="Send encrypted noise to confuse observers"
                    style={{
                      flex: 1,
                      padding: '12px',
                      border: vote === 'dummy' ? '2px solid #9c27b0' : '1px solid #ddd',
                      backgroundColor: vote === 'dummy' ? '#f3e5f5' : 'white',
                      color: '#333',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '1em'
                    }}
                  >
                    🎭 DUMMY
                  </button>
                </div>

                {vote === 'dummy' && (
                  <div style={{ padding: '10px', backgroundColor: '#fff3e0', border: '1px solid #ff9800', borderRadius: '4px', fontSize: '0.9em', marginBottom: '15px' }}>
                    <strong>🎭 Dummy Vote:</strong> Sends encrypted noise that looks like a real vote to observers. TEE will ignore it during tallying.
                  </div>
                )}

                {vote && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      onClick={() => handleVote(proposal.id)}
                      disabled={loading}
                      className="btn-primary"
                      style={{ flex: 1 }}
                    >
                      {loading ? 'Casting Vote...' : vote === 'dummy'
                        ? 'Cast Dummy Vote (0.002 NEAR)'
                        : `Cast ${vote.toUpperCase()} Vote (0.002 NEAR)`}
                    </button>
                    <button
                      onClick={() => {
                        setVotingProposal(null);
                        setVote('');
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && <div className="error-message">{error}</div>}

      {showSuccess && (
        <div style={{
          marginTop: '20px',
          padding: '20px',
          backgroundColor: '#e8f5e9',
          border: '2px solid #4caf50',
          borderRadius: '8px'
        }}>
          <h3 style={{ color: '#2e7d32', marginTop: 0 }}>✅ Vote Cast Successfully!</h3>

          <p style={{ marginTop: '10px', fontSize: '1em', color: '#555' }}>
            Your encrypted vote has been submitted to the blockchain.
          </p>

          {voteHash && (
            <div style={{ marginTop: '15px' }}>
              <strong style={{ color: '#2e7d32' }}>🔑 Your Vote Hash:</strong>
              <div style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#fff',
                border: '1px solid #4caf50',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '0.85em',
                wordBreak: 'break-all',
                color: '#333'
              }}>
                {voteHash}
              </div>
              <p style={{ marginTop: '10px', fontSize: '0.9em', color: '#666' }}>
                💡 <strong>Save this hash!</strong> After the proposal is finalized, you can verify your vote was included in the tally.
              </p>
            </div>
          )}

          <div style={{
            marginTop: '15px',
            padding: '12px',
            backgroundColor: '#e3f2fd',
            border: '1px solid #2196f3',
            borderRadius: '4px',
            fontSize: '0.9em'
          }}>
            <strong>📊 After Finalization:</strong>
            <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
              <li>Go to the <strong>Proposals</strong> tab</li>
              <li>Click <strong>🔍 View My Vote Proofs</strong></li>
              <li>You'll see your <strong>vote hash</strong> and merkle proof</li>
              <li>The proof cryptographically verifies your vote was counted</li>
            </ul>
          </div>

          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            fontSize: '0.85em'
          }}>
            <strong>🔐 Privacy:</strong> Your vote remains encrypted on-chain. Only the TEE can decrypt and count it.
            The vote hash proves inclusion without revealing how you voted.
          </div>
        </div>
      )}

      <div className="info-box" style={{ marginTop: '20px' }}>
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
