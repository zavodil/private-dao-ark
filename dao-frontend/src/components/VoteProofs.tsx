import React, { useState } from 'react';
import { MerkleProof } from '../types';

interface VoteProofsProps {
  proposalId: number;
  accountId: string;
  viewMethod: (method: string, args?: any) => Promise<any>;
  merkleRoot: string;
}

export const VoteProofs: React.FC<VoteProofsProps> = ({
  proposalId,
  accountId,
  viewMethod,
  merkleRoot,
}) => {
  const [proofs, setProofs] = useState<MerkleProof[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProofs, setShowProofs] = useState(false);
  const [verificationResults, setVerificationResults] = useState<Record<number, boolean>>({});

  const fetchProofs = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await viewMethod('get_vote_proofs', {
        proposal_id: proposalId,
        account_id: accountId
      });
      const fetchedProofs = result || [];
      setProofs(fetchedProofs);
      setShowProofs(true);

      // Verify all proofs
      const results: Record<number, boolean> = {};
      for (const proof of fetchedProofs) {
        results[proof.vote_index] = await verifyProof(proof);
      }
      setVerificationResults(results);
    } catch (err: any) {
      console.error('Failed to fetch proofs:', err);
      setError(err.message || 'Failed to fetch proofs');
    } finally {
      setLoading(false);
    }
  };

  const sha256 = async (message: string): Promise<string> => {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const verifyProof = async (proof: MerkleProof): Promise<boolean> => {
    try {
      // Start with the vote hash (leaf)
      let currentHash = proof.vote_hash;

      // Traverse up the tree using sibling hashes
      for (const sibling of proof.proof_path) {
        // Combine current hash with sibling (order doesn't matter for verification,
        // but in the actual tree it depends on left/right position)
        // For simplicity, we hash them in alphabetical order
        const hashes = [currentHash, sibling].sort();
        const combined = hashes[0] + hashes[1];
        currentHash = await sha256(combined);
      }

      // Check if computed root matches the stored merkle root
      return currentHash === merkleRoot;
    } catch (err) {
      console.error('Verification error:', err);
      return false;
    }
  };

  if (!showProofs) {
    return (
      <button
        onClick={fetchProofs}
        disabled={loading}
        className="btn-secondary"
        style={{ marginTop: '10px' }}
      >
        {loading ? 'Loading...' : '🔍 View My Vote Proofs'}
      </button>
    );
  }

  return (
    <div className="vote-proofs" style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4>🔐 Your Vote Proofs</h4>
        <button onClick={() => setShowProofs(false)} className="btn-secondary" style={{ fontSize: '0.85em' }}>
          Hide
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {proofs.length === 0 ? (
        <p style={{ color: '#666', fontStyle: 'italic' }}>No votes found for your account.</p>
      ) : (
        <>
          <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '10px' }}>
            You cast <strong>{proofs.length}</strong> vote(s) in this proposal.
            Each vote has a merkle proof for verification.
          </p>

          {proofs.map((proof, index) => {
            const isValid = verificationResults[proof.vote_index] ?? false;
            return (
              <div
                key={index}
                style={{
                  marginBottom: '15px',
                  padding: '12px',
                  backgroundColor: 'white',
                  borderRadius: '6px',
                  border: `2px solid ${isValid ? '#27ae60' : '#e74c3c'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong>Vote #{proof.vote_index + 1}</strong>
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '0.85em',
                      fontWeight: 'bold',
                      backgroundColor: isValid ? '#27ae60' : '#e74c3c',
                      color: 'white',
                    }}
                  >
                    {isValid ? '✓ VERIFIED' : '✗ INVALID'}
                  </span>
                </div>

                <div style={{ fontSize: '0.85em', color: '#555' }}>
                  <div style={{ marginBottom: '5px' }}>
                    <strong>Timestamp:</strong>{' '}
                    {new Date(proof.timestamp / 1_000_000).toLocaleString()}
                  </div>
                  <div style={{ marginBottom: '5px' }}>
                    <strong>Vote Hash:</strong>{' '}
                    <code style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{proof.vote_hash}</code>
                  </div>
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', color: '#3498db' }}>
                      Show Proof Path ({proof.proof_path.length} sibling hashes)
                    </summary>
                    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
                      {proof.proof_path.map((hash, i) => (
                        <div key={i} style={{ marginBottom: '4px' }}>
                          <strong>Level {i + 1}:</strong>{' '}
                          <code style={{ fontSize: '0.75em', wordBreak: 'break-all' }}>{hash}</code>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                {!isValid && (
                  <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#ffe6e6', borderRadius: '4px', fontSize: '0.85em' }}>
                    ⚠️ Warning: Proof verification failed. This may indicate data corruption or tampering.
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '6px', fontSize: '0.85em' }}>
            <strong>📊 Merkle Root:</strong>
            <code style={{ display: 'block', marginTop: '5px', wordBreak: 'break-all', fontSize: '0.8em' }}>
              {merkleRoot}
            </code>
            <p style={{ marginTop: '8px', color: '#666', fontSize: '0.9em' }}>
              All votes are combined into this merkle root. Each proof verifies that your vote
              was included in the final tally without revealing what you voted.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
