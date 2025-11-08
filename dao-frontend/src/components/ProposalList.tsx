import React, { useEffect, useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { actionCreators } from '@near-js/transactions';
import { Proposal } from '../types';
import { VoteProofs } from './VoteProofs';

interface ProposalListProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  network: string;
  viewMethod: (method: string, args?: any) => Promise<any>;
}

export const ProposalList: React.FC<ProposalListProps> = ({
  selector,
  accountId,
  contractId,
  network,
  viewMethod,
}) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [votesCounts, setVotesCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    fetchProposals();
  }, [selector, contractId]);

  const fetchProposals = async () => {
    try {
      const proposalsList = await viewMethod('get_proposals', { from_index: 0, limit: 50 });

      // Handle null or non-array response
      if (!proposalsList || !Array.isArray(proposalsList)) {
        console.warn('Invalid proposals response:', proposalsList);
        setProposals([]);
        setLoading(false);
        return;
      }

      setProposals(proposalsList as Proposal[]);

      // Fetch vote counts for each proposal
      const counts: Record<number, number> = {};
      for (const proposal of proposalsList as Proposal[]) {
        try {
          const votes = await viewMethod('get_votes', { proposal_id: proposal.id });
          counts[proposal.id] = votes ? votes.length : 0;
        } catch (e) {
          counts[proposal.id] = 0;
        }
      }
      setVotesCounts(counts);

      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch proposals:', error);
      setLoading(false);
    }
  };

  const handleFinalize = async (proposal: Proposal) => {
    if (!selector) return;

    const voteCount = votesCounts[proposal.id] || 0;
    if (voteCount === 0) {
      alert('No votes to finalize yet. Wait for at least one vote.');
      return;
    }

    try {
      setFinalizing(true);

      const wallet = await selector.wallet();
      const action = actionCreators.functionCall(
        'finalize_proposal',
        { proposal_id: proposal.id },
        BigInt('200000000000000'), // 200 TGas
        BigInt('10000000000000000000000') // 0.01 NEAR
      );

      await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });

      // Wait a bit for transaction to complete
      setTimeout(() => {
        fetchProposals();
        setFinalizing(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to finalize:', error);
      alert(`Error: ${error}`);
      setFinalizing(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp / 1_000_000).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'blue';
      case 'Passed': return 'green';
      case 'Rejected': return 'red';
      default: return 'gray';
    }
  };

  if (loading) {
    return <div className="loading">Loading proposals...</div>;
  }

  if (proposals.length === 0) {
    return (
      <div className="no-proposals">
        <h2>No Proposals Yet</h2>
        <p>Be the first to create a proposal!</p>
      </div>
    );
  }

  return (
    <div className="proposal-list">
      <h2>Proposals ({proposals.length})</h2>

      <div className="proposals-grid">
        {proposals.map((proposal) => (
          <div
            key={proposal.id}
            className={`proposal-card ${selectedProposal?.id === proposal.id ? 'selected' : ''}`}
            onClick={() => setSelectedProposal(proposal)}
          >
            <div className="proposal-header">
              <h3>{proposal.title}</h3>
              <span
                className="status-badge"
                style={{ backgroundColor: getStatusColor(proposal.status) }}
              >
                {proposal.status}
              </span>
            </div>

            <p className="proposal-description">{proposal.description}</p>

            <div className="proposal-meta">
              <div>
                <strong>Created by:</strong> {proposal.creator}
              </div>
              <div>
                <strong>Deadline:</strong>{' '}
                {proposal.deadline ? formatDate(proposal.deadline) : 'No deadline'}
              </div>
              <div>
                <strong>Proposal ID:</strong> #{proposal.id}
              </div>
              <div>
                <strong>Votes Cast:</strong> {votesCounts[proposal.id] || 0}
                {votesCounts[proposal.id] > 0 && (
                  <span style={{ fontSize: '0.85em', color: '#666', marginLeft: '5px' }}>
                    (may include dummy votes)
                  </span>
                )}
              </div>
            </div>

            {/* Show finalize button for all Active proposals */}
            {proposal.status === 'Active' && (
              <div className="finalize-section" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #ddd' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent card selection
                    handleFinalize(proposal);
                  }}
                  disabled={finalizing || (votesCounts[proposal.id] || 0) === 0}
                  className="btn-primary"
                  style={{ width: '100%' }}
                >
                  {finalizing ? 'Counting votes...' : '⚖️ Finalize & Count Votes (0.01 NEAR)'}
                </button>
                {(votesCounts[proposal.id] || 0) === 0 && (
                  <p style={{ fontSize: '0.85em', color: '#666', marginTop: '5px' }}>
                    Waiting for at least one vote...
                  </p>
                )}
                {/* Show status message if already tallied but quorum not met */}
                {proposal.tally_result && !proposal.tally_result.quorum_met && (
                  <p style={{ fontSize: '0.9em', color: '#f39c12', marginTop: '5px' }}>
                    ⏳ Quorum not met yet. Add more votes and finalize again.
                  </p>
                )}
              </div>
            )}

            {proposal.tally_result && (
              <div className="tally-result">
                <h4>Results:</h4>
                {proposal.tally_result.quorum_met ? (
                  <>
                    <div className="votes-display">
                      <div className="vote-bar">
                        <span className="vote-label">YES: {proposal.tally_result.yes_count}</span>
                        <span className="vote-label">NO: {proposal.tally_result.no_count}</span>
                      </div>
                      <div className="vote-total">
                        Total: {proposal.tally_result.total_votes} votes
                      </div>
                    </div>
                    <details className="attestation-details">
                      <summary>🔐 TEE Attestation</summary>
                      <code>{proposal.tally_result.tee_attestation}</code>
                    </details>
                    <details className="merkle-details">
                      <summary>📊 Merkle Root</summary>
                      <code>{proposal.tally_result.votes_merkle_root}</code>
                    </details>

                    {/* Show vote proofs for user */}
                    <VoteProofs
                      proposalId={proposal.id}
                      accountId={accountId}
                      viewMethod={viewMethod}
                      merkleRoot={proposal.tally_result.votes_merkle_root}
                    />
                  </>
                ) : (
                  <div className="quorum-not-met">
                    <p style={{ color: '#e74c3c', fontWeight: 'bold' }}>
                      ❌ Quorum not met
                    </p>
                    <p style={{ fontSize: '0.9em', color: '#666' }}>
                      Vote counts are hidden to protect voter privacy until quorum is reached.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={fetchProposals} className="btn-secondary">
        🔄 Refresh
      </button>
    </div>
  );
};
