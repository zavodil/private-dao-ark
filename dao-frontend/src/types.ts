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
  deadline: number | null; // Optional deadline
  quorum: QuorumType;
  status: 'Active' | 'Passed' | 'Rejected';
  tally_result: TallyResult | null;
}

export type QuorumType =
  | { Absolute: { min_votes: number } }
  | { Percentage: { min_percentage: number } };

export interface MerkleProof {
  voter: string;
  vote_index: number;
  vote_hash: string;
  proof_path: string[];
  timestamp: number;
}

export interface TallyResult {
  quorum_met: boolean;
  yes_count: number | null; // Only present if quorum met
  no_count: number | null; // Only present if quorum met
  total_votes: number;
  tee_attestation: string;
  votes_merkle_root: string;
  merkle_proofs: MerkleProof[];
}

export interface Vote {
  user: string;
  encrypted_vote: string;
  timestamp: number;
}
