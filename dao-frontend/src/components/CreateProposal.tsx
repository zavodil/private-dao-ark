import React, { useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';

interface CreateProposalProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  onSuccess: () => void;
}

export const CreateProposal: React.FC<CreateProposalProps> = ({
  selector,
  accountId,
  contractId,
  onSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quorumType, setQuorumType] = useState<'absolute' | 'percentage' | 'percentageOfVoters'>('absolute');
  const [quorumValue, setQuorumValue] = useState('3');
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selector) return;

    setLoading(true);
    setError(null);

    try {
      const wallet = await selector.wallet();

      // Calculate deadline timestamp (nanoseconds)
      const deadlineDate = new Date(deadline);
      const deadlineNs = deadlineDate.getTime() * 1_000_000; // Convert ms to ns

      // Build quorum object
      let quorum: any;
      if (quorumType === 'absolute') {
        quorum = { Absolute: { min_votes: parseInt(quorumValue) } };
      } else if (quorumType === 'percentage') {
        quorum = { Percentage: { min_percentage: parseInt(quorumValue) } };
      } else {
        quorum = { PercentageOfVoters: { min_yes_percentage: parseInt(quorumValue) } };
      }

      await (wallet as any).signAndSendTransaction({
        receiverId: contractId,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'create_proposal',
              args: {
                title,
                description,
                quorum,
                deadline: deadlineNs.toString(),
              },
              gas: '50000000000000', // 50 TGas
              deposit: '1000000000000000000000', // 0.001 NEAR
            },
          },
        ],
      });

      setTimeout(() => {
        onSuccess();
        setLoading(false);
      }, 2000);
    } catch (err: any) {
      console.error('Failed to create proposal:', err);
      setError(err.message || 'Failed to create proposal');
      setLoading(false);
    }
  };

  return (
    <div className="create-proposal">
      <h2>Create Proposal</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Title:</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g., Increase member limit to 100"
          />
        </div>

        <div className="form-group">
          <label>Description:</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={5}
            placeholder="Explain your proposal in detail..."
          />
        </div>

        <div className="form-group">
          <label>Quorum Type:</label>
          <select value={quorumType} onChange={(e) => setQuorumType(e.target.value as any)}>
            <option value="absolute">Absolute (min votes)</option>
            <option value="percentage">Percentage of members</option>
            <option value="percentageOfVoters">Percentage of voters</option>
          </select>
        </div>

        <div className="form-group">
          <label>
            {quorumType === 'absolute' ? 'Minimum Votes:' : 'Percentage (%):'}
          </label>
          <input
            type="number"
            value={quorumValue}
            onChange={(e) => setQuorumValue(e.target.value)}
            required
            min="1"
            max={quorumType === 'absolute' ? '1000' : '100'}
          />
        </div>

        <div className="form-group">
          <label>Deadline:</label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Creating...' : 'Create Proposal (0.001 NEAR)'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
};
