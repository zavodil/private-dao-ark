import React, { useEffect, useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { Proposal } from '../types';
import { encrypt } from 'eciesjs';

interface VoteOnProposalProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  network: string;
  onSuccess: () => void;
}

export const VoteOnProposal: React.FC<VoteOnProposalProps> = ({
  selector,
  accountId,
  contractId,
  network,
  onSuccess,
}) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
  const [vote, setVote] = useState<'yes' | 'no' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveProposals();
    fetchUserPubkey();
  }, [selector, contractId, accountId]);

  const fetchActiveProposals = async () => {
    if (!selector) return;

    try {
      const { network: networkConfig } = selector.options;
      const provider = new (await import('near-api-js')).providers.JsonRpcProvider({
        url: networkConfig.nodeUrl,
      });

      const result: any = await provider.query({
        request_type: 'call_function',
        account_id: contractId,
        method_name: 'get_proposals',
        args_base64: Buffer.from(JSON.stringify({ from_index: 0, limit: 50 })).toString('base64'),
        finality: 'final',
      });

      const all = JSON.parse(Buffer.from(result.result).toString());
      const active = all.filter((p: Proposal) => p.status === 'Active');
      setProposals(active);
    } catch (error) {
      console.error('Failed to fetch proposals:', error);
    }
  };

  const fetchUserPubkey = async () => {
    if (!selector || !accountId) return;

    try {
      const { network: networkConfig } = selector.options;
      const provider = new (await import('near-api-js')).providers.JsonRpcProvider({
        url: networkConfig.nodeUrl,
      });

      const result: any = await provider.query({
        request_type: 'call_function',
        account_id: contractId,
        method_name: 'get_user_pubkey',
        args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64'),
        finality: 'final',
      });

      const pubkey = JSON.parse(Buffer.from(result.result).toString());
      setUserPubkey(pubkey);
    } catch (error) {
      console.error('Failed to fetch pubkey:', error);
    }
  };

  const encryptVote = (voteValue: string, pubkey: string): string => {
    // ✅ PRODUCTION-READY: Full ECIES encryption with secp256k1
    // Compatible with Rust backend (ecies crate)
    //
    // pubkey format: 33-byte hex string (compressed secp256k1 public key)
    // Returns: hex-encoded ciphertext (nonce included inside)

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
      // Encrypt vote with ECIES
      const encrypted = encryptVote(vote, userPubkey);

      const wallet = await selector.wallet();

      await (wallet as any).signAndSendTransaction({
        receiverId: contractId,
        actions: [
          {
            type: 'FunctionCall' as const,
            params: {
              methodName: 'cast_vote',
              args: {
                proposal_id: selectedProposal,
                encrypted_vote: encrypted,
                nonce: '', // Empty string (ECIES includes nonce in ciphertext)
              },
              gas: '50000000000000', // 50 TGas
              deposit: '2000000000000000000000', // 0.002 NEAR
            },
          },
        ],
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

  const handleFinalize = async (proposalId: number) => {
    if (!selector) return;

    setLoading(true);
    setError(null);

    try {
      const wallet = await selector.wallet();

      await (wallet as any).signAndSendTransaction({
        receiverId: contractId,
        actions: [
          {
            type: 'FunctionCall' as const,
            params: {
              methodName: 'finalize_proposal',
              args: { proposal_id: proposalId },
              gas: '150000000000000', // 150 TGas
              deposit: '10000000000000000000000', // 0.01 NEAR (OutLayer execution)
            },
          },
        ],
      });

      setTimeout(() => {
        onSuccess();
        setLoading(false);
      }, 2000);
    } catch (err: any) {
      console.error('Failed to finalize:', err);
      setError(err.message || 'Failed to finalize proposal');
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

      <div className="warning-box">
        <strong>⚠️ MVP Notice:</strong> Encryption is currently placeholder only. Full ECIES implementation needed for production.
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
                  {isPastDeadline && <span className="expired"> (EXPIRED)</span>}
                </p>

                {isPastDeadline ? (
                  <div className="finalize-section">
                    <p>Voting has closed. You can finalize this proposal to tally votes in TEE.</p>
                    <button
                      onClick={() => handleFinalize(selectedProposal)}
                      disabled={loading}
                      className="btn-primary"
                    >
                      {loading ? 'Finalizing...' : 'Finalize Proposal (0.01 NEAR)'}
                    </button>
                  </div>
                ) : (
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
                    </div>

                    {vote && (
                      <button
                        onClick={handleVote}
                        disabled={loading}
                        className="btn-primary"
                      >
                        {loading ? 'Casting Vote...' : `Cast ${vote.toUpperCase()} Vote (0.002 NEAR)`}
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
          Only the TEE (Trusted Execution Environment) can decrypt and tally votes.
        </p>
        <p>
          <strong>Dummy votes:</strong> You can also submit encrypted dummy messages to obscure your voting patterns.
        </p>
      </div>
    </div>
  );
};
