export type BandStatus = 'incoming' | 'in_conversation' | 'approved' | 'archived';

export type ConversationStage =
  | 'new_lead'
  | 'collecting_details'
  | 'negotiating_terms'
  | 'pending_confirmation'
  | 'confirmed';

export interface BandRow {
  id: string;
  name: string | null;
  contact_name: string | null;
  primary_email: string | null;
  status: BandStatus;
  on_roster: boolean;
  draft_ready: boolean;
  needs_review: boolean;
  conversation_stage: ConversationStage | null;
  last_activity_at: string | null;
  last_snippet: string | null;
  last_direction: 'inbound' | 'outbound' | null;
  last_sent_at: string | null;
}

export interface ThreadMessageRow {
  id: string;
  direction: 'inbound' | 'outbound';
  from_address: string | null;
  to_addresses: string[];
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
  sent_at: string;
}

export interface ThreadDetail {
  thread_id: string;
  provider: string;
  provider_thread_id: string;
  subject: string | null;
  messages: ThreadMessageRow[];
  pending_draft?: DraftRow | null;
}

export interface BandInsights {
  genre: string | null;
  fee_range: string | null;
  set_length_preference: string | null;
  availability_notes: string | null;
  website: string | null;
  social_links: string[];
  key_facts: string[];
  updated_at: string | null;
}

export interface SocialLink {
  label: string;
  url: string;
}

export interface BandProfile {
  id: string;
  name: string | null;
  contact_name: string | null;
  primary_email: string | null;
  w9_name: string | null;
  bio: string | null;
  social_links: SocialLink[];
  on_roster: boolean;
  status: string | null;
  updated_at: string | null;
}

export interface DraftRow {
  id: string;
  provider: string;
  provider_draft_id: string;
  status: 'pending' | 'approved' | 'sent' | 'discarded';
  body_text: string;
  created_at: string;
  updated_at: string;
}
