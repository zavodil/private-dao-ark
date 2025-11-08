import React, { useState } from 'react';
import { WalletSelector } from '@near-wallet-selector/core';
import { actionCreators } from '@near-js/transactions';

interface CreateProposalProps {
  selector: WalletSelector | null;
  accountId: string;
  contractId: string;
  onSuccess: () => void;
  viewMethod: (method: string, args?: any) => Promise<any>;
}

export const CreateProposal: React.FC<CreateProposalProps> = ({
  selector,
  accountId,
  contractId,
  onSuccess,
  viewMethod,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quorumType, setQuorumType] = useState<'absolute' | 'percentage'>('percentage');
  const [quorumValue, setQuorumValue] = useState('50');
  const [memberCount, setMemberCount] = useState<number>(0);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current member count
  React.useEffect(() => {
    const fetchMemberCount = async () => {
      try {
        const daoInfo = await viewMethod('get_dao_info');
        setMemberCount(daoInfo.member_count || 0);
      } catch (e) {
        console.error('Failed to fetch member count:', e);
      }
    };
    fetchMemberCount();
  }, [viewMethod]);

  // Calculate actual votes needed
  const calculateMinVotes = (): number => {
    if (quorumType === 'absolute') {
      return parseInt(quorumValue) || 1;
    } else {
      const percentage = parseInt(quorumValue) || 0;
      return Math.ceil((memberCount * percentage) / 100);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selector) return;

    setLoading(true);
    setError(null);

    try {
      const wallet = await selector.wallet();

      // Calculate deadline timestamp (nanoseconds) or null
      let deadlineNs: number | null = null;
      if (hasDeadline && deadline) {
        const deadlineDate = new Date(deadline);
        deadlineNs = deadlineDate.getTime() * 1_000_000; // Convert ms to ns
      }

      // Always save as Absolute (frontend calculates from percentage)
      const minVotes = calculateMinVotes();
      const quorum = { Absolute: { min_votes: minVotes } };

      const action = actionCreators.functionCall(
        'create_proposal',
        {
          title,
          description,
          quorum,
          deadline: deadlineNs, // null or u64 number
        },
        BigInt('200000000000000'), // 200 TGas
        BigInt('1000000000000000000000') // 0.001 NEAR
      );

      await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
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
            <option value="percentage">Percentage of current members</option>
            <option value="absolute">Absolute votes</option>
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
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '4px', fontSize: '0.9em' }}>
            <strong>Current DAO members:</strong> {memberCount}
            <br />
            <strong>Votes required to pass:</strong> {calculateMinVotes()}
            {quorumType === 'percentage' && (
              <span style={{ color: '#666', display: 'block', marginTop: '5px' }}>
                ({quorumValue}% of {memberCount} members = {calculateMinVotes()} votes)
              </span>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={hasDeadline}
              onChange={(e) => {
                const checked = e.target.checked;
                setHasDeadline(checked);
                if (checked && !deadline) {
                  // Set default deadline to +1 week from now
                  const oneWeekLater = new Date();
                  oneWeekLater.setDate(oneWeekLater.getDate() + 7);
                  // Format for datetime-local input (YYYY-MM-DDThh:mm)
                  const formatted = oneWeekLater.toISOString().slice(0, 16);
                  setDeadline(formatted);
                }
              }}
            />
            Set Deadline (optional)
          </label>
        </div>

        {hasDeadline && (
          <div className="form-group">
            <label>Deadline:</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              required
            />
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Creating...' : 'Create Proposal (0.001 NEAR)'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
};
