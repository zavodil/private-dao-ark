import React, { useEffect, useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { Proposal } from '../types';

interface ProposalListProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  network: string;
}

export const ProposalList: React.FC<ProposalListProps> = ({
  selector,
  accountId,
  contractId,
  network,
}) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);

  useEffect(() => {
    fetchProposals();
  }, [selector, contractId]);

  const fetchProposals = async () => {
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

      const proposalsList = JSON.parse(Buffer.from(result.result).toString());
      setProposals(proposalsList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch proposals:', error);
      setLoading(false);
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
                <strong>Deadline:</strong> {formatDate(proposal.deadline)}
              </div>
              <div>
                <strong>Proposal ID:</strong> #{proposal.id}
              </div>
            </div>

            {proposal.tally_result && (
              <div className="tally-result">
                <h4>Results:</h4>
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
