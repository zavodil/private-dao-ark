export interface DAOInfo {
  name: string;
  owner: string;
  membership_mode: 'Public' | 'Private';
  member_count: number;
}

export interface Proposal {
  id: number;
  title: string;
  description: string;
  creator: string;
  created_at: number;
  deadline: number;
  quorum: QuorumType;
  status: 'Active' | 'Passed' | 'Rejected';
  total_members_at_creation: number;
  tally_result: TallyResult | null;
}

export type QuorumType =
  | { Absolute: { min_votes: number } }
  | { Percentage: { min_percentage: number } }
  | { PercentageOfVoters: { min_yes_percentage: number } };

export interface TallyResult {
  quorum_met: boolean;
  yes_count: number | null; // Only present if quorum met
  no_count: number | null; // Only present if quorum met
  total_votes: number;
  tee_attestation: string;
  votes_merkle_root: string;
}

export interface Vote {
  user: string;
  encrypted_vote: string;
  nonce: string;
  timestamp: number;
}
