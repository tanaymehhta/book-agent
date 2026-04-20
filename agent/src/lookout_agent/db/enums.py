import enum


class BandStatus(str, enum.Enum):
    incoming = "incoming"
    in_conversation = "in_conversation"
    approved = "approved"
    archived = "archived"


class ArchiveReason(str, enum.Enum):
    declined = "declined"
    ghosted = "ghosted"
    bad_fit = "bad_fit"
    other = "other"


class MessageDirection(str, enum.Enum):
    inbound = "inbound"
    outbound = "outbound"


class Classification(str, enum.Enum):
    new_inquiry = "new_inquiry"
    pipeline_followup = "pipeline_followup"
    roster_followup = "roster_followup"
    other = "other"


class DraftStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    sent = "sent"
    discarded = "discarded"


class DraftCreatedBy(str, enum.Enum):
    agent = "agent"
    human = "human"


class NoteAuthor(str, enum.Enum):
    agent = "agent"
    laura = "laura"


class ConversationStage(str, enum.Enum):
    new_lead = "new_lead"
    collecting_details = "collecting_details"
    negotiating_terms = "negotiating_terms"
    pending_confirmation = "pending_confirmation"
    confirmed = "confirmed"


class AgentRunTrigger(str, enum.Enum):
    poll = "poll"
    daily = "daily"
    manual = "manual"
